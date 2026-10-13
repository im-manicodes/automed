import type { LlmUsageInfo } from './llm-provider.interface';

const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

/** OpenAI / Foundry / Ollama (`chat.completions`): `prompt_tokens` ya incluye los cacheados. */
export function usageFromOpenAi(u: unknown): LlmUsageInfo | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: {
      cached_tokens?: unknown;
      cache_write_tokens?: unknown;
      cache_creation_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    } | null;
    cache_write_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
  // TODO(verificar): no está confirmado qué campo usa GPT-6 en Foundry para los tokens escritos
  // en caché; se prueban nombres candidatos y, si ninguno viene, cacheWriteTokens queda en 0.
  // Comprobar con una respuesta real de Foundry.
  const d = r.prompt_tokens_details;
  if (r.prompt_tokens === undefined && r.completion_tokens === undefined)
    return undefined;
  return {
    inputTokens: n(r.prompt_tokens),
    outputTokens: n(r.completion_tokens),
    cachedTokens: n(d?.cached_tokens),
    cacheWriteTokens:
      n(d?.cache_write_tokens) ||
      n(d?.cache_creation_tokens) ||
      n(d?.cache_creation_input_tokens) ||
      n(r.cache_write_tokens) ||
      n(r.cache_creation_input_tokens),
  };
}

/** Anthropic: `input_tokens` NO incluye lo leído ni lo escrito en caché; se suman. */
export function usageFromAnthropic(u: unknown): LlmUsageInfo | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
  if (r.input_tokens === undefined && r.output_tokens === undefined)
    return undefined;
  const cached = n(r.cache_read_input_tokens);
  const write = n(r.cache_creation_input_tokens);
  return {
    inputTokens: n(r.input_tokens) + cached + write,
    outputTokens: n(r.output_tokens),
    cachedTokens: cached,
    cacheWriteTokens: write,
  };
}

/** Bedrock Converse: `inputTokens` NO incluye `cacheReadInputTokens`/`cacheWriteInputTokens`. */
export function usageFromBedrock(u: unknown): LlmUsageInfo | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadInputTokens?: unknown;
    cacheWriteInputTokens?: unknown;
  };
  if (r.inputTokens === undefined && r.outputTokens === undefined)
    return undefined;
  const cached = n(r.cacheReadInputTokens);
  const write = n(r.cacheWriteInputTokens);
  return {
    inputTokens: n(r.inputTokens) + cached + write,
    outputTokens: n(r.outputTokens),
    cachedTokens: cached,
    cacheWriteTokens: write,
  };
}
