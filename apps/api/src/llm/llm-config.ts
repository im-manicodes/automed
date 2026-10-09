export type LlmProviderName =
  'anthropic' | 'openai' | 'bedrock' | 'ollama' | 'foundry';

export interface LlmConfig {
  provider: LlmProviderName;
  modelText: string;
  modelVision: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Microsoft Foundry: clave API y endpoint del recurso (`.../openai/v1`); el modelo = deployment. */
  foundryApiKey?: string;
  foundryEndpoint?: string;
  ollamaBaseUrl: string;
  awsRegion: string;
  /** Credenciales AWS explícitas (panel); sin ellas se usa la cadena por defecto de AWS. */
  awsCredentials?: { accessKeyId: string; secretAccessKey: string };
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  defaultMaxTokens: number;
  temperature: number;
}

export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-5-5',
  // ID/perfil de inferencia de Bedrock: verificar en la consola de la región y sobreescribir.
  bedrock: 'anthropic.claude-sonnet-5-5',
  openai: 'gpt-5',
  // Modelo local recomendado: Qwen3-VL 4B con visión (~3,3 GB; requiere Ollama >= 0.12.7). Se usa la variante
  // `-instruct`: el tag `qwen3-vl:4b` a secas apunta a la de razonamiento (mismo digest que `4b-thinking`),
  // que mete su razonamiento en la respuesta y gasta el límite de tokens.
  ollama: 'qwen3-vl:4b-instruct',
  // En Foundry el modelo es el nombre del deployment (lo elige el usuario): sin valor por defecto.
  foundry: '',
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
    raw !== 'ollama' &&
    raw !== 'foundry'
  ) {
    throw new Error(
      `LLM_PROVIDER inválido: "${raw}" (anthropic | openai | bedrock | ollama | foundry)`,
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
    foundryApiKey: get('FOUNDRY_API_KEY') || undefined,
    foundryEndpoint: get('FOUNDRY_ENDPOINT') || undefined,
    ollamaBaseUrl: get('OLLAMA_BASE_URL') || 'http://localhost:11434/v1',
    awsRegion: get('AWS_REGION') || 'us-east-1',
    timeoutMs: num(get('LLM_TIMEOUT_MS'), 120000),
    maxRetries: num(get('LLM_MAX_RETRIES'), 3),
    retryBaseMs: num(get('LLM_RETRY_BASE_MS'), 1000),
    defaultMaxTokens: num(get('LLM_MAX_OUTPUT_TOKENS'), 16000),
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

/** Tokens extra para modelos con razonamiento (GPT-5/o-series): el razonamiento cuenta dentro de `max_completion_tokens`. */
export const REASONING_HEADROOM_TOKENS = 6000;

/** Margen de salida según el modelo; 0 si no razona (o si el nombre del deployment no lo delata). */
export function reasoningHeadroom(model: string): number {
  return /(^|[./-])(gpt-5|o\d)/.test(model.toLowerCase())
    ? REASONING_HEADROOM_TOKENS
    : 0;
}
