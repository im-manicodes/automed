import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { ThreadStateService } from './thread-state.service';
import { JobRecord } from './job-handler.interface';

type St =
  | 'sin_analizar'
  | 'pendiente'
  | 'procesando'
  | 'listo'
  | 'necesita_revision'
  | 'error';
interface Th {
  id: string;
  status: St;
  contentHash?: string;
  seguimiento?: boolean;
  tieneMensajesNuevos?: boolean;
}
interface Msg {
  id: string;
  threadId: string;
  graphId: string;
  bodyText: string;
}
interface Att {
  id: string;
  messageId: string;
  sha256: string;
  status: St;
}

/** Mini BD en memoria con solo lo que usa el pipeline. */
function fakePrisma() {
  const db = {
    threads: [] as Th[],
    messages: [] as Msg[],
    atts: [] as Att[],
    doubtfulShas: new Set<string>(),
  };
  const threadOfAtt = (a: Att) =>
    db.messages.find((m) => m.id === a.messageId)!.threadId;
  const matchStatus = (s: St, f: any) =>
    f === undefined ||
    (typeof f === 'string'
      ? s === f
      : f.in
        ? f.in.includes(s)
        : !f.notIn.includes(s));
  const attMatch = (a: Att, w: any) =>
    (!w.id || (w.id.not ? a.id !== w.id.not : a.id === w.id)) &&
    (!w.sha256 || a.sha256 === w.sha256) &&
    matchStatus(a.status, w.status) &&
    (!w.message || threadOfAtt(a) === w.message.threadId);
  const prisma = {
    thread: {
      findUnique: async ({ where }: any) =>
        db.threads.find((t) => t.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        db.threads.filter((t) => {
          if (where.status && typeof where.status === 'string')
            return t.status === where.status;
          if (where.status?.in && !where.status.in.includes(t.status))
            return false;
          const sha = where.messages.some.attachments.some.sha256;
          return db.atts.some(
            (a) => a.sha256 === sha && threadOfAtt(a) === t.id,
          );
        }),
      updateMany: async ({ where, data }: any) => {
        const t = db.threads.find(
          (x) => x.id === where.id && x.status === where.status,
        );
        if (t) Object.assign(t, data);
        return { count: t ? 1 : 0 };
      },
    },
    message: {
      findMany: async ({ where }: any) =>
        db.messages
          .filter((m) => m.threadId === where.threadId)
          .map((m) => ({
            ...m,
            attachments: db.atts.filter((a) => a.messageId === m.id),
          })),
    },
    attachment: {
      findMany: async ({ where }: any) =>
        db.atts.filter((a) => attMatch(a, where)),
      findFirst: async ({ where }: any) =>
        db.atts.find((a) => attMatch(a, where)) ?? null,
      findUnique: async ({ where }: any) =>
        db.atts.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }: any) =>
        Object.assign(
          db.atts.find((a) => a.id === where.id)!,
          data,
        ),
      updateMany: async ({ where, data }: any) => {
        const xs = db.atts.filter((a) => attMatch(a, where));
        xs.forEach((a) => Object.assign(a, data));
        return { count: xs.length };
      },
      count: async ({ where }: any) =>
        db.atts.filter((a) => attMatch(a, where)).length,
    },
    ocrRegion: {
      count: async ({ where }: any) =>
        db.doubtfulShas.has(where.page.sha256 ?? where.page.attachment.sha256)
          ? 1
          : 0,
    },
  };
  return { db, prisma };
}

