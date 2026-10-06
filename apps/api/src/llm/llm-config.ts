export type LlmProviderName = 'anthropic' | 'openai' | 'bedrock' | 'ollama';

export interface LlmConfig {
  provider: LlmProviderName;
  modelText: string;
  modelVision: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaBaseUrl: string;
  awsRegion: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  defaultMaxTokens: number;
  temperature: number;
}

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-5-5',
  // ID/perfil de inferencia de Bedrock: verificar en la consola de la región y sobreescribir.
  bedrock: 'anthropic.claude-sonnet-5-5',
  openai: 'gpt-5',
  // Solo desarrollo/pruebas: modelo local con visión (~3 GB).
  ollama: 'qwen2.5vl:3b',
};

const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function readLlmConfig(config: {
  get<T = string>(key: string): T | undefined;
}): LlmConfig {
  const get = (k: string): string | undefined => config.get<string>(k);
  const raw = (get('LLM_PROVIDER') ?? 'anthropic').trim().toLowerCase();
  if (
    raw !== 'anthropic' &&
    raw !== 'openai' &&
    raw !== 'bedrock' &&
    raw !== 'ollama'
  ) {
    throw new Error(
      `LLM_PROVIDER inválido: "${raw}" (anthropic | openai | bedrock | ollama)`,
    );
  }
  const provider: LlmProviderName = raw;
  const modelText = get('LLM_MODEL_TEXT') || DEFAULT_MODELS[provider];
  return {
    provider,
    modelText,
    modelVision: get('LLM_MODEL_VISION') || modelText,
    anthropicApiKey: get('ANTHROPIC_API_KEY') || undefined,
    openaiApiKey: get('OPENAI_API_KEY') || undefined,
    ollamaBaseUrl: get('OLLAMA_BASE_URL') || 'http://localhost:11434/v1',
    awsRegion: get('AWS_REGION') || 'us-east-1',
    timeoutMs: num(get('LLM_TIMEOUT_MS'), 120000),
    maxRetries: num(get('LLM_MAX_RETRIES'), 3),
    retryBaseMs: num(get('LLM_RETRY_BASE_MS'), 1000),
    defaultMaxTokens: num(get('LLM_MAX_OUTPUT_TOKENS'), 8000),
    temperature: num(get('LLM_TEMPERATURE'), 0.2),
  };
}

/**
 * Los modelos más nuevos (Claude 4.6+/5.x, GPT-5/o-series) rechazan temperature/top_p
 * con valores distintos del predeterminado (400): en ellos no se envía.
 */
export function modelAcceptsTemperature(model: string): boolean {
  const m = model.toLowerCase();
  if (/(sonnet|opus|fable|mythos)-5/.test(m)) return false;
  if (/(opus|sonnet)-4-([6-9]|\d{2})/.test(m)) return false;
  if (/(^|[./])(gpt-5|o\d)/.test(m)) return false;
  return true;
}
