/** Backoff exponencial: base * 2^(attempts-1), con tope. `attempts` ya incluye el intento fallido. */
export function backoffMs(
  attempts: number,
  baseMs = 10_000,
  maxMs = 3_600_000,
): number {
  const n = Math.max(1, attempts);
  return Math.min(baseMs * 2 ** (n - 1), maxMs);
}
