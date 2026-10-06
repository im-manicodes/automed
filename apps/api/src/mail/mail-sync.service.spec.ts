import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DeltaExpiredError, GraphService } from './graph.service';
import { MailSyncService } from './mail-sync.service';
import { msg, pdfAtt } from './fixtures/graph.fixtures';

/** Prisma en memoria con solo lo que usa MailSyncService. */
function fakePrisma() {
  let n = 0;
  const id = () => `id${++n}`;
  const db = {
    account: {
      id: 'acc',
      email: 'yo@x.com',
      tokenEnc: 'enc',
      lastSyncAt: null as Date | null,
    },
    folders: {} as Record<string, string | null>,
    threads: [] as any[],
    messages: [] as any[],
    attachments: [] as any[],
  };
  const prisma = {
    mailAccount: {
      findFirst: async () => db.account,
      update: async ({ data }: any) => Object.assign(db.account, data),
    },
    mailFolderSync: {
      findUnique: async ({ where }: any) => {
        const f = where.accountId_folder.folder;
        return f in db.folders ? { folder: f, deltaLink: db.folders[f] } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const f = where.accountId_folder.folder;
        db.folders[f] = (f in db.folders ? update : create).deltaLink;
      },
    },
    thread: {
      upsert: async ({ where, create }: any) => {
        const k = where.accountId_conversationId;
        let t = db.threads.find(
          (x) =>
            x.accountId === k.accountId &&
            x.conversationId === k.conversationId,
        );
        if (!t)
          db.threads.push(
            (t = {
              id: id(),
              status: 'sin_analizar',
              seguimiento: false,
              tieneMensajesNuevos: false,
              syntheses: 0,
              ...create,
            }),
          );
        return t;
      },
      findUnique: async ({ where }: any) => {
        const t = db.threads.find((x) => x.id === where.id);
        return t ? { ...t, _count: { syntheses: t.syntheses } } : null;
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          db.threads.find((t) => t.id === where.id),
          data,
        ),
    },
    message: {
      findUnique: async ({ where }: any) =>
        db.messages.find((m) => m.graphId === where.graphId) ?? null,
      create: async ({ data }: any) => {
        const m = { id: id(), ...data };
        db.messages.push(m);
        return m;
      },
    },
    attachment: {
      findFirst: async ({ where }: any) =>
        db.attachments.find((a) =>
          Object.entries(where).every(([k, v]) => a[k] === v),
        ) ?? null,
      findMany: async ({ where }: any) => {
        const ids = db.messages
          .filter((m) => m.threadId === where.message.threadId)
          .map((m) => m.id);
        return db.attachments.filter((a) => ids.includes(a.messageId));
      },
      create: async ({ data }: any) => {
        const a = { id: id(), ...data };
        db.attachments.push(a);
        return a;
      },
    },
  };
  return { db, prisma: prisma as unknown as PrismaService };
}

const bytesOf = (s: string) => Buffer.from(s);
const sha = (s: string) =>
  createHash('sha256').update(bytesOf(s)).digest('hex');

function setup(graphOverrides: Partial<Record<keyof GraphService, any>> = {}) {
  const { db, prisma } = fakePrisma();
  const puts: string[] = [];
  const storage = {
    put: jest.fn(async (k: string) => {
      puts.push(k);
    }),
  } as unknown as StorageService;
  const graph = {
    deltaMessages: jest.fn(() => pages({ messages: [], deltaLink: 'sent0' })),
    listAttachments: jest.fn().mockResolvedValue([]),
    downloadAttachment: jest.fn(),
    ...graphOverrides,
  } as unknown as GraphService;
  const svc = new MailSyncService(
    { get: () => '5' } as unknown as ConfigService,
    prisma,
    graph,
    storage,
    {
      addInterval: jest.fn(),
      doesExist: () => false,
    } as unknown as SchedulerRegistry,
  );
  return { svc, db, graph: graph as any, puts, storage };
}

async function* pages(...p: any[]) {
  for (const x of p) yield x;
}

