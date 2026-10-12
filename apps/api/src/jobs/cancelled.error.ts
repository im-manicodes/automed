/**
 * El usuario canceló el análisis (POST /threads/:id/cancel) mientras un trabajo estaba en vuelo.
 * Cancelación cooperativa: el trabajo lo detecta en su siguiente punto de control y termina sin
 * persistir nada. El pipeline lo captura y termina el job con normalidad (sin reintentos ni
 * onFailed): nunca deja el hilo en `error`.
 */
export class CancelledError extends Error {
  constructor(message = 'Análisis cancelado') {
    super(message);
    this.name = 'CancelledError';
  }
}

export const isCancelled = (e: unknown): e is CancelledError =>
  e instanceof CancelledError;