function setup() {
  const { db, prisma } = fakePrisma();
  const queued: { type: string; payload: any; opts: any }[] = [];
  const queue = {
    enqueue: jest.fn(async (type: string, payload: any, opts: any) => {
      queued.push({ type, payload, opts });
      return 'id';
    }),
  };
  const worker = { register: jest.fn(), addPeriodic: jest.fn() };
  const processor = { process: jest.fn().mockResolvedValue(undefined) };
  const synth = { synthesize: jest.fn().mockResolvedValue(undefined) };
  const pipeline = new PipelineService(
    prisma as any,
    queue as any,
    worker as any,
    new ThreadStateService(prisma as any),
    processor,
    synth,
  );
  const job = (payload: Record<string, unknown>): JobRecord => ({
    id: 'j',
    type: 'x',
    payload,
    attempts: 1,
    maxAttempts: 5,
    dedupeKey: null,
  });
  const addThread = (id: string, atts: [string, string][]) => {
    db.threads.push({ id, status: 'pendiente' });
    db.messages.push({
      id: `m-${id}`,
      threadId: id,
      graphId: `g-${id}`,
      bodyText: 'hola',
    });
    for (const [aid, sha] of atts)
      db.atts.push({
        id: aid,
        messageId: `m-${id}`,
        sha256: sha,
        status: 'pendiente',
      });
  };
  return { db, queued, queue, processor, synth, pipeline, job, addThread };
}