/** Inbox devuelve `inbox`; Enviados devuelve una página vacía con su propio deltaLink. */
function mockInbox(graph: any, inbox: any) {
  graph.deltaMessages.mockImplementation((folder: string) =>
    folder === 'inbox' ? inbox : pages({ messages: [], deltaLink: 'sent0' }),
  );
}
function mockInboxImpl(graph: any, make: () => any) {
  graph.deltaMessages.mockImplementation((folder: string) =>
    folder === 'inbox' ? make() : pages({ messages: [], deltaLink: 'sent0' }),
  );
}

describe('MailSyncService', () => {
  it('agrupa mensajes por conversationId en un Thread y guarda deltaLink', async () => {
    const { svc, db, graph } = setup();
    mockInbox(
      graph,
      pages(
        {
          messages: [
            msg('1', 'cA'),
            msg('2', 'cA', { receivedDateTime: '2026-10-02T10:00:00Z' }),
          ],
        },
        { messages: [msg('3', 'cB')], deltaLink: 'https://g/delta1' },
      ),
    );
    const r = await svc.syncNow();
    expect(r).toMatchObject({ started: true, messages: 3, newMessages: 3 });
    expect(db.threads).toHaveLength(2);
    expect(
      db.messages.filter((m) => m.threadId === db.threads[0].id),
    ).toHaveLength(2);
    expect(db.threads[0].lastMessageAt.toISOString()).toBe(
      '2026-10-02T10:00:00.000Z',
    );
    expect(db.folders.inbox).toBe('https://g/delta1');
  });

  it('es idempotente: repetir el mismo mensaje no duplica', async () => {
    const { svc, db, graph } = setup();
    mockInboxImpl(graph, () =>
      pages({ messages: [msg('1', 'c')], deltaLink: 'd' }),
    );
    await svc.syncNow();
    const r = await svc.syncNow();
    expect(r.newMessages).toBe(0);
    expect(db.messages).toHaveLength(1);
    expect(graph.deltaMessages).toHaveBeenCalledWith('inbox', 'd');
  });

  it('guarda todos los PDFs de un mensaje, ignora no-PDF y borradores', async () => {
    const { svc, db, graph, puts } = setup();
    mockInbox(
      graph,
      pages({
        messages: [
          msg('1', 'c', { hasAttachments: true }),
          msg('2', 'c', { isDraft: true }),
          msg('3', 'c', { '@removed': { reason: 'deleted' } }),
        ],
        deltaLink: 'd',
      }),
    );
    graph.listAttachments.mockResolvedValue([
      pdfAtt('a1', 'uno.pdf'),
      pdfAtt('a2', 'dos.pdf'),
      { id: 'a3', name: 'x.png', contentType: 'image/png' },
    ]);
    graph.downloadAttachment.mockImplementation(async (_m: string, a: string) =>
      bytesOf(`pdf-${a}`),
    );
    const r = await svc.syncNow();
    expect(r.attachments).toBe(2);
    expect(db.messages).toHaveLength(1);
    expect(db.attachments.map((a) => a.filename)).toEqual([
      'uno.pdf',
      'dos.pdf',
    ]);
    expect(db.attachments[0]).toMatchObject({
      sha256: sha('pdf-a1'),
      storageKey: `hilos/${db.threads[0].id}/pdf_1/original.pdf`,
    });
    expect(puts).toEqual([
      `hilos/${db.threads[0].id}/pdf_1/original.pdf`,
      `hilos/${db.threads[0].id}/pdf_2/original.pdf`,
    ]);
    expect(db.threads[0].status).toBe('sin_analizar');
    expect(db.threads[0].tieneMensajesNuevos).toBe(false);
  });

  it('mismo PDF reenviado: se guarda en su propia carpeta (pdf_n) y cuenta como dedupe de OCR', async () => {
    const { svc, db, graph, puts } = setup();
    mockInbox(
      graph,
      pages({
        messages: [
          msg('1', 'c', { hasAttachments: true }),
          msg('2', 'c', { hasAttachments: true }),
        ],
        deltaLink: 'd',
      }),
    );
    graph.listAttachments.mockImplementation(async (m: string) => [
      pdfAtt(`att-${m}`),
    ]);
    graph.downloadAttachment.mockResolvedValue(bytesOf('mismo contenido'));
    const r = await svc.syncNow();
    expect(db.attachments).toHaveLength(2); // una fila por mensaje
    expect(puts).toHaveLength(2); // cada adjunto vive en la carpeta de su hilo
    expect(r.deduped).toBe(1);
    expect(db.attachments[0].storageKey).toMatch(/\/pdf_1\/original\.pdf$/);
    expect(db.attachments[1].storageKey).toMatch(/\/pdf_2\/original\.pdf$/);
  });

  it('no re-descarga adjuntos ya guardados', async () => {
    const { svc, graph } = setup();
    mockInboxImpl(graph, () =>
      pages({
        messages: [msg('1', 'c', { hasAttachments: true })],
        deltaLink: 'd',
      }),
    );
    graph.listAttachments.mockResolvedValue([pdfAtt('a1')]);
    graph.downloadAttachment.mockResolvedValue(bytesOf('x'));
    await svc.syncNow();
    await svc.syncNow();
    expect(graph.downloadAttachment).toHaveBeenCalledTimes(1);
  });

  it('deltaLink expirado: reinicia con delta completo', async () => {
    const { svc, db, graph } = setup();
    db.folders.inbox = 'https://g/viejo';
    graph.deltaMessages
      .mockImplementationOnce(() =>
        (async function* () {
          throw new DeltaExpiredError('x');
          yield undefined;
        })(),
      )
      .mockImplementationOnce(() =>
        pages({ messages: [msg('1', 'c')], deltaLink: 'nuevo' }),
      );
    const r = await svc.syncNow();
    expect(r.resetDelta).toBe(true);
    expect(graph.deltaMessages).toHaveBeenCalledWith('inbox', null);
    expect(db.folders.inbox).toBe('nuevo');
  });

  it('sincroniza inbox y enviados en un mismo hilo, con isFromMe y deltaLink por carpeta', async () => {
    const { svc, db, graph } = setup();
    const mine = {
      from: { emailAddress: { name: 'Yo', address: 'YO@x.com' } },
      toRecipients: [
        { emailAddress: { name: 'Dra. Ana', address: 'ana@clinica.mx' } },
      ],
      receivedDateTime: undefined,
      sentDateTime: '2026-10-03T10:00:00Z',
    };
    graph.deltaMessages.mockImplementation((folder: string) =>
      folder === 'inbox'
        ? pages({ messages: [msg('in1', 'cA')], deltaLink: 'dIn' })
        : pages({
            messages: [
              msg('out1', 'cA', mine),
              msg('out2', 'cNuevo', { ...mine, subject: 'RE: nuevo' }),
            ],
            deltaLink: 'dSent',
          }),
    );
    const r = await svc.syncNow();
    expect(r.newMessages).toBe(3);
    expect(db.threads).toHaveLength(2); // el enviado crea ticket si no existía
    const a = db.threads.find((t) => t.conversationId === 'cA');
    const inA = db.messages.filter((m) => m.threadId === a.id);
    expect(inA.map((m) => [m.graphId, m.isFromMe])).toEqual([
      ['in1', false],
      ['out1', true],
    ]);
    expect(a.lastMessageAt.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    expect(db.folders).toEqual({ inbox: 'dIn', sentitems: 'dSent' });
    await svc.syncNow();
    expect(graph.deltaMessages).toHaveBeenCalledWith('inbox', 'dIn');
    expect(graph.deltaMessages).toHaveBeenCalledWith('sentitems', 'dSent');
  });

  it('adjuntos PDF de enviados: sha256 y dedupe contra el inbox', async () => {
    const { svc, db, graph, puts } = setup();
    graph.listAttachments.mockImplementation(async (m: string) => [
      pdfAtt(`att-${m}`),
    ]);
    graph.downloadAttachment.mockResolvedValue(bytesOf('igual'));
    graph.deltaMessages.mockImplementation((folder: string) =>
      pages({
        messages: [
          msg(folder === 'inbox' ? 'i' : 's', 'c', { hasAttachments: true }),
        ],
        deltaLink: 'd',
      }),
    );
    const r = await svc.syncNow();
    expect(db.attachments).toHaveLength(2);
    expect(db.attachments[1].sha256).toBe(sha('igual'));
    expect(puts).toHaveLength(2);
    expect(r.deduped).toBe(1);
  });

  it('no se solapa: segunda llamada concurrente no arranca', async () => {
    const { svc, graph } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockInboxImpl(graph, () =>
      (async function* () {
        await gate;
        yield { messages: [], deltaLink: 'd' };
      })(),
    );
    const first = svc.syncNow();
    await Promise.resolve();
    expect(svc.isRunning()).toBe(true);
    expect((await svc.syncNow()).started).toBe(false);
    release();
    expect((await first).started).toBe(true);
    expect(svc.isRunning()).toBe(false);
  });

  it('reporta error sin lanzar y libera el candado', async () => {
    const { svc, graph } = setup();
    mockInboxImpl(graph, () =>
      (async function* () {
        throw new Error('boom');
        yield undefined;
      })(),
    );
    const r = await svc.syncNow();
    expect(r.error).toBe('boom');
    expect(svc.isRunning()).toBe(false);
  });

  describe('mensajes nuevos según el estado del hilo', () => {
    const run = async (prep: (t: any) => void, id = '2') => {
      const x = setup();
      mockInboxImpl(x.graph, () =>
        pages({ messages: [msg('1', 'c')], deltaLink: 'd' }),
      );
      await x.svc.syncNow();
      prep(x.db.threads[0]);
      mockInboxImpl(x.graph, () =>
        pages({ messages: [msg(id, 'c')], deltaLink: 'd2' }),
      );
      await x.svc.syncNow();
      return x.db.threads[0];
    };

    it('hilo nuevo queda sin_analizar', async () => {
      const t = await run(() => undefined, '1');
      expect(t.status).toBe('sin_analizar');
    });
    it('mensaje nuevo en hilo nunca analizado sigue sin_analizar', async () => {
      const t = await run(() => undefined);
      expect(t).toMatchObject({
        status: 'sin_analizar',
        tieneMensajesNuevos: false,
      });
    });
    it('hilo analizado con seguimiento pasa a pendiente', async () => {
      const t = await run((th) => {
        th.status = 'listo';
        th.seguimiento = true;
      });
      expect(t.status).toBe('pendiente');
    });
    it('hilo analizado sin seguimiento conserva estado y marca tieneMensajesNuevos', async () => {
      const t = await run((th) => {
        th.status = 'listo';
      });
      expect(t).toMatchObject({ status: 'listo', tieneMensajesNuevos: true });
    });
    it('una síntesis previa cuenta como analizado', async () => {
      const t = await run((th) => {
        th.syntheses = 1;
        th.status = 'sin_analizar';
      });
      expect(t).toMatchObject({
        status: 'sin_analizar',
        tieneMensajesNuevos: true,
      });
    });
    it('nunca rasteriza ni llama a OCR/LLM: solo guarda PDFs', async () => {
      const { svc, graph, storage } = setup();
      mockInbox(
        graph,
        pages({
          messages: [msg('1', 'c', { hasAttachments: true })],
          deltaLink: 'd',
        }),
      );
      graph.listAttachments.mockResolvedValue([pdfAtt('a1')]);
      graph.downloadAttachment.mockResolvedValue(bytesOf('x'));
      await svc.syncNow();
      expect((storage as any).put).toHaveBeenCalledTimes(1);
      expect(Object.keys(svc)).not.toContain('pipeline');
    });
  });
});
