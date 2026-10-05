import { JobWorkerService } from './job-worker.service';
import { ConfigService } from '@nestjs/config';
import { JobQueueService } from './job-queue.service';
import { JobRecord } from './job-handler.interface';

const rec = (id: string, type = 't', attempts = 1, max = 3): JobRecord => ({
  id,
  type,
  payload: {},
  attempts,
  maxAttempts: max,
  dedupeKey: null,
});

function setup(claimed: JobRecord[][]) {
  const queue = {
    options: {},
    claim: jest.fn(async () => claimed.shift() ?? []),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn(async (j: JobRecord) => j.attempts >= j.maxAttempts),
    recoverStale: jest.fn().mockResolvedValue({ requeued: 0, failed: [] }),
  };
  const worker = new JobWorkerService(
    new ConfigService(),
    queue as unknown as JobQueueService,
  );
  return { queue, worker };
}

describe('JobWorkerService', () => {
  it('ejecuta handlers y completa; limita claim a la concurrencia libre', async () => {
    const { queue, worker } = setup([[rec('1'), rec('2')]]);
    worker.concurrency = 3;
    const handle = jest.fn().mockResolvedValue(undefined);
    worker.register('t', { handle });
    expect(await worker.tick()).toBe(2);
    expect(queue.claim).toHaveBeenCalledWith(3, expect.any(Date));
    await worker.idle();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(queue.complete).toHaveBeenCalledTimes(2);
  });

  it('un fallo reintenta; el definitivo invoca onFailed una vez', async () => {
    const { queue, worker } = setup([]);
    const onFailed = jest.fn().mockResolvedValue(undefined);
    worker.register('t', {
      handle: () => Promise.reject(new Error('x')),
      onFailed,
    });
    await worker.run(rec('1', 't', 1, 3));
    expect(onFailed).not.toHaveBeenCalled();
    await worker.run(rec('1', 't', 3, 3));
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it('tipo desconocido cuenta como fallo', async () => {
    const { queue, worker } = setup([]);
    await worker.run(rec('1', 'raro'));
    expect(queue.fail).toHaveBeenCalled();
  });

  it('al arrancar recupera locks vencidos y notifica los agotados', async () => {
    const { queue, worker } = setup([]);
    const onFailed = jest.fn().mockResolvedValue(undefined);
    worker.register('t', { handle: jest.fn(), onFailed });
    queue.recoverStale.mockResolvedValue({ requeued: 1, failed: [rec('9')] });
    await worker.recoverStale();
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
