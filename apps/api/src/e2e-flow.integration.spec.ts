import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';
import { GraphService } from './mail/graph.service';
import { MailSyncService } from './mail/mail-sync.service';
import { JobQueueService } from './jobs/job-queue.service';
import { JobWorkerService } from './jobs/job-worker.service';
import { PipelineService } from './jobs/pipeline.service';
import { ThreadStateService } from './jobs/thread-state.service';
import {
  ATTACHMENT_PROCESSOR,
  THREAD_SYNTHESIZER,
} from './jobs/pipeline-hooks.interface';
import { OcrService } from './ocr/ocr.service';
import { PdfExtractClientService } from './ocr/pdf-extract-client.service';
import { PdfRasterizerService } from './ocr/pdf-rasterizer.service';
import { OcrSettingsService } from './settings/ocr-settings.service';
import { TemplateInstructionsService } from './templates/template-instructions.service';
import { VisionRetryService } from './ocr/vision-retry.service';
import { OCR_ENGINE } from './ocr/ocr-engine.interface';
import type { OcrEngine } from './ocr/ocr-engine.interface';
import { AiSettingsService } from './settings/ai-settings.service';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import type { LlmProvider } from './llm/llm-provider.interface';
import { SynthesisService } from './synthesis/synthesis.service';
import { TemplatesService } from './templates/templates.service';
import { ReviewService } from './review/review.service';
import { ReportsService } from './reports/reports.service';
import { GeneratorService } from './reports/generator.service';
import { EventsService } from './events/events.service';
import { msg, pdfAtt } from './mail/fixtures/graph.fixtures';
import type { GraphMessage } from './mail/graph-mapper';

/**
 * Flujo completo sin red: sync (Graph falso) -> sin_analizar -> analyze -> OCR falso ->
 * síntesis (LLM falso) -> corrección de región -> síntesis incremental con un mensaje nuevo.
 * Usa los servicios REALES de Nest y PostgreSQL REAL en un esquema aislado: solo corre con
 * TEST_DATABASE_URL (lo prepara `pnpm --filter api test:e2e-flow`, que crea y borra el esquema).
 * Rasterizado real con pdfjs: requiere NODE_OPTIONS=--experimental-vm-modules.
 */
const url = process.env.TEST_DATABASE_URL;
const vm = (process.env.NODE_OPTIONS ?? '').includes('experimental-vm-modules');
const d = url && vm ? describe : describe.skip;

async function samplePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 150]).drawText(text, { x: 10, y: 70, size: 14, font });
  return Buffer.from(await doc.save());
}

class FakeStorage {
  files = new Map<string, Uint8Array>();
  put(key: string, body: Uint8Array) {
    this.files.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    const f = this.files.get(key);
    if (!f) return Promise.reject(new Error('no existe'));
    return Promise.resolve(f);
  }
  copy(src: string, dst: string) {
    this.files.set(dst, this.files.get(src)!);
    return Promise.resolve();
  }
  exists(key: string) {
    return Promise.resolve(this.files.has(key));
  }
  isHealthy() {
    return Promise.resolve(true);
  }
}

class FakeGraph {
  inbox: GraphMessage[] = [];
  attachments = new Map<string, { id: string; bytes: Buffer }[]>();
  async *deltaMessages(folder: string) {
    const messages = folder === 'inbox' ? this.inbox.splice(0) : [];
    await Promise.resolve();
    yield { messages, deltaLink: `delta-${folder}` };
  }
  listAttachments(graphId: string) {
    return Promise.resolve(
      (this.attachments.get(graphId) ?? []).map((a) => pdfAtt(a.id)),
    );
  }
  downloadAttachment(graphId: string, attId: string) {
    return Promise.resolve(
      this.attachments.get(graphId)!.find((a) => a.id === attId)!.bytes,
    );
  }
}

