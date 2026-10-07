import { OcrProbeService } from './ocr-probe.service';

class Probe extends OcrProbeService {
  send = jest.fn();
  health = jest.fn();
  protected createTextract() {
    return { send: this.send } as never;
  }
  protected checkHealth(url: string, timeoutMs?: number) {
    return this.health(url, timeoutMs);
  }
}

function make(motor: string, env: Record<string, string> = {}) {
  const runner = {
    getUrl: jest.fn(() => null as string | null),
    getStatus: jest.fn(() => ({ estado: 'detenido' })),
  };
  const p = new Probe(
    { get: (k: string) => env[k] } as never,
    { getEffective: async () => ({ motor }) } as never,
    {
      getEffective: async () => ({ awsRegion: 'us-east-1' }),
      getAwsCredentials: async () => ({
        accessKeyId: 'AKIAXXXX',
        secretAccessKey: 'sec-ret',
      }),
    } as never,
    runner as never,
  );
  return { p, runner };
}

describe('OcrProbeService', () => {
  it('ninguno: ok false con mensaje claro', async () => {
    const r = await make('ninguno').p.probe();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Elige una opción/);
  });

  it('textract ok', async () => {
    const { p } = make('textract');
    p.send.mockResolvedValue({ Blocks: [] });
    expect(await p.probe()).toMatchObject({ ok: true });
    expect(p.testImage().byteLength).toBeGreaterThan(50);
  });

  it('textract: errores sin eco de claves', async () => {
    const { p } = make('textract');
    p.send.mockRejectedValue(
      Object.assign(new Error('bad AKIAXXXX sec-ret'), {
        name: 'UnrecognizedClientException',
      }),
    );
    const r = await p.probe();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('La clave no es válida o no tiene permiso.');
    expect(JSON.stringify(r)).not.toMatch(/AKIA|sec-ret/);
    p.send.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
    );
    expect((await p.probe()).mensaje).toBe(
      'No se pudo conectar con el proveedor.',
    );
  });

  it('local (servidor): consulta OCR_LOCAL_URL y avisa del respaldo', async () => {
    const { p } = make('local', { OCR_LOCAL_URL: 'http://ocr:8000' });
    p.health.mockResolvedValue({ ok: true, fallback_reason: 'ImportError' });
    const r = await p.probe();
    expect(p.health).toHaveBeenCalledWith('http://ocr:8000', undefined);
    expect(r).toMatchObject({ ok: true });
    expect(r.mensaje).toMatch(/Tesseract/);
    p.health.mockRejectedValue(new Error('down'));
    expect((await p.probe()).ok).toBe(false);
  });

  it('local (servidor): health OK -> mensaje sin «de tu computador»', async () => {
    const { p } = make('local', { OCR_LOCAL_URL: 'http://ocr:8000' });
    p.health.mockResolvedValue({ ok: true, fallback_reason: null });
    const r = await p.probe();
    expect(r).toMatchObject({
      ok: true,
      mensaje: 'El servicio de OCR responde bien.',
    });
  });

  it('local (servidor): health caído -> menciona el contenedor ocr-local', async () => {
    const { p } = make('local', { OCR_LOCAL_URL: 'http://ocr:8000' });
    p.health.mockRejectedValue(new Error('down'));
    const r = await p.probe();
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(
      'No se pudo conectar con el servicio de OCR. Revisa que el contenedor ocr-local esté en marcha.',
    );
    expect(r.mensaje).not.toMatch(/computador/);
  });

  it('serverLocalStatus: listo con health corto y sin lanzar nunca', async () => {
    const { p } = make('local', { OCR_LOCAL_URL: 'http://ocr:8000' });
    p.health.mockResolvedValue({ ok: true, fallback_reason: 'ImportError' });
    expect(await p.serverLocalStatus()).toEqual({
      estado: 'listo',
      fallbackReason: 'ImportError',
    });
    expect(p.health).toHaveBeenCalledWith('http://ocr:8000', 2500);
    p.health.mockResolvedValue({ ok: false });
    expect((await p.serverLocalStatus()).estado).toBe('detenido');
    p.health.mockRejectedValue(new Error('down'));
    expect(await p.serverLocalStatus()).toEqual({
      estado: 'detenido',
      mensaje:
        'El servicio de OCR no responde. Revisa que el contenedor ocr-local esté en marcha.',
    });
  });

  it('local (escritorio) sin servicio en marcha', async () => {
    const { p } = make('local', { APP_MODE: 'desktop' });
    expect((await p.probe()).mensaje).toMatch(/no está en marcha/);
  });
});
