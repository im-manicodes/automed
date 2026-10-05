import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { backoffMs } from './backoff';
import { EnqueueOptions, JobRecord } from './job-handler.interface';

export interface QueueOptions {
  backoffBaseMs: number;
  backoffMaxMs: number;
  defaultMaxAttempts: number;
}

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  backoffBaseMs: 10_000,
  backoffMaxMs: 3_600_000,
  defaultMaxAttempts: 5,
};

// Las columnas son `timestamp` sin zona (Prisma guarda UTC): se pasan siempre como ISO UTC.
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;

interface RawJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

const toRecord = (r: RawJob): JobRecord => ({
  id: r.id,
  type: r.type,
  payload: r.payload ?? {},
  attempts: r.attempts,
  maxAttempts: r.maxAttempts,
  dedupeKey: r.dedupeKey,
});

@Injectable()
export class JobQueueService {
  options: QueueOptions = { ...DEFAULT_QUEUE_OPTIONS };

  constructor(private readonly prisma: PrismaService) {}

  /** Encola. Con dedupeKey repetido no duplica (ver `rearm`). Devuelve el id o null si ya existía. */
  async enqueue(
    type: string,
    payload: Record<string, unknown> = {},
    opts: EnqueueOptions = {},
    now = new Date(),
  ): Promise<string | null> {
    const runAt = opts.runAt ?? now;
    const max = opts.maxAttempts ?? this.options.defaultMaxAttempts;
    const key = opts.dedupeKey ?? null;
    const conflict = opts.rearm
      ? Prisma.sql`ON CONFLICT ("dedupeKey") DO UPDATE SET
          status = 'pendiente'::"JobStatus", attempts = 0, "lockedAt" = NULL, "lastError" = NULL,
          "runAt" = EXCLUDED."runAt", payload = EXCLUDED.payload, "updatedAt" = EXCLUDED."updatedAt"
          WHERE "Job".status IN ('listo'::"JobStatus", 'error'::"JobStatus")`
      : Prisma.sql`ON CONFLICT ("dedupeKey") DO NOTHING`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "Job" (id, type, payload, "maxAttempts", "runAt", "dedupeKey", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${type}, ${JSON.stringify(payload)}::jsonb, ${max},
              ${ts(runAt)}, ${key}, ${ts(now)}, ${ts(now)})
      ${conflict}
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  /**
   * Toma hasta `limit` trabajos vencidos de forma atómica. `FOR UPDATE SKIP LOCKED` garantiza
   * que dos workers (o dos hilos) nunca reciban el mismo trabajo.
   */
  async claim(limit: number, now = new Date()): Promise<JobRecord[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.$queryRaw<RawJob[]>`
      UPDATE "Job" SET status = 'procesando'::"JobStatus", "lockedAt" = ${ts(now)},
             attempts = attempts + 1, "updatedAt" = ${ts(now)}
      WHERE id IN (
        SELECT id FROM "Job"
        WHERE status = 'pendiente'::"JobStatus" AND "runAt" <= ${ts(now)}
        ORDER BY "runAt", "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts, "maxAttempts", "dedupeKey"`;
    return rows.map(toRecord);
  }

  async complete(id: string) {
    await this.prisma.job.update({
      where: { id },
      data: { status: 'listo', lockedAt: null, lastError: null },
    });
  }

  /** Registra el fallo. Devuelve true si era el último intento (el trabajo queda en `error`). */
  async fail(job: JobRecord, error: Error, now = new Date()): Promise<boolean> {
    const final = job.attempts >= job.maxAttempts;
    const lastError = error.message.slice(0, 1000);
    if (final) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'error', lockedAt: null, lastError },
      });
    } else {
      const delay = backoffMs(
        job.attempts,
        this.options.backoffBaseMs,
        this.options.backoffMaxMs,
      );
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'pendiente',
          lockedAt: null,
          lastError,
          runAt: new Date(now.getTime() + delay),
        },
      });
    }
    return final;
  }

  /**
   * Recupera trabajos `procesando` cuyo lock venció (el worker murió). Si ya agotaron sus
   * intentos pasan a `error` (se devuelven en `failed` para notificar a su handler); si no,
   * vuelven a `pendiente`.
   */
  async recoverStale(
    timeoutMs: number,
    now = new Date(),
  ): Promise<{ requeued: number; failed: JobRecord[] }> {
    const cutoff = ts(new Date(now.getTime() - timeoutMs));
    const dead = await this.prisma.$queryRaw<RawJob[]>`
      UPDATE "Job" SET status = 'error'::"JobStatus", "lockedAt" = NULL,
             "lastError" = 'Lock vencido sin intentos restantes', "updatedAt" = ${ts(now)}
      WHERE status = 'procesando'::"JobStatus" AND "lockedAt" < ${cutoff} AND attempts >= "maxAttempts"
      RETURNING id, type, payload, attempts, "maxAttempts", "dedupeKey"`;
    const requeued = await this.prisma.$executeRaw`
      UPDATE "Job" SET status = 'pendiente'::"JobStatus", "lockedAt" = NULL,
             "lastError" = 'Lock vencido, reintentando', "updatedAt" = ${ts(now)}
      WHERE status = 'procesando'::"JobStatus" AND "lockedAt" < ${cutoff}`;
    return { requeued, failed: dead.map(toRecord) };
  }

  async statusCounts() {
    const rows = await this.prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts = { pendiente: 0, procesando: 0, listo: 0, error: 0 };
    for (const r of rows) counts[r.status] = r._count._all;
    return counts;
  }
}
