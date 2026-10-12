import { DynamicLlmProvider } from './dynamic-llm.provider';
import { createLlmProvider } from './llm-provider.factory';

jest.mock('./llm-provider.factory', () => ({ createLlmProvider: jest.fn() }));

const mockCreate = createLlmProvider as jest.MockedFunction<
  typeof createLlmProvider
>;

function eff(
  over: Record<string, unknown> = {},
  llm: Record<string, unknown> = {},
) {
  return {
    proveedor: 'openai',
    modelos: {
      resumen: 'm-resumen',
      whatsapp: 'm-wa',
      evento: 'm-ev',
      reporte: 'm-rep',
      vision: 'm-vis',
      vision_respaldo: 'm-vis-r',
    },
    maxInputTokens: 60000,
    llm: {
      provider: 'openai',
      openaiApiKey: 'k1',
      ollamaBaseUrl: 'http://o',
      awsRegion: 'us-east-1',
      timeoutMs: 1,
      maxRetries: 1,
      retryBaseMs: 1,
      defaultMaxTokens: 1,
      temperature: 0.2,
      ...llm,
    },
    ...over,
  };
}

function setup() {
  let current: any = eff();
  const settings: any = {
    getEffective: jest.fn(() => Promise.resolve(current)),
    modelFor: jest.fn((t: string) => Promise.resolve(current.modelos[t])),
  };
  const adapters: any[] = [];
  mockCreate.mockImplementation(() => {
    const a = { complete: jest.fn().mockResolvedValue('ok') };
    adapters.push(a);
    return a as any;
  });
  return {
    svc: new DynamicLlmProvider(settings),
    adapters,
    set: (e: any) => (current = e),
  };
}

describe('DynamicLlmProvider', () => {
  beforeEach(() => mockCreate.mockReset());

  it('elige el modelo según la tarea (resumen por defecto, vision con imágenes)', async () => {
    const { svc, adapters } = setup();
    await svc.text('s', 'u');
    await svc.text('s', 'u', { task: 'whatsapp' });
    await svc.text('s', 'u', { task: 'evento' });
    await svc.text('s', 'u', { task: 'reporte' });
    await svc.vision({ mediaType: 'image/png', data: new Uint8Array(1) }, 'i');
    await svc.complete({
      prompt: 'p',
      images: [{ mediaType: 'image/png', data: new Uint8Array(1) }],
    });
    const calls = adapters[0].complete.mock.calls.map((c: any[]) => [
      c[0].task,
      c[0].model,
    ]);
    expect(calls).toEqual([
      ['resumen', 'm-resumen'],
      ['whatsapp', 'm-wa'],
      ['evento', 'm-ev'],
      ['reporte', 'm-rep'],
      ['vision', 'm-vis'],
      ['vision', 'm-vis'],
    ]);
  });

  it('un model explícito en la petición tiene prioridad', async () => {
    const { svc, adapters } = setup();
    await svc.complete({ prompt: 'p', model: 'forzado' });
    expect(adapters[0].complete.mock.calls[0][0].model).toBe('forzado');
  });

  it('modelFor delega en la configuración vigente', async () => {
    const { svc } = setup();
    expect(await svc.modelFor('reporte')).toBe('m-rep');
  });

  it('reconfigurar surte efecto sin reiniciar y reutiliza el adaptador si nada cambia', async () => {
    const { svc, adapters, set } = setup();
    await svc.text('s', 'u');
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const e = eff();
    e.modelos.resumen = 'm-nuevo';
    set(e);
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(1); // mismo adaptador, otro modelo
    expect(adapters[0].complete.mock.calls[2][0].model).toBe('m-nuevo');
  });

  it('cambia de adaptador al cambiar clave, proveedor, URL o región', async () => {
    const { svc, set } = setup();
    await svc.text('s', 'u');
    set(eff({}, { openaiApiKey: 'k2' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    set(eff({ proveedor: 'ollama' }, { provider: 'ollama' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    set(
      eff(
        { proveedor: 'ollama' },
        { provider: 'ollama', ollamaBaseUrl: 'http://x' },
      ),
    );
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(4);
    set(eff({ proveedor: 'bedrock' }, { provider: 'bedrock' }));
    await svc.text('s', 'u');
    set(
      eff(
        { proveedor: 'bedrock' },
        { provider: 'bedrock', awsRegion: 'eu-west-1' },
      ),
    );
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(6);
  });

  it('recrea el adaptador de Foundry al cambiar la clave o el endpoint', async () => {
    const { svc, set } = setup();
    const f = (over: Record<string, unknown> = {}) =>
      eff(
        { proveedor: 'foundry' },
        {
          provider: 'foundry',
          foundryApiKey: 'k1',
          foundryEndpoint: 'https://a/openai/v1',
          ...over,
        },
      );
    set(f());
    await svc.text('s', 'u');
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    set(f({ foundryApiKey: 'k2' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    set(f({ foundryApiKey: 'k2', foundryEndpoint: 'https://b/openai/v1' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('recrea el adaptador de Bedrock al cambiar las credenciales AWS', async () => {
    const { svc, set } = setup();
    const bedrock = (awsCredentials?: unknown) =>
      eff(
        { proveedor: 'bedrock' },
        { provider: 'bedrock', ...(awsCredentials ? { awsCredentials } : {}) },
      );
    set(bedrock());
    await svc.text('s', 'u');
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    set(bedrock({ accessKeyId: 'A', secretAccessKey: 'S1' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    set(bedrock({ accessKeyId: 'A', secretAccessKey: 'S2' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    // en otro proveedor las credenciales AWS no importan
    set(
      eff({}, { awsCredentials: { accessKeyId: 'X', secretAccessKey: 'Y' } }),
    );
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(4);
    set(
      eff({}, { awsCredentials: { accessKeyId: 'X', secretAccessKey: 'Z' } }),
    );
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(4);
  });

  it('una clave de otro proveedor no recrea el adaptador', async () => {
    const { svc, set } = setup();
    await svc.text('s', 'u');
    set(eff({}, { anthropicApiKey: 'otra' }));
    await svc.text('s', 'u');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('un nuevo maxOutputTokens (defaultMaxTokens) recrea el adaptador', async () => {
    const { svc, adapters, set } = setup();
    await svc.text('s', 'p');
    set(eff({}, { defaultMaxTokens: 32000 }));
    await svc.text('s', 'p');
    expect(adapters).toHaveLength(2);
    expect(mockCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultMaxTokens: 32000 }),
    );
  });
});
