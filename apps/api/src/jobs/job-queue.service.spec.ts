import { JobQueueService } from './job-queue.service';
import { JobRecord } from './job-handler.interface';
import { PrismaService } from '../prisma/prisma.service';

function setup() {
  const prisma = {
    job: { update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const queue = new JobQueueService(prisma as unknown as PrismaService);
  queue.options = {
    backoffBaseMs: 1000,
    backoffMaxMs: 60_000,
    defaultMaxAttempts: 3,
  };
  return { prisma, queue };
}

const job = (attempts: number, max = 3): JobRecord => ({
  id: 'j1',
  type: 't',
  payload: {},
  attempts,
  maxAttempts: max,
  dedupeKey: null,
});

describe('JobQueueService (reintentos)', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('reprograma con backoff exponencial mientras queden intentos', async () => {
    const { prisma, queue } = setup();
    expect(await queue.fail(job(1), new Error('x'), now)).toBe(false);
    expect(await queue.fail(job(2), new Error('x'), now)).toBe(false);
    const [first, second] = prisma.job.update.mock.calls.map(
      (c: [{ data: { status: string; runAt: Date } }]) => c[0].data,
    );
    expect(first.status).toBe('pendiente');
    expect(first.runAt.getTime() - now.getTime()).toBe(1000);
    expect(second.runAt.getTime() - now.getTime()).toBe(2000);
  });

  it('al agotar intentos queda en error y avisa que es definitivo', async () => {
    const { prisma, queue } = setup();
    expect(await queue.fail(job(3), new Error('boom'), now)).toBe(true);
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { status: 'error', lockedAt: null, lastError: 'boom' },
    });
  });

  it('claim con límite 0 no consulta la BD', async () => {
    const { prisma, queue } = setup();
    expect(await queue.claim(0)).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('recoverStale devuelve los trabajos que pasaron a error', async () => {
    const { prisma, queue } = setup();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'a',
        type: 'process_thread',
        payload: { threadId: 't' },
        attempts: 5,
        maxAttempts: 5,
        dedupeKey: null,
      },
    ]);
    prisma.$executeRaw.mockResolvedValue(2);
    const r = await queue.recoverStale(1000, now);
    expect(r.requeued).toBe(2);
    expect(r.failed.map((j) => j.id)).toEqual(['a']);
  });
});
