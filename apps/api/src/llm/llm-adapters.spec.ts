import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { BedrockLlmProvider } from './bedrock-llm.provider';
import { OpenAiLlmProvider } from './openai-llm.provider';
import { createLlmProvider } from './llm-provider.factory';
import { modelAcceptsTemperature, readLlmConfig } from './llm-config';
import { isRetryable, withRetry } from './llm-retry';
import type { LlmConfig } from './llm-config';

const cfg = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: 'anthropic',
  modelText: 'claude-sonnet-5-5',
  modelVision: 'claude-vision-x',
  awsRegion: 'us-east-1',
  timeoutMs: 1000,
  maxRetries: 2,
  retryBaseMs: 1,
  defaultMaxTokens: 500,
  temperature: 0.2,
  ...over,
});
const noSleep = () => Promise.resolve();
const img = { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) };
const envOf = (o: Record<string, string>) => ({
  get: <T = string>(k: string) => o[k] as T | undefined,
});

describe('readLlmConfig / selección de adaptador', () => {
  it('por defecto anthropic con claude-sonnet-5-5 y visión = texto', () => {
    const c = readLlmConfig(envOf({}));
    expect(c.provider).toBe('anthropic');
    expect(c.modelText).toBe('claude-sonnet-5-5');
    expect(c.modelVision).toBe('claude-sonnet-5-5');
  });

  it('respeta LLM_MODEL_TEXT / LLM_MODEL_VISION y rechaza proveedores inválidos', () => {
    const c = readLlmConfig(
      envOf({
        LLM_PROVIDER: 'bedrock',
        LLM_MODEL_TEXT: 'a',
        LLM_MODEL_VISION: 'b',
      }),
    );
    expect([c.provider, c.modelText, c.modelVision]).toEqual([
      'bedrock',
      'a',
      'b',
    ]);
    expect(() => readLlmConfig(envOf({ LLM_PROVIDER: 'x' }))).toThrow();
  });

  it.each([
    ['anthropic', AnthropicLlmProvider],
    ['bedrock', BedrockLlmProvider],
    ['openai', OpenAiLlmProvider],
  ] as const)('LLM_PROVIDER=%s crea el adaptador correcto', (name, cls) => {
    const p = createLlmProvider(
      readLlmConfig(
        envOf({
          LLM_PROVIDER: name,
          ANTHROPIC_API_KEY: 'k',
          OPENAI_API_KEY: 'k',
        }),
      ),
    );
    expect(p).toBeInstanceOf(cls);
  });

  it('no envía temperature a modelos que la rechazan', () => {
    expect(modelAcceptsTemperature('claude-sonnet-5-5')).toBe(false);
    expect(modelAcceptsTemperature('anthropic.claude-opus-5-5')).toBe(false);
    expect(modelAcceptsTemperature('claude-haiku-4-5')).toBe(true);
    expect(modelAcceptsTemperature('gpt-5')).toBe(false);
    expect(modelAcceptsTemperature('gpt-4.1')).toBe(true);
  });
});

describe('withRetry', () => {
  it('reintenta 429/5xx y no reintenta 400', async () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ name: 'ThrottlingException' })).toBe(true);
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue('ok');
    await expect(
      withRetry(fn, { retries: 3, baseMs: 1, sleep: noSleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    const bad = jest.fn().mockRejectedValue({ status: 400 });
    await expect(
      withRetry(bad, { retries: 3, baseMs: 1, sleep: noSleep }),
    ).rejects.toEqual({ status: 400 });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras agotar reintentos', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(
      withRetry(fn, { retries: 2, baseMs: 1, sleep: noSleep }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('AnthropicLlmProvider (SDK mockeado)', () => {
  const make = (create: jest.Mock, c = cfg()) =>
    new AnthropicLlmProvider(c, { messages: { create } } as never, noSleep);

  it('texto: system + user, sin temperature en Sonnet 5.5, une bloques de texto', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: ' Hola ' },
      ],
    });
    const out = await make(create).text('SYS', 'USER', { maxTokens: 100 });
    expect(out).toBe('Hola');
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      system: 'SYS',
    });
    expect(body.temperature).toBeUndefined();
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'USER' }]);
  });

  it('envía temperature en modelos que la aceptan', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'x' }] });
    await make(create, cfg({ modelText: 'claude-haiku-4-5' })).text('s', 'u');
    expect(create.mock.calls[0][0].temperature).toBe(0.2);
  });

  it('visión: imagen base64 y modelo de visión', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'abc' }] });
    await make(create).vision(img, 'transcribe');
    const body = create.mock.calls[0][0];
    expect(body.model).toBe('claude-vision-x');
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AQID' },
    });
  });

  it('reintenta ante 429 y falla ante refusal', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    await expect(make(create).text('s', 'u')).resolves.toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
    const refusal = jest
      .fn()
      .mockResolvedValue({ stop_reason: 'refusal', content: [] });
    await expect(make(refusal).text('s', 'u')).rejects.toThrow(/rechaz/);
  });
});

describe('BedrockLlmProvider (SDK mockeado)', () => {
  it('Converse con system, imagen y maxTokens; sin temperature en claude-5', async () => {
    const send = jest.fn().mockResolvedValue({
      output: { message: { content: [{ text: 'hola ' }, { text: 'mundo' }] } },
    });
    const p = new BedrockLlmProvider(
      cfg({
        provider: 'bedrock',
        modelText: 'anthropic.claude-sonnet-5-5',
        modelVision: 'anthropic.claude-sonnet-5-5',
      }),
      { send },
      noSleep,
    );
    expect(await p.vision(img, 'lee', { system: 'S', maxTokens: 50 })).toBe(
      'hola mundo',
    );
    const input = send.mock.calls[0][0].input;
    expect(input.modelId).toBe('anthropic.claude-sonnet-5-5');
    expect(input.system).toEqual([{ text: 'S' }]);
    expect(input.inferenceConfig).toEqual({ maxTokens: 50 });
    expect(input.messages[0].content[0].image.format).toBe('png');
  });

  it('reintenta ThrottlingException', async () => {
    const err = Object.assign(new Error('t'), { name: 'ThrottlingException' });
    const send = jest
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue({
        output: { message: { content: [{ text: 'ok' }] } },
      });
    const p = new BedrockLlmProvider(
      cfg({ provider: 'bedrock' }),
      { send },
      noSleep,
    );
    await expect(p.text('s', 'u')).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('OpenAiLlmProvider (SDK mockeado)', () => {
  it('chat.completions con system, imagen data URL y temperature si el modelo la admite', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ choices: [{ message: { content: ' listo ' } }] });
    const p = new OpenAiLlmProvider(
      cfg({ provider: 'openai', modelText: 'gpt-4.1', modelVision: 'gpt-4.1' }),
      { chat: { completions: { create } } } as never,
      noSleep,
    );
    expect(await p.vision(img, 'lee', { system: 'S' })).toBe('listo');
    const body = create.mock.calls[0][0];
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'S' });
    expect(body.messages[1].content[0].image_url.url).toBe(
      'data:image/png;base64,AQID',
    );
  });
});