d('Flujo completo con mocks (sync -> OCR -> síntesis -> corrección)', () => {
  const graph = new FakeGraph();
  const storage = new FakeStorage();
  const ocrCalls: number[] = [];
  const llmPrompts: string[] = [];
  const reportPrompts: string[] = [];
  let prisma: PrismaService;
  let sync: MailSyncService;
  let pipeline: PipelineService;
  let review: ReviewService;
  let reports: ReportsService;
  let events: EventsService;
  let worker: JobWorkerService;
  let queue: JobQueueService;
  let close: () => Promise<void>;

  // OCR falso: una línea segura y una dudosa (confianza 0.4, bajo el umbral 0.85).
  const ocrEngine: OcrEngine = {
    name: 'mock',
    recognize: (_img, pageNumber) => {
      ocrCalls.push(pageNumber);
      const box = { x: 0.1, w: 0.5, h: 0.1 };
      return Promise.resolve({
        pageNumber,
        words: [],
        lines: [
          {
            text: 'Hemoglobina 13.2',
            confidence: 0.98,
            box: { ...box, y: 0.2 },
          },
          { text: 'Glucosa ??', confidence: 0.4, box: { ...box, y: 0.5 } },
        ],
      });
    },
  };
  let n = 0;
  const llm: LlmProvider = {
    modelFor: (task) =>
      Promise.resolve(
        task === 'vision' || task === 'vision_respaldo'
          ? 'mock-vision'
          : 'mock-text',
      ),
    complete: () => Promise.resolve(''),
    vision: () => Promise.resolve('{"text":"x","confidence":0.1}'),
    text: (_system, user) => {
      if (user.includes('Devuelve un JSON con esta forma exacta')) {
        reportPrompts.push(user);
        return Promise.resolve(
          JSON.stringify({
            estado: 'hospitalizado',
            novedad_texto: 'Resultados de laboratorio recibidos',
            columnas: {
              Paciente: 'Paciente de prueba',
              Hospital: 'Hospital X',
            },
          }),
        );
      }
      llmPrompts.push(user);
      return Promise.resolve(`# Síntesis mock ${++n}\n\nContenido.`);
    },
  };

  const cfg: Record<string, string> = {
    JOBS_ENABLED: 'false', // el worker se maneja a mano con tick()
    OCR_RENDER_DPI: '72',
    OCR_CONFIDENCE_THRESHOLD: '0.85',
    JOBS_BACKOFF_BASE_SEC: '0',
    PDF_TEXT_MODE: 'off', // sin red: todas las páginas pasan por el OCR simulado
  };

  beforeAll(async () => {
    prisma = new PrismaService({ getOrThrow: () => url } as never);
    await prisma.onModuleInit();
    const mod = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: { get: (k: string, def?: unknown) => cfg[k] ?? def },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: OcrSettingsService,
          useValue: {
            getEffective: () =>
              Promise.resolve({
                visionRetry: false,
                visionMaxRegions: 30,
                renderDpi: 250,
              }),
          },
        },
        { provide: StorageService, useValue: storage },
        { provide: GraphService, useValue: graph },
        SchedulerRegistry,
        MailSyncService,
        JobQueueService,
        JobWorkerService,
        ThreadStateService,
        PipelineService,
        PdfRasterizerService,
        TemplateInstructionsService,
        VisionRetryService,
        PdfExtractClientService,
        OcrService,
        TemplatesService,
        SynthesisService,
        ReviewService,
        ReportsService,
        GeneratorService,
        EventsService,
        { provide: OCR_ENGINE, useValue: ocrEngine },
        { provide: LLM_PROVIDER, useValue: llm },
        {
          provide: AiSettingsService,
          useValue: {
            getEffective: () => Promise.resolve({ maxInputTokens: 60000 }),
          },
        },
        { provide: ATTACHMENT_PROCESSOR, useExisting: OcrService },
        { provide: THREAD_SYNTHESIZER, useExisting: SynthesisService },
      ],
    }).compile();
    await mod.init();
    sync = mod.get(MailSyncService);
    pipeline = mod.get(PipelineService);
    review = mod.get(ReviewService);
    reports = mod.get(ReportsService);
    events = mod.get(EventsService);
    worker = mod.get(JobWorkerService);
    queue = mod.get(JobQueueService);
    await prisma.mailAccount.create({
      data: { email: 'yo@x.com', tokenEnc: 'cifrado-falso' },
    });
    close = async () => {
      await mod.close();
    };
  });

  afterAll(async () => {
    await close?.();
  });

  /** Procesa la cola hasta vaciarla (con el worker apagado, a mano). */
  async function drain() {
    for (let i = 0; i < 40; i++) {
      const ran = await worker.tick(new Date(Date.now() + 1000));
      await worker.idle();
      const open = await prisma.job.count({
        where: { status: { in: ['pendiente', 'procesando'] } },
      });
      if (ran === 0 && open === 0) return;
    }
    throw new Error('La cola no se vació');
  }

  it('recorre todo el flujo y respeta "análisis solo bajo petición"', async () => {
    void queue;
    const pdf = await samplePdf('Resultado de laboratorio');
    graph.inbox.push(
      msg('m1', 'C1', {
        hasAttachments: true,
        body: { contentType: 'text', content: 'cuerpo-uno' },
      }),
    );
    graph.attachments.set('m1', [{ id: 'a1', bytes: pdf }]);

    // 1. sync: el hilo queda sin_analizar, sin OCR ni LLM.
    const r = await sync.syncNow();
    expect(r.error).toBeUndefined();
    expect(r.newMessages).toBe(1);
    const thread = await prisma.thread.findFirstOrThrow();
    expect(thread.status).toBe('sin_analizar');
    await drain();
    expect(ocrCalls).toHaveLength(0);
    expect(llmPrompts).toHaveLength(0);
    expect(storage.files.size).toBe(1); // solo el PDF, sin páginas rasterizadas
    expect([...storage.files.keys()]).toEqual([
      `hilos/${thread.id}/pdf_1/original.pdf`,
    ]);

    // 2. analizar: OCR mock + síntesis mock; una duda -> necesita_revision.
    await pipeline.analyze(thread.id);
    await drain();
    expect(ocrCalls).toEqual([1]);
    expect(llmPrompts).toHaveLength(1);
    let t = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(t.status).toBe('necesita_revision');
    let syn = await prisma.synthesis.findMany({
      where: { threadId: thread.id },
      orderBy: { version: 'asc' },
    });
    expect(syn).toHaveLength(1);
    expect(syn[0].mode).toBe('full');
    const doubtful = await prisma.ocrRegion.findMany({
      where: { status: 'dudoso' },
    });
    expect(doubtful).toHaveLength(1);

    // 3. corregir la región: sin dudas -> listo; síntesis incremental con la corrección.
    const res = await review.correctRegion(doubtful[0].id, 'Glucosa 95 mg/dL');
    expect(res.hilosReencolados).toEqual([thread.id]);
    await drain();
    t = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(t.status).toBe('listo');
    syn = await prisma.synthesis.findMany({
      where: { threadId: thread.id },
      orderBy: { version: 'asc' },
    });
    expect(syn.map((s) => s.mode)).toEqual(['full', 'incremental']);
    expect(llmPrompts).toHaveLength(2);
    expect(llmPrompts[1]).toContain('Glucosa 95 mg/dL');
    expect(llmPrompts[1]).toContain('Síntesis mock 1'); // parte de la síntesis previa
    expect(ocrCalls).toHaveLength(1); // no se repite el OCR

    // 4. mensaje nuevo: marca tieneMensajesNuevos; no se analiza solo.
    graph.inbox.push(
      msg('m2', 'C1', {
        receivedDateTime: '2026-10-02T10:00:00Z',
        body: { contentType: 'text', content: 'cuerpo-dos' },
      }),
    );
    await sync.syncNow();
    await drain();
    t = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(t.tieneMensajesNuevos).toBe(true);
    expect(llmPrompts).toHaveLength(2);

    // 5. analizar de nuevo: incremental, solo con el mensaje nuevo (no reenvía el viejo).
    await pipeline.analyze(thread.id);
    await drain();
    expect(llmPrompts).toHaveLength(3);
    expect(llmPrompts[2]).toContain('cuerpo-dos');
    expect(llmPrompts[2]).not.toContain('cuerpo-uno');
    expect(ocrCalls).toHaveLength(1);
    syn = await prisma.synthesis.findMany({
      where: { threadId: thread.id },
      orderBy: { version: 'asc' },
    });
    expect(syn.map((s) => s.mode)).toEqual([
      'full',
      'incremental',
      'incremental',
    ]);
    t = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(t.status).toBe('listo');
  });

  it('reporte diario: usa la síntesis vigente, no dispara análisis y se puede descargar', async () => {
    const before = {
      llm: llmPrompts.length,
      ocr: ocrCalls.length,
      syn: await prisma.synthesis.count(),
    };
    // un segundo hilo sin analizar no entra en el reporte ni se procesa
    const t2 = await prisma.thread.create({
      data: {
        accountId: (await prisma.mailAccount.findFirstOrThrow()).id,
        conversationId: 'C2',
        subject: 'Hilo sin analizar',
      },
    });

    const { reporte, reutilizado } = await reports.createManual();
    expect(reutilizado).toBe(false);
    expect((await reports.createManual()).reporte.id).toBe(reporte.id);
    await drain();

    const done = await reports.detail(reporte.id);
    expect(done.status).toBe('listo');
    expect(done.progreso).toEqual({ procesados: 1, total: 1 });
    expect(done.totales).toMatchObject({
      hospitalizados: 1,
      conNovedad: 1,
      altas: 0,
    });
    expect(done.totales).not.toHaveProperty('sinAnalizar');
    expect(done.filasConNovedad[0].datos.Paciente).toBe('Paciente de prueba');
    // una sola llamada de extracción, con la síntesis vigente y sin correos del hilo
    expect(reportPrompts).toHaveLength(1);
    expect(reportPrompts[0]).toContain('Síntesis mock');
    expect(reportPrompts[0]).not.toContain('cuerpo-dos');
    // ningún análisis nuevo
    expect(llmPrompts).toHaveLength(before.llm);
    expect(ocrCalls).toHaveLength(before.ocr);
    expect(await prisma.synthesis.count()).toBe(before.syn);
    expect(
      (await prisma.thread.findUniqueOrThrow({ where: { id: t2.id } })).status,
    ).toBe('sin_analizar');

    const file = await reports.download(reporte.id);
    expect(file.getHeaders().type).toContain('spreadsheetml');
    expect(
      [...storage.files.keys()].some((k) => k.startsWith('reportes/')),
    ).toBe(true);

    // segundo reporte del mismo día: misma síntesis => caché, sin otra llamada al LLM
    await reports.createManual();
    await drain();
    expect(reportPrompts).toHaveLength(1);
  });

  it('eventos: borrador con la síntesis vigente (sin guardar), alta única, Excel con hoja Eventos y baja', async () => {
    const thread = await prisma.thread.findFirstOrThrow({
      where: { conversationId: { not: 'C2' } },
    });
    const before = {
      llm: llmPrompts.length,
      ocr: ocrCalls.length,
      syn: await prisma.synthesis.count(),
      rep: reportPrompts.length,
    };
    const draft = await events.draft(thread.id);
    expect(reportPrompts).toHaveLength(before.rep + 1);
    expect(reportPrompts[before.rep]).toContain('Síntesis mock');
    expect(reportPrompts[before.rep]).not.toContain('cuerpo-dos');
    expect(await prisma.hospitalEvent.count()).toBe(0); // el borrador no guarda
    expect(draft.yaRegistrado).toBeNull();
    expect(draft.datos.Paciente).toBe('Paciente de prueba');

    const ev = await events.create(thread.id, {
      synthesisId: draft.synthesisId,
      datos: draft.datos,
      estado: draft.estado,
      novedadTexto: draft.novedadTexto,
      fechaEvento: draft.fechaEvento,
    });
    expect(ev.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(
      events.create(thread.id, {
        synthesisId: draft.synthesisId,
        datos: draft.datos,
        estado: draft.estado,
        fechaEvento: draft.fechaEvento,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await events.list(thread.id)).eventos).toHaveLength(1);

    const { reporte } = await reports.createManual();
    await drain();
    const keys = [...storage.files.keys()].filter((k) =>
      k.startsWith('reportes/'),
    );
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const last = storage.files.get(keys[keys.length - 1])!;
    await wb.xlsx.load(last as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Eventos')!.rowCount).toBe(2);
    expect(reporte.id).toBeTruthy();

    // ni OCR, ni síntesis, ni LLM de análisis
    expect(llmPrompts).toHaveLength(before.llm);
    expect(ocrCalls).toHaveLength(before.ocr);
    expect(await prisma.synthesis.count()).toBe(before.syn);

    await events.remove(ev.id);
    expect((await events.list(thread.id)).eventos).toHaveLength(0);
  });
});
