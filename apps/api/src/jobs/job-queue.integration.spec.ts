import { JobQueueService } from './job-queue.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integración contra PostgreSQL real. Solo corre si TEST_DATABASE_URL está definida y
 * apunta a una BD/esquema de pruebas con las migraciones aplicadas (prisma migrate deploy).
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('JobQueueService (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let queue: JobQueueService;

  beforeAll(async () => {
    prisma = new PrismaService({ getOrThrow: () => url } as never);
    await prisma.onModuleInit();
    queue = new JobQueueService(prisma);
  });
  beforeEach(async () => {
    await prisma.job.deleteMany();
  });
  afterAll(async () => {
    await prisma.job.deleteMany();
    await prisma.onModuleDestroy();
  });

  it('claim concurrente: ningún trabajo se entrega dos veces', async () => {
    const total = 60;
    for (let i = 0; i < total; i++) await queue.enqueue('t', { i });
    const batches = await Promise.all(
      Array.from({ length: 10 }, () => queue.claim(10)),
    );
    const ids = batches.flat().map((j) => j.id);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    expect(batches.flat().every((j) => j.attempts === 1)).toBe(true);
    expect(await queue.claim(10)).toEqual([]);
  });

  it('no entrega trabajos con runAt futuro', async () => {
    await queue.enqueue('t', {}, { runAt: new Date(Date.now() + 60_000) });
    expect(await queue.claim(5)).toHaveLength(0);
  });

  it('dedupeKey: no duplica; rearm solo reactiva trabajos terminados', async () => {
    const a = await queue.enqueue('t', {}, { dedupeKey: 'k' });
    expect(a).not.toBeNull();
    expect(await queue.enqueue('t', {}, { dedupeKey: 'k' })).toBeNull();
    expect(
      await queue.enqueue('t', {}, { dedupeKey: 'k', rearm: true }),
    ).toBeNull(); // pendiente: intacto
    const [j] = await queue.claim(1);
    await queue.complete(j.id);
    expect(await queue.enqueue('t', {}, { dedupeKey: 'k' })).toBeNull(); // sin rearm: sigue listo
    expect(await queue.enqueue('t', {}, { dedupeKey: 'k', rearm: true })).toBe(
      a,
    );
    const row = await prisma.job.findUniqueOrThrow({ where: { id: a! } });
    expect(row.status).toBe('pendiente');
    expect(row.attempts).toBe(0);
    expect(await prisma.job.count()).toBe(1);
  });

  it('fallo con backoff y error definitivo', async () => {
    queue.options = {
      backoffBaseMs: 1000,
      backoffMaxMs: 60_000,
      defaultMaxAttempts: 2,
    };
    await queue.enqueue('t', {});
    const now = new Date();
    const [j1] = await queue.claim(1, now);
    expect(await queue.fail(j1, new Error('uno'), now)).toBe(false);
    expect(await queue.claim(1, now)).toHaveLength(0); // aún en backoff
    const later = new Date(now.getTime() + 1500);
    const [j2] = await queue.claim(1, later);
    expect(j2.attempts).toBe(2);
    expect(await queue.fail(j2, new Error('dos'), later)).toBe(true);
    const row = await prisma.job.findUniqueOrThrow({ where: { id: j2.id } });
    expect(row.status).toBe('error');
    expect(row.lastError).toBe('dos');
  });

  it('recupera locks vencidos al arrancar', async () => {
    queue.options = {
      backoffBaseMs: 1000,
      backoffMaxMs: 60_000,
      defaultMaxAttempts: 2,
    };
    const t0 = new Date(Date.now() - 10 * 60_000);
    await queue.enqueue('t', {}, { dedupeKey: 'a' }, t0);
    await queue.enqueue('t', {}, { dedupeKey: 'b', maxAttempts: 1 }, t0);
    await queue.enqueue('t', {}, { dedupeKey: 'c' });
    await queue.claim(2, t0); // a y b "murieron" hace 10 min
    const fresh = await queue.claim(1); // c con lock reciente
    const r = await queue.recoverStale(5 * 60_000);
    expect(r.requeued).toBe(1); // a
    expect(r.failed.map((j) => j.dedupeKey)).toEqual(['b']); // b agotó intentos
    const byKey = async (k: string) =>
      (await prisma.job.findUniqueOrThrow({ where: { dedupeKey: k } })).status;
    expect(await byKey('a')).toBe('pendiente');
    expect(await byKey('b')).toBe('error');
    expect(await byKey('c')).toBe('procesando');
    expect(fresh).toHaveLength(1);
  });
});
