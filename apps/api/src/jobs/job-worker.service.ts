import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobHandler, JobRecord } from './job-handler.interface';
import { JobQueueService } from './job-queue.service';

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** Worker de la cola en PostgreSQL: polling corto + concurrencia configurable. */
@Injectable()
export class JobWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(JobWorkerService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly inflight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastHousekeeping = 0;

  concurrency = 2;
  pollMs = 1000;
  lockTimeoutMs = 300_000;
  housekeepingMs = 15_000;
  /** Tareas periódicas (p. ej. encolar hilos pendientes). Las registra el pipeline. */
  private readonly periodic: Array<() => Promise<unknown>> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly queue: JobQueueService,
  ) {
    const c = (k: string) => config.get<string>(k);
    this.concurrency = Math.floor(num(c('JOBS_CONCURRENCY'), 2));
    this.pollMs = num(c('JOBS_POLL_MS'), 1000);
    this.lockTimeoutMs = num(c('JOBS_LOCK_TIMEOUT_SEC'), 300) * 1000;
    queue.options = {
      backoffBaseMs: num(c('JOBS_BACKOFF_BASE_SEC'), 10) * 1000,
      backoffMaxMs: num(c('JOBS_BACKOFF_MAX_SEC'), 3600) * 1000,
      defaultMaxAttempts: Math.floor(num(c('JOBS_MAX_ATTEMPTS'), 5)),
    };
  }

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  addPeriodic(fn: () => Promise<unknown>) {
    this.periodic.push(fn);
  }

  async onApplicationBootstrap() {
    if (this.config.get<string>('JOBS_ENABLED') === 'false') return;
    await this.recoverStale(); // al arrancar: locks vencidos de una ejecución anterior
    this.stopped = false;
    this.schedule();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.pollMs);
  }

  async recoverStale(now = new Date()) {
    const { requeued, failed } = await this.queue.recoverStale(
      this.lockTimeoutMs,
      now,
    );
    for (const job of failed) await this.notifyFailed(job, 'Lock vencido');
    if (requeued || failed.length)
      this.logger.warn(
        `Locks vencidos: ${requeued} reencolados, ${failed.length} en error`,
      );
  }

  /** Una pasada: tareas periódicas + claim de hasta (concurrencia - en vuelo) trabajos. */
  async tick(now = new Date()): Promise<number> {
    try {
      if (now.getTime() - this.lastHousekeeping >= this.housekeepingMs) {
        this.lastHousekeeping = now.getTime();
        await this.recoverStale(now);
        for (const fn of this.periodic) await fn();
      }
      const free = this.concurrency - this.inflight.size;
      const jobs = await this.queue.claim(free, now);
      for (const job of jobs) {
        const p = this.run(job).finally(() => this.inflight.delete(p));
        this.inflight.add(p);
      }
      return jobs.length;
    } catch (e) {
      this.logger.error(`Tick falló: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Espera a que terminen los trabajos en vuelo (tests / apagado). */
  async idle() {
    await Promise.allSettled([...this.inflight]);
  }

  async run(job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
      await handler.handle(job);
      await this.queue.complete(job.id);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // Sin contenido de correos en logs: solo tipo, id y mensaje de error.
      this.logger.warn(
        `Job ${job.type} ${job.id} falló (intento ${job.attempts}/${job.maxAttempts}): ${err.message}`,
      );
      const final = await this.queue.fail(job, err);
      if (final) await this.notifyFailed(job, err);
    }
  }

  private async notifyFailed(job: JobRecord, error: Error | string) {
    const handler = this.handlers.get(job.type);
    if (!handler?.onFailed) return;
    try {
      await handler.onFailed(
        job,
        typeof error === 'string' ? new Error(error) : error,
      );
    } catch (e) {
      this.logger.error(`onFailed ${job.type} falló: ${(e as Error).message}`);
    }
  }
}
