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

function make(
  motor: string,
  env: Record<string, string> = {},
  managed?: { installer: unknown; supervisor: unknown },
) {
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
    managed?.installer as never,
    managed?.supervisor as never,
  );
  return { p };
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

  describe('modo gestionado (la API instala y arranca el OCR)', () => {
    const setup = (estado: string, proceso = 'detenido', error?: string) => {
      const installer = {
        managed: true,
        getState: jest.fn(async () => ({ estado, error: error ?? null })),
      };
      const supervisor = {
        status: jest.fn(() => ({ proceso })),
        markHealthy: jest.fn(),
      };
      const { p } = make('local', {}, { installer, supervisor });
      return { p, installer, supervisor };
    };

    it('instalando o descargando modelos -> iniciando, sin health check', async () => {
      for (const e of ['instalando', 'descargando-modelos']) {
        const { p } = setup(e);
        expect(await p.serverLocalStatus()).toEqual({
          estado: 'iniciando',
          mensaje: expect.stringMatching(/instalando/),
        });
        expect(p.health).not.toHaveBeenCalled();
      }
    });

    it('no instalado -> detenido con indicación de instalar', async () => {
      const { p } = setup('no-instalado');
      expect(await p.serverLocalStatus()).toEqual({
        estado: 'detenido',
        mensaje: expect.stringMatching(/Instalar OCR local/),
      });
    });

    it('error de instalación -> error con el mensaje guardado', async () => {
      const { p } = setup('error', 'detenido', 'No hay espacio suficiente.');
      expect(await p.serverLocalStatus()).toEqual({
        estado: 'error',
        mensaje: 'No hay espacio suficiente.',
      });
    });

    it('listo + health OK -> listo y marca el proceso sano (127.0.0.1 por defecto)', async () => {
      const { p, supervisor } = setup('listo', 'iniciando');
      p.health.mockResolvedValue({ ok: true, fallback_reason: null });
      expect(await p.serverLocalStatus()).toEqual({
        estado: 'listo',
        fallbackReason: null,
      });
      expect(p.health).toHaveBeenCalledWith('http://127.0.0.1:8000', 2500);
      expect(supervisor.markHealthy).toHaveBeenCalled();
    });

    it('listo + health caído -> según el proceso: iniciando / error / detenido', async () => {
      const a = setup('listo', 'iniciando');
      a.p.health.mockRejectedValue(new Error('down'));
      expect((await a.p.serverLocalStatus()).estado).toBe('iniciando');
      const b = setup('listo', 'error');
      b.p.health.mockRejectedValue(new Error('down'));
      expect(await b.p.serverLocalStatus()).toMatchObject({
        estado: 'error',
        mensaje: expect.stringMatching(/Reinstalar/),
      });
      const c = setup('listo', 'detenido');
      c.p.health.mockRejectedValue(new Error('down'));
      expect(await c.p.serverLocalStatus()).toMatchObject({
        estado: 'detenido',
        mensaje: expect.stringMatching(/Iniciar/),
      });
      expect(JSON.stringify(await c.p.serverLocalStatus())).not.toMatch(
        /contenedor/,
      );
    });

    it('probar (local) caído: mensaje sin «contenedor»', async () => {
      const { p } = setup('listo');
      p.health.mockRejectedValue(new Error('down'));
      const r = await p.probe();
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/instalado e iniciado/);
    });
  });
});