describe('PipelineService', () => {
  it('hilo sin adjuntos: procesando y encola síntesis; la síntesis lo deja listo', async () => {
    const s = setup();
    s.addThread('t1', []);
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    expect(s.db.threads[0].status).toBe('procesando');
    const synth = s.queued.find((q) => q.type === 'synthesize_thread')!;
    expect(synth).toBeDefined();
    await s.pipeline.synthesizeThread(s.job(synth.payload));
    expect(s.synth.synthesize).toHaveBeenCalledWith('t1', { force: false });
    expect(s.db.threads[0].status).toBe('listo');
    expect(s.db.threads[0].contentHash).toBe(synth.payload.hash);
  });

  it('encola un process_attachment por PDF (dedupe por sha256) y la síntesis solo al terminar todos', async () => {
    const s = setup();
    s.addThread('t1', [
      ['a1', 'shaA'],
      ['a2', 'shaB'],
    ]);
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    const pa = s.queued.filter((q) => q.type === 'process_attachment');
    expect(pa.map((q) => q.opts.dedupeKey)).toEqual([
      'process_attachment:shaA',
      'process_attachment:shaB',
    ]);
    expect(s.queued.some((q) => q.type === 'synthesize_thread')).toBe(false);

    await s.pipeline.processAttachment(s.job({ attachmentId: 'a1' }));
    expect(s.queued.some((q) => q.type === 'synthesize_thread')).toBe(false);
    await s.pipeline.processAttachment(s.job({ attachmentId: 'a2' }));
    expect(s.queued.filter((q) => q.type === 'synthesize_thread')).toHaveLength(
      1,
    );
    expect(s.db.atts.map((a) => a.status)).toEqual(['listo', 'listo']);
  });

  it('reutiliza el resultado de un adjunto con el mismo sha256 ya procesado', async () => {
    const s = setup();
    s.addThread('t1', [['a1', 'shaA']]);
    s.addThread('t2', [['a2', 'shaA']]);
    s.db.atts[0].status = 'listo';
    await s.pipeline.processThread(s.job({ threadId: 't2' }));
    expect(
      s.queued.filter((q) => q.type === 'process_attachment'),
    ).toHaveLength(0);
    expect(s.db.atts[1].status).toBe('listo');
    expect(s.queued.some((q) => q.type === 'synthesize_thread')).toBe(true);
    expect(s.processor.process).not.toHaveBeenCalled();
  });

  it('un PDF repetido en el mismo hilo se procesa una vez y se propaga', async () => {
    const s = setup();
    s.addThread('t1', [
      ['a1', 'shaA'],
      ['a2', 'shaA'],
    ]);
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    await s.pipeline.processAttachment(s.job({ attachmentId: 'a1' }));
    expect(s.db.atts.map((a) => a.status)).toEqual(['listo', 'listo']);
    expect(s.processor.process).toHaveBeenCalledTimes(1);
    expect(s.queued.filter((q) => q.type === 'synthesize_thread')).toHaveLength(
      1,
    );
  });

  it('regiones dudosas: adjunto y hilo quedan en necesita_revision', async () => {
    const s = setup();
    s.addThread('t1', [['a1', 'shaA']]);
    s.db.doubtfulShas.add('shaA');
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    await s.pipeline.processAttachment(s.job({ attachmentId: 'a1' }));
    expect(s.db.atts[0].status).toBe('necesita_revision');
    const synth = s.queued.find((q) => q.type === 'synthesize_thread')!;
    await s.pipeline.synthesizeThread(s.job(synth.payload));
    expect(s.db.threads[0].status).toBe('necesita_revision');
  });

  it('fallo definitivo de un adjunto lleva el hilo a error y no encola síntesis', async () => {
    const s = setup();
    s.addThread('t1', [['a1', 'shaA']]);
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    await s.pipeline.failAttachment('a1');
    expect(s.db.atts[0].status).toBe('error');
    expect(s.db.threads[0].status).toBe('error');
    expect(s.queued.some((q) => q.type === 'synthesize_thread')).toBe(false);
  });

  it('si llegó contenido nuevo durante el proceso (con seguimiento), el hilo vuelve a pendiente', async () => {
    const s = setup();
    s.addThread('t1', []);
    s.db.threads[0].seguimiento = true;
    await s.pipeline.processThread(s.job({ threadId: 't1' }));
    const synth = s.queued.find((q) => q.type === 'synthesize_thread')!;
    s.db.messages.push({
      id: 'm2',
      threadId: 't1',
      graphId: 'g2',
      bodyText: 'nuevo',
    });
    await s.pipeline.synthesizeThread(s.job(synth.payload));
    expect(s.db.threads[0].status).toBe('pendiente');
    expect(s.db.threads[0].contentHash).toBeUndefined();
  });

  it('el hash cambia con mensajes o adjuntos nuevos y es estable si no hay cambios', async () => {
    const s = setup();
    s.addThread('t1', [['a1', 'shaA']]);
    const h1 = await s.pipeline.computeThreadHash('t1');
    expect(await s.pipeline.computeThreadHash('t1')).toBe(h1);
    s.db.atts.push({
      id: 'a9',
      messageId: 'm-t1',
      sha256: 'shaZ',
      status: 'pendiente',
    });
    expect(await s.pipeline.computeThreadHash('t1')).not.toBe(h1);
  });

  it('enqueuePendingThreads usa dedupeKey por hash; reprocess reactiva (rearm)', async () => {
    const s = setup();
    s.addThread('t1', []);
    await s.pipeline.enqueuePendingThreads();
    const hash = await s.pipeline.computeThreadHash('t1');
    expect(s.queued[0].opts).toEqual({
      dedupeKey: `process_thread:t1:${hash}`,
    });
    s.db.threads[0].status = 'listo';
    await s.pipeline.reprocess('t1');
    expect(s.db.threads[0].status).toBe('pendiente');
    expect(s.queued[1].opts).toEqual({
      dedupeKey: `process_thread:t1:${hash}`,
      rearm: true,
    });
    s.db.threads[0].status = 'procesando';
    await expect(s.pipeline.reprocess('t1')).rejects.toThrow();
  });

  describe('análisis bajo petición', () => {
    it('el barrido solo recoge pendiente, nunca sin_analizar', async () => {
      const s = setup();
      s.addThread('t1', []);
      s.addThread('t2', []);
      s.db.threads[0].status = 'sin_analizar';
      await s.pipeline.enqueuePendingThreads();
      expect(s.queued.map((q) => q.payload.threadId)).toEqual(['t2']);
    });

    it('processThread no procesa un hilo sin_analizar', async () => {
      const s = setup();
      s.addThread('t1', [['a1', 'shaA']]);
      s.db.threads[0].status = 'sin_analizar';
      await s.pipeline.processThread(s.job({ threadId: 't1' }));
      expect(s.queued).toHaveLength(0);
      expect(s.db.threads[0].status).toBe('sin_analizar');
      expect(s.processor.process).not.toHaveBeenCalled();
    });

    it('analyze: sin_analizar -> pendiente, encola y guarda seguimiento', async () => {
      const s = setup();
      s.addThread('t1', []);
      Object.assign(s.db.threads[0], {
        status: 'sin_analizar',
        tieneMensajesNuevos: true,
      });
      const r = await s.pipeline.analyze('t1', { seguimiento: true });
      expect(r.status).toBe('pendiente');
      expect(s.db.threads[0]).toMatchObject({
        status: 'pendiente',
        seguimiento: true,
        tieneMensajesNuevos: false,
      });
      expect(s.queued[0].type).toBe('process_thread');
    });

    it('analyze: listo con mensajes nuevos y error sí; listo sin novedades no', async () => {
      const s = setup();
      s.addThread('t1', []);
      s.db.threads[0].status = 'listo';
      await expect(s.pipeline.analyze('t1')).rejects.toThrow(ConflictException);
      s.db.threads[0].tieneMensajesNuevos = true;
      await s.pipeline.analyze('t1');
      expect(s.db.threads[0].status).toBe('pendiente');
      s.db.threads[0].status = 'error';
      await s.pipeline.analyze('t1');
      expect(s.db.threads[0].status).toBe('pendiente');
    });

    it('analyze: 409 si procesando y 404 si no existe', async () => {
      const s = setup();
      s.addThread('t1', []);
      s.db.threads[0].status = 'procesando';
      await expect(s.pipeline.analyze('t1')).rejects.toThrow(ConflictException);
      await expect(s.pipeline.analyze('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('analyzeMany devuelve resultado por id sin detenerse en fallos', async () => {
      const s = setup();
      s.addThread('t1', []);
      s.addThread('t2', []);
      s.db.threads[0].status = 'sin_analizar';
      s.db.threads[1].status = 'procesando';
      const res = await s.pipeline.analyzeMany(['t1', 't2', 'zz', 't1']);
      expect(res).toEqual([
        { id: 't1', ok: true, status: 'pendiente' },
        { id: 't2', ok: false, error: expect.any(String) },
        { id: 'zz', ok: false, error: expect.any(String) },
      ]);
    });

    it('regenerate de síntesis exige análisis previo', async () => {
      const s = setup();
      s.addThread('t1', []);
      s.db.threads[0].status = 'sin_analizar';
      await expect(s.pipeline.regenerateSynthesis('t1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('onRegionsChanged no toca hilos sin_analizar y sí los analizados', async () => {
      const s = setup();
      s.addThread('t1', [['a1', 'shaA']]);
      s.addThread('t2', [['a2', 'shaA']]);
      s.db.threads[0].status = 'sin_analizar';
      s.db.threads[1].status = 'listo';
      const queued = await s.pipeline.onRegionsChanged('shaA');
      expect(queued).toEqual(['t2']);
      expect(s.db.threads[0].status).toBe('sin_analizar');
      expect(s.queued.map((q) => q.payload.threadId)).toEqual(['t2']);
    });

    it('contenido nuevo durante el análisis: con seguimiento reanaliza, sin él marca tieneMensajesNuevos', async () => {
      for (const seg of [true, false]) {
        const s = setup();
        s.addThread('t1', []);
        s.db.threads[0].seguimiento = seg;
        await s.pipeline.processThread(s.job({ threadId: 't1' }));
        const synth = s.queued.find((q) => q.type === 'synthesize_thread')!;
        s.db.messages.push({
          id: 'm2',
          threadId: 't1',
          graphId: 'g2',
          bodyText: 'nuevo',
        });
        await s.pipeline.synthesizeThread(s.job(synth.payload));
        if (seg) expect(s.db.threads[0].status).toBe('pendiente');
        else
          expect(s.db.threads[0]).toMatchObject({
            status: 'listo',
            tieneMensajesNuevos: true,
          });
      }
    });
  });

  it('migración de datos: pendiente sin síntesis -> sin_analizar (lógica SQL)', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261007100100_sin_analizar_datos/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/SET "status" = 'sin_analizar'/);
    expect(sql).toMatch(/"status" = 'pendiente'/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "Synthesis"/);
    expect(sql).toMatch(/SET DEFAULT 'sin_analizar'/);
    // simula la regla sobre filas
    const migrate = (t: { status: string; syntheses: number }) =>
      t.status === 'pendiente' && t.syntheses === 0 ? 'sin_analizar' : t.status;
    expect(migrate({ status: 'pendiente', syntheses: 0 })).toBe('sin_analizar');
    expect(migrate({ status: 'pendiente', syntheses: 2 })).toBe('pendiente');
    expect(migrate({ status: 'listo', syntheses: 0 })).toBe('listo');
  });
});
