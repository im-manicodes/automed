import { OllamaService, ollamaNativeBase } from './ollama.service';

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

function ndjson(lines: unknown[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(JSON.stringify(l) + '\n'));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('OllamaService', () => {
  let fetchMock: jest.SpyInstance;
  let svc: OllamaService;
  beforeEach(() => {
    svc = new OllamaService();
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('ollamaNativeBase quita /v1 y barras finales', () => {
    expect(ollamaNativeBase('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434',
    );
    expect(ollamaNativeBase('http://h:1')).toBe('http://h:1');
  });

  it('info: versión y modelos desde /api/version y /api/tags', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith('/api/version')
        ? json({ version: '0.5.1' })
        : json({ models: [{ name: 'qwen2.5vl:3b' }, { name: 'x:1' }] }),
    );
    expect(await svc.info('http://localhost:11434/v1')).toEqual({
      alcanzable: true,
      version: '0.5.1',
      modelos: ['qwen2.5vl:3b', 'x:1'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:11434/api/version',
    );
  });

  it('info: error de conexión -> no alcanzable; URL no http -> no alcanzable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await svc.info('http://localhost:1/v1')).toEqual({
      alcanzable: false,
      modelos: [],
    });
    expect((await svc.info('ftp://x')).alcanzable).toBe(false);
  });

  it('status: inactivo si nunca se inició', () => {
    expect(svc.status('m')).toEqual({
      modelo: 'm',
      estado: 'inactivo',
      completado: 0,
      total: 0,
    });
  });

  it('pull: lee NDJSON, avanza y termina en listo', async () => {
    fetchMock.mockResolvedValue(
      ndjson([
        { status: 'pulling manifest' },
        { status: 'downloading', total: 100, completed: 40 },
        { status: 'downloading', total: 100, completed: 90 },
        { status: 'success' },
      ]),
    );
    const first = svc.startPull('http://localhost:11434/v1', 'qwen2.5vl:3b');
    expect(first.estado).toBe('descargando');
    await tick();
    expect(svc.status('qwen2.5vl:3b')).toMatchObject({
      estado: 'listo',
      completado: 100,
      total: 100,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ name: 'qwen2.5vl:3b', stream: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/pull');
  });

  it('pull: es idempotente mientras descarga (una sola petición)', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    svc.startPull('http://h:1', 'm');
    const again = svc.startPull('http://h:1', 'm');
    expect(again.estado).toBe('descargando');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pull: error de conexión -> estado error con mensaje seguro', async () => {
    fetchMock.mockRejectedValue(new Error('secreto interno'));
    svc.startPull('http://h:1', 'm');
    await tick();
    const s = svc.status('m');
    expect(s.estado).toBe('error');
    expect(s.error).toBe('No se pudo conectar con Ollama.');
  });

  it('pull: error en el flujo -> estado error', async () => {
    fetchMock.mockResolvedValue(
      ndjson([{ error: 'pull model manifest: 500' }]),
    );
    svc.startPull('http://h:1', 'm');
    await tick();
    expect(svc.status('m')).toMatchObject({
      estado: 'error',
      error: 'Ollama no pudo descargar el modelo.',
    });
  });

  it('pull: tras error se puede reintentar', async () => {
    fetchMock.mockRejectedValueOnce(new Error('x'));
    svc.startPull('http://h:1', 'm');
    await tick();
    fetchMock.mockResolvedValue(ndjson([{ status: 'success' }]));
    svc.startPull('http://h:1', 'm');
    await tick();
    expect(svc.status('m').estado).toBe('listo');
  });
});
