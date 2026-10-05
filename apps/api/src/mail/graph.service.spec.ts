import { AuthService } from '../auth/auth.service';
import { DeltaExpiredError, GraphService } from './graph.service';
import { msg } from './fixtures/graph.fixtures';

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

describe('GraphService', () => {
  let fetchMock: jest.SpyInstance;
  let svc: GraphService;
  const auth = { getAccessToken: jest.fn().mockResolvedValue('tok') };

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    svc = new GraphService(auth as unknown as AuthService);
    jest.spyOn(svc, 'sleep').mockResolvedValue();
    auth.getAccessToken.mockClear();
  });
  afterEach(() => fetchMock.mockRestore());

  it('pagina con nextLink y entrega deltaLink al final', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ value: [msg('1', 'c')], '@odata.nextLink': 'https://g/next' }),
      )
      .mockResolvedValueOnce(
        json({ value: [msg('2', 'c')], '@odata.deltaLink': 'https://g/delta' }),
      );
    const pages = [];
    for await (const p of svc.deltaMessages('inbox')) pages.push(p);
    expect(pages.map((p) => p.messages.length)).toEqual([1, 1]);
    expect(pages[0].deltaLink).toBeUndefined();
    expect(pages[1].deltaLink).toBe('https://g/delta');
    expect(fetchMock.mock.calls[1][0]).toBe('https://g/next');
  });

  it('reintenta en 429 respetando Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json({ value: [], '@odata.deltaLink': 'd' }));
    for await (const _ of svc.deltaMessages('inbox')) void _;
    expect(svc.sleep).toHaveBeenCalledWith(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renueva el token una vez en 401', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ value: [{ id: 'a' }] }));
    expect(await svc.listAttachments('m1')).toHaveLength(1);
    expect(auth.getAccessToken).toHaveBeenCalledWith(true);
  });

  it('usa la carpeta pedida en la URL del delta', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ value: [], '@odata.deltaLink': 'd' }),
    );
    for await (const _ of svc.deltaMessages('sentitems')) void _;
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/mailFolders/sentitems/messages/delta',
    );
  });

  it('410 => DeltaExpiredError', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'syncStateNotFound' } }, 410),
    );
    await expect(
      svc.deltaMessages('inbox', 'https://g/old').next(),
    ).rejects.toBeInstanceOf(DeltaExpiredError);
  });
});
