export type JobType =
  | 'process_thread'
  | 'process_attachment'
  | 'synthesize_thread'
  | 'generate_report';

export interface JobRecord {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

export interface JobHandler {
  handle(job: JobRecord): Promise<void>;
  /** Se invoca una sola vez cuando el trabajo agota sus reintentos (estado `error`). */
  onFailed?(job: JobRecord, error: Error): Promise<void>;
}

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Si ya existe un trabajo con el mismo dedupeKey y está terminado (listo/error),
   * lo reactiva. Los trabajos pendientes/procesando nunca se tocan.
   */
  rearm?: boolean;
}

export const JOB_TYPES = {
  processThread: 'process_thread',
  processAttachment: 'process_attachment',
  synthesizeThread: 'synthesize_thread',
  generateReport: 'generate_report',
} as const;
