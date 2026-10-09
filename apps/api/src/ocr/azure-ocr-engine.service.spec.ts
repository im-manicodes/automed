import { AzureOcrEngineService } from './azure-ocr-engine.service';

const img = new Uint8Array([1, 2, 3]);

describe('AzureOcrEngineService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sin credenciales falla con un mensaje claro', async () => {
    const svc = new AzureOcrEngineService({
      getAzureCredentials: async () => null,
    } as never);
    await expect(svc.recognize(img, 1)).rejects.toThrow(
      /Falta la dirección o la clave de Azure/,
    );
  });

  it('envía la imagen, espera la operación y mapea la página', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const svc = new AzureOcrEngineService({
      getAzureCredentials: async () => ({
        endpoint: 'https://x.azure.com/',
        key: 'k',
      }),
    } as never);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { 'operation-location': 'https://x.azure.com/op/1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'succeeded',
            analyzeResult: {
              pages: [
                {
                  width: 10,
                  height: 10,
                  words: [
                    {
                      content: 'a',
                      polygon: [1, 1, 2, 1, 2, 2, 1, 2],
                      confidence: 0.8,
                    },
                  ],
                  lines: [],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    const p = svc.recognize(img, 4);
    await jest.advanceTimersByTimeAsync(1100);
    const r = await p;
    jest.useRealTimers();
    expect(r.pageNumber).toBe(4);
    expect(r.words[0].text).toBe('a');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      'https://x.azure.com/documentintelligence/documentModels/prebuilt-read:analyze',
    );
    expect(init.headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': 'k',
    });
  });

  it('401 se propaga con status para mapear el mensaje, sin la clave', async () => {
    const svc = new AzureOcrEngineService({
      getAzureCredentials: async () => ({
        endpoint: 'https://x.azure.com',
        key: 'secreta',
      }),
    } as never);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'Unauthorized' } }), {
        status: 401,
      }),
    );
    const err = await svc
      .recognize(img, 1)
      .catch((e: Error & { status?: number }) => e);
    expect((err as { status?: number }).status).toBe(401);
    expect((err as Error).message).not.toContain('secreta');
  });
});
