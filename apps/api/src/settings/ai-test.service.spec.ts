import { BadRequestException } from '@nestjs/common';
import { AiTestService, mapTestError } from './ai-test.service';
import * as factory from '../llm/llm-provider.factory';
import type { AiSettingsService } from './ai-settings.service';

describe('mapTestError', () => {
  it.each([
    [{ status: 401 }, 'La clave no es válida o no tiene permiso.'],
    [{ status: 403 }, 'La clave no es válida o no tiene permiso.'],
    [
      { name: 'AccessDeniedException' },
      'La clave no es válida o no tiene permiso.',
    ],
    [{ status: 404 }, 'No existe ese modelo en este proveedor.'],
    [
      { message: 'The model `x` does not exist' },
      'No existe ese modelo en este proveedor.',
    ],
    [
      { status: 429 },
      'El proveedor limitó las peticiones; intenta en un minuto.',
    ],
    [{ code: 'ECONNREFUSED' }, 'No se pudo conectar con el proveedor.'],
    [{ name: 'TimeoutError' }, 'No se pudo conectar con el proveedor.'],
    [{ message: 'fetch failed' }, 'No se pudo conectar con el proveedor.'],
    [{ status: 500, message: 'boom' }, 'No se pudo probar la conexión.'],
    [undefined, 'No se pudo probar la conexión.'],
  ])('%j', (err, msg) => {
    expect(mapTestError(err)).toBe(msg);
  });

  it('nunca repite la clave del mensaje original', () => {
    const m = mapTestError({ status: 401, message: 'Bad key sk-SECRET123' });
    expect(m).not.toContain('SECRET');
  });
});

describe('AiTestService', () => {
  const eff = {
    proveedor: 'openai',
    modelos: { resumen: 'gpt-5' },
    llm: {
      provider: 'openai',
      openaiApiKey: 'sk-guardada',
      ollamaBaseUrl: 'http://o:1/v1',
      awsRegion: 'us-east-1',
    },
  };
  const ai = { getEffective: jest.fn().mockResolvedValue(eff) };
  const svc = new AiTestService(ai as unknown as AiSettingsService);
  afterEach(() => jest.restoreAllMocks());

  it('ok: usa la clave del borrador y reporta Funciona.', async () => {
    const complete = jest.fn().mockResolvedValue('OK');
    const spy = jest
      .spyOn(factory, 'createLlmProvider')
      .mockReturnValue({ complete } as never);
    const r = await svc.test({ claveOpenai: 'sk-nueva', modelo: 'gpt-4.1' });
    expect(r).toMatchObject({ ok: true, mensaje: 'Funciona.' });
    expect(typeof r.ms).toBe('number');
    const cfg = spy.mock.calls[0][0];
    expect(cfg.openaiApiKey).toBe('sk-nueva');
    expect(cfg.maxRetries).toBe(0);
    expect(complete.mock.calls[0][0]).toMatchObject({
      maxTokens: 16,
      model: 'gpt-4.1',
    });
  });

  it('sin borrador usa la clave guardada', async () => {
    const spy = jest.spyOn(factory, 'createLlmProvider').mockReturnValue({
      complete: jest.fn().mockResolvedValue('OK'),
    } as never);
    await svc.test(undefined);
    expect(spy.mock.calls[0][0].openaiApiKey).toBe('sk-guardada');
  });

  it('error del proveedor: mensaje mapeado sin eco de la clave', async () => {
    jest.spyOn(factory, 'createLlmProvider').mockReturnValue({
      complete: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('key sk-x'), { status: 401 }),
        ),
    } as never);
    const r = await svc.test({ claveOpenai: 'sk-x' });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('La clave no es válida o no tiene permiso.');
    expect(JSON.stringify(r)).not.toContain('sk-x');
  });

  it('borrador inválido -> 400', async () => {
    await expect(svc.test({ proveedor: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.test({ ollamaUrl: 'ftp://x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
