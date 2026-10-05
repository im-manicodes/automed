export interface RetryOptions {
  retries: number;
  baseMs: number;
  /** Inyectable para tests. */
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_NAMES = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerException',
  'ModelTimeoutException',
  'TimeoutError',
  'AbortError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
]);
const RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']);

/** 429, 5xx, timeouts y errores de red son reintentables; 4xx restantes no. */
export function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    status?: number;
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.status ?? e.$metadata?.httpStatusCode;
  if (typeof status === 'number') return status === 429 || status >= 500;
  if (e.name && RETRY_NAMES.has(e.name)) return true;
  return !!e.code && RETRY_CODES.has(e.code);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    retries,
    baseMs,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      // Backoff exponencial con jitter; nunca se loguea el contenido de la petición.
      await sleep(baseMs * 2 ** attempt * (0.5 + Math.random() / 2));
    }
  }
}
