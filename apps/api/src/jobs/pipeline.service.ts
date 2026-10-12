import {
  ConflictException,
  Logger,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ownPageKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { JOB_TYPES, JobRecord } from './job-handler.interface';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import {
  ATTACHMENT_PROCESSOR,
  THREAD_SYNTHESIZER,
} from './pipeline-hooks.interface';
import type {
  AttachmentProcessor,
  ThreadSynthesizer,
} from './pipeline-hooks.interface';
import { ThreadStateService } from './thread-state.service';
import type { ProcessStatus } from '../generated/prisma/client';

const DONE: ProcessStatus[] = ['listo', 'necesita_revision'];
const isDone = (s: ProcessStatus) => DONE.includes(s);
const reanalyzeKey = (threadId: string) => `reanalyze:${threadId}`;
/** Sub-etapa de progreso (escrita por OcrService, sin contenido). */
const progressKey = (threadId: string) => `progress:${threadId}`;
/** PDFs cuya revisión manual el usuario decidió omitir para este hilo ({ shas: string[] }). */
const reviewSkipKey = (threadId: string) => `review-skip:${threadId}`;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Orquestador: process_thread -> N x process_attachment -> synthesize_thread.
 * Los trabajos son idempotentes (dedupeKey por hash de contenido / sha256 del PDF).
 */
@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: JobQueueService,
    private readonly worker: JobWorkerService,
    private readonly state: ThreadStateService,
    @Inject(ATTACHMENT_PROCESSOR)
    private readonly processor: AttachmentProcessor,
    @Inject(THREAD_SYNTHESIZER) private readonly synthesizer: ThreadSynthesizer,
  ) {}

  onModuleInit() {
    this.worker.register(JOB_TYPES.processThread, {
      handle: (j) => this.processThread(j),
      onFailed: (j) => this.failThread(str(j.payload.threadId)),
    });
    this.worker.register(JOB_TYPES.processAttachment, {
      handle: (j) => this.processAttachment(j),
      onFailed: (j) => this.failAttachment(str(j.payload.attachmentId)),
    });
    this.worker.register(JOB_TYPES.synthesizeThread, {
      handle: (j) => this.synthesizeThread(j),
      onFailed: (j) => this.failThread(str(j.payload.threadId)),
    });
    // Este barrido solo recoge hilos 'pendiente' (los que el usuario pidió analizar o con
    // seguimiento). Un hilo 'sin_analizar' NUNCA se recoge.
    this.worker.addPeriodic(() => this.enqueuePendingThreads());
  }

  /** Hash de contenido del hilo: mensajes (id + cuerpo) y sha256 de adjuntos. */
  async computeThreadHash(threadId: string): Promise<string> {
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      select: {
        graphId: true,
        bodyText: true,
        attachments: { select: { sha256: true } },
      },
    });
    const parts = messages
      .map(
        (m) =>
          `${m.graphId}:${createHash('sha256').update(m.bodyText).digest('hex')}:` +
          m.attachments
            .map((a) => a.sha256)
            .sort()
            .join(','),
      )
      .sort();
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /** Encola process_thread para cada Thread 'pendiente' (idempotente por hash). */
  async enqueuePendingThreads(): Promise<number> {
    const pending = await this.prisma.thread.findMany({
      where: { status: 'pendiente' },
      select: { id: true },
    });
    let n = 0;
    for (const t of pending) {
      const hash = await this.computeThreadHash(t.id);
      const id = await this.queue.enqueue(
        JOB_TYPES.processThread,
        { threadId: t.id },
        { dedupeKey: `process_thread:${t.id}:${hash}` },
      );
      if (id) n++;
    }
    return n;
  }

  /**
   * Analiza un hilo bajo petición del usuario: sin_analizar | listo/necesita_revision con
   * mensajes nuevos | error -> pendiente (y se encola el proceso). 409 si ya se procesa o no
   * hay nada que analizar.
   */
  async analyze(threadId: string, opts: { seguimiento?: boolean } = {}) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true, tieneMensajesNuevos: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'procesando' || t.status === 'pendiente')
      throw new ConflictException('El ticket ya se está procesando');
    const canAnalyze =
      t.status === 'sin_analizar' ||
      t.status === 'error' ||
      ((t.status === 'listo' || t.status === 'necesita_revision') &&
        t.tieneMensajesNuevos);
    if (!canAnalyze)
      throw new ConflictException(
        'El ticket ya está analizado y no tiene mensajes nuevos',
      );
    // Los adjuntos con error se reintentan; los ya procesados se reutilizan.
    await this.prisma.attachment.updateMany({
      where: { message: { threadId }, status: 'error' },
      data: { status: 'pendiente' },
    });
    return this.startAnalysis(threadId, opts.seguimiento);
  }

  /** Analiza varios hilos; devuelve el resultado por id (un fallo no detiene a los demás). */
  async analyzeMany(ids: string[], opts: { seguimiento?: boolean } = {}) {
    const results: {
      id: string;
      ok: boolean;
      status?: ProcessStatus;
      error?: string;
    }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const r = await this.analyze(id, opts);
        results.push({ id, ok: true, status: r.status });
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: e instanceof Error ? e.message : 'Error desconocido',
        });
      }
    }
    return results;
  }

  private async startAnalysis(
    threadId: string,
    seguimiento: boolean | undefined,
  ) {
    const ok = await this.state.transition(threadId, 'pendiente', {
      tieneMensajesNuevos: false,
      ...(seguimiento === undefined ? {} : { seguimiento }),
    });
    if (!ok)
      throw new ConflictException(
        'El ticket cambió de estado, intenta de nuevo',
      );
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.processThread,
      { threadId },
      { dedupeKey: `process_thread:${threadId}:${hash}`, rearm: true },
    );
    return { threadId, status: 'pendiente' as const };
  }

  /** Vuelve a procesar el hilo desde cero (adjuntos/OCR y síntesis COMPLETA). Acción explícita del usuario. */
  async reprocess(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'procesando')
      throw new ConflictException('El ticket ya se está procesando');
    // Marca para que la síntesis de esta pasada sea COMPLETA (re-lee todo el hilo).
    const key = reanalyzeKey(threadId);
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: { full: true } },
      update: { value: { full: true } },
    });
    // El OCR se reutiliza por sha256: para releer los PDFs se borra el guardado (las regiones
    // caen en cascada). Los gemelos de otros hilos vuelven a pendiente y se restauran al terminar.
    const shas = [
      ...new Set(
        (
          await this.prisma.attachment.findMany({
            where: { message: { threadId } },
            select: { sha256: true },
          })
        ).map((a) => a.sha256),
      ),
    ];
    await this.prisma.ocrPage.deleteMany({ where: { sha256: { in: shas } } });
    await this.prisma.setting.deleteMany({
      where: { key: reviewSkipKey(threadId) },
    });
    await this.prisma.attachment.updateMany({
      where: { sha256: { in: shas } },
      data: { status: 'pendiente' },
    });
    await this.state.transition(threadId, 'pendiente', {
      tieneMensajesNuevos: false,
    });
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.processThread,
      { threadId },
      { dedupeKey: `process_thread:${threadId}:${hash}`, rearm: true },
    );
    return { threadId, status: 'pendiente' as const };
  }

  /**
   * Re-analiza SOLO el último correo del hilo (acción explícita): vuelve a pasar por OCR los
   * adjuntos de ese correo y genera una versión INCREMENTAL de la síntesis con ese correo tratado
   * como nuevo (síntesis previa + ese correo + OCR de sus adjuntos; nunca el hilo completo). Sin
   * síntesis previa utilizable la síntesis cae al modo completo. Pasa por pendiente -> procesando.
   * Nota: un PDF idéntico ya procesado en OTRO hilo se reutiliza (mismo sha256, mismo OCR).
   */
  async reanalyzeLast(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'procesando' || t.status === 'pendiente')
      throw new ConflictException('El ticket ya se está procesando');
    const last = await this.prisma.message.findFirst({
      where: { threadId },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, attachments: { select: { sha256: true } } },
    });
    if (!last) throw new ConflictException('El ticket no tiene correos');
    const key = reanalyzeKey(threadId);
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: { messageId: last.id } },
      update: { value: { messageId: last.id } },
    });
    // Se reinician los adjuntos con esos sha256 del hilo para que el OCR se haga otra vez.
    const shas = [...new Set(last.attachments.map((a) => a.sha256))];
    if (shas.length)
      await this.prisma.attachment.updateMany({
        where: { message: { threadId }, sha256: { in: shas } },
        data: { status: 'pendiente' },
      });
    if (
      !(await this.state.transition(threadId, 'pendiente', {
        tieneMensajesNuevos: false,
      }))
    ) {
      await this.prisma.setting.deleteMany({ where: { key } });
      throw new ConflictException(
        'El ticket cambió de estado, intenta de nuevo',
      );
    }
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.processThread,
      { threadId },
      {
        dedupeKey: `process_thread:${threadId}:${hash}:ultimo:${Date.now()}`,
        rearm: true,
      },
    );
    return {
      threadId,
      status: 'pendiente' as const,
      mode: 'incremental' as const,
      messageId: last.id,
    };
  }

  /**
   * Una región se corrigió: recalcula el estado de los adjuntos con ese sha256 (sin dudosas ->
   * listo) y reencola la síntesis de cada hilo afectado. Un hilo en 'procesando' se omite (su
   * síntesis en curso o pendiente ya leerá las correcciones).
   */
  async onRegionsChanged(sha256: string): Promise<string[]> {
    const doubtful = await this.prisma.ocrRegion.count({
      where: { status: 'dudoso', page: { sha256 } },
    });
    await this.prisma.attachment.updateMany({
      where: { sha256, status: { in: DONE } },
      data: { status: doubtful > 0 ? 'necesita_revision' : 'listo' },
    });
    // El resumen espera a que se termine la revisión: mientras queden dudas no se re-sintetiza.
    if (doubtful > 0) return [];
    // Solo hilos ya analizados: nunca se toca un hilo sin_analizar (nada sale sin analyze).
    const threads = await this.prisma.thread.findMany({
      where: {
        status: { in: ['listo', 'necesita_revision', 'error'] },
        messages: { some: { attachments: { some: { sha256 } } } },
      },
      select: { id: true },
    });
    const queued: string[] = [];
    const stamp = Date.now();
    for (const t of threads) {
      // Otro PDF del hilo puede seguir pendiente de revisión: se espera a que termine.
      if ((await this.pendingReview(t.id)) > 0) continue;
      // listo/necesita_revision -> pendiente -> procesando (únicas transiciones válidas)
      if (!(await this.state.transition(t.id, 'pendiente'))) continue;
      if (!(await this.state.transition(t.id, 'procesando'))) continue;
      const hash = await this.computeThreadHash(t.id);
      await this.queue.enqueue(
        JOB_TYPES.synthesizeThread,
        { threadId: t.id, hash, correctedSha256: sha256 },
        {
          dedupeKey: `synthesize_thread:${t.id}:${hash}:correccion:${stamp}`,
        },
      );
      queued.push(t.id);
    }
    return queued;
  }

  /**
   * Regenera la síntesis de un hilo en modo COMPLETO (force; el LLM se vuelve a llamar aunque la entrada no cambie).
   * Pasa por la cola: listo/necesita_revision/error -> pendiente -> procesando.
   */
  async regenerateSynthesis(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'procesando' || t.status === 'pendiente')
      throw new ConflictException('El ticket ya se está procesando');
    if (t.status === 'sin_analizar')
      throw new ConflictException('Primero analiza el ticket');
    if (
      !(await this.state.transition(threadId, 'pendiente')) ||
      !(await this.state.transition(threadId, 'procesando'))
    )
      throw new ConflictException(
        'El ticket cambió de estado, intenta de nuevo',
      );
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.synthesizeThread,
      { threadId, hash, force: true },
      {
        dedupeKey: `synthesize_thread:${threadId}:${hash}:manual:${Date.now()}`,
      },
    );
    return {
      threadId,
      status: 'procesando' as const,
      mode: 'full' as const,
      advertencia:
        'Se regenera la síntesis completa desde cero: se envía todo el hilo al modelo y consume más. Para el uso normal, la síntesis se actualiza sola con solo lo nuevo.',
    };
  }

  /** Adjuntos del hilo que aún piden revisión (excluye los que el usuario decidió omitir). */
  private async pendingReview(threadId: string): Promise<number> {
    const skip = await this.prisma.setting.findUnique({
      where: { key: reviewSkipKey(threadId) },
    });
    const shas = (skip?.value as { shas?: unknown } | null)?.shas;
    return this.prisma.attachment.count({
      where: {
        message: { threadId },
        status: 'necesita_revision',
        ...(Array.isArray(shas) && shas.length > 0
          ? { sha256: { notIn: shas as string[] } }
          : {}),
      },
    });
  }

  /**
   * Genera el resumen sin esperar a que se corrijan las zonas dudosas (acción explícita): esos
   * PDFs quedan marcados como omitidos para este hilo y sus partes dudosas se dejan fuera.
   */
  async continueWithoutReview(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status !== 'necesita_revision')
      throw new ConflictException('El ticket no está esperando revisión');
    const atts = await this.prisma.attachment.findMany({
      where: { message: { threadId }, status: 'necesita_revision' },
      select: { sha256: true },
    });
    const value = { shas: [...new Set(atts.map((a) => a.sha256))] };
    await this.prisma.setting.upsert({
      where: { key: reviewSkipKey(threadId) },
      create: { key: reviewSkipKey(threadId), value },
      update: { value },
    });
    if (
      !(await this.state.transition(threadId, 'pendiente')) ||
      !(await this.state.transition(threadId, 'procesando'))
    )
      throw new ConflictException(
        'El ticket cambió de estado, intenta de nuevo',
      );
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.synthesizeThread,
      { threadId, hash },
      {
        dedupeKey: `synthesize_thread:${threadId}:${hash}:sin-revision:${Date.now()}`,
      },
    );
    return { threadId, status: 'procesando' as const };
  }

  // ---- handlers ----

  async processThread(job: JobRecord) {
    const threadId = str(job.payload.threadId);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) return;
    // Defensa: solo se procesa un hilo 'pendiente' (o 'procesando' en un reintento).
    if (!(await this.state.transition(threadId, 'procesando'))) return;

    const attachments = await this.prisma.attachment.findMany({
      where: { message: { threadId } },
    });
    let queued = 0;
    for (const att of attachments) {
      if (isDone(att.status)) continue;
      // Dedupe por sha256: si otro Attachment idéntico ya tiene resultado, se reutiliza.
      const twin = await this.prisma.attachment.findFirst({
        where: {
          sha256: att.sha256,
          id: { not: att.id },
          status: { in: DONE },
        },
      });
      if (twin) {
        await this.prisma.attachment.update({
          where: { id: att.id },
          data: { status: twin.status },
        });
        await this.copyPagesToAttachment(att);
        continue;
      }
      await this.queue.enqueue(
        JOB_TYPES.processAttachment,
        { attachmentId: att.id },
        { dedupeKey: `process_attachment:${att.sha256}`, rearm: true },
      );
      queued++;
    }
    if (queued === 0) await this.checkThreadReady(threadId);
  }

  /**
   * Al reutilizar el OCR de un gemelo (mismo sha256), copia server-side las imágenes de página a
   * la carpeta del adjunto (hilos/<threadId>/pdf_<n>/). Best-effort: un fallo solo da aviso y el
   * visor cae a OcrPage.imageKey. No registra contenido.
   */
  private async copyPagesToAttachment(att: {
    id: string;
    sha256: string;
    storageKey: string;
  }) {
    try {
      const pages = await this.prisma.ocrPage.findMany({
        where: { sha256: att.sha256 },
        select: { pageNumber: true, imageKey: true },
      });
      for (const p of pages) {
        const dst = ownPageKey(att.storageKey, p.pageNumber);
        if (!dst || dst === p.imageKey) continue;
        await this.storage.copy(p.imageKey, dst);
      }
    } catch {
      this.logger.warn(
        `No se pudieron copiar las páginas al adjunto ${att.id}; el visor usará la copia original`,
      );
    }
  }

  async processAttachment(job: JobRecord) {
    const attachmentId = str(job.payload.attachmentId);
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) return;
    if (!isDone(att.status)) {
      await this.prisma.attachment.update({
        where: { id: att.id },
        data: { status: 'procesando' },
      });
      await this.processor.process(att.id);
      const doubtful = await this.prisma.ocrRegion.count({
        where: {
          status: 'dudoso',
          page: { attachment: { sha256: att.sha256 } },
        },
      });
      const final: ProcessStatus = doubtful > 0 ? 'necesita_revision' : 'listo';
      await this.finishAttachments(att.sha256, final);
      // Los gemelos (mismo sha256, otros hilos o el mismo) reciben copia de las páginas.
      const twins = await this.prisma.attachment.findMany({
        where: { sha256: att.sha256, id: { not: att.id } },
      });
      for (const t of twins) await this.copyPagesToAttachment(t);
    }
    await this.notifyThreadsOfSha(att.sha256);
  }

  async synthesizeThread(job: JobRecord) {
    const threadId = str(job.payload.threadId);
    const hash = str(job.payload.hash);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread || thread.status !== 'procesando') return;
    const reKey = reanalyzeKey(threadId);
    const mark = await this.prisma.setting.findUnique({
      where: { key: reKey },
    });
    const markVal = mark?.value as
      { messageId?: unknown; full?: unknown } | undefined;
    const markId = markVal?.messageId;
    const force = job.payload.force === true || markVal?.full === true;
    await this.synthesizer.synthesize(threadId, {
      force,
      ...(!force && typeof markId === 'string'
        ? { reanalyzeMessageId: markId }
        : {}),
      correctedSha256:
        typeof job.payload.correctedSha256 === 'string'
          ? job.payload.correctedSha256
          : undefined,
    });
    if (mark) await this.prisma.setting.deleteMany({ where: { key: reKey } });

    if ((await this.computeThreadHash(threadId)) !== hash) {
      // Llegó contenido nuevo mientras se procesaba: con seguimiento se reprocesa solo;
      // sin seguimiento el hilo termina y queda marcado con mensajes nuevos.
      if (thread.seguimiento) {
        await this.state.transition(threadId, 'pendiente');
        return;
      }
      await this.finishThread(threadId, hash, true);
      return;
    }
    await this.finishThread(threadId, hash, false);
  }

  private async finishThread(
    threadId: string,
    hash: string,
    tieneMensajesNuevos: boolean,
  ) {
    await this.clearProgress(threadId);
    const review = await this.pendingReview(threadId);
    await this.state.transition(
      threadId,
      review > 0 ? 'necesita_revision' : 'listo',
      {
        contentHash: hash,
        ...(tieneMensajesNuevos ? { tieneMensajesNuevos } : {}),
      },
    );
  }

  // ---- fallos definitivos ----

  private async clearProgress(threadId: string) {
    try {
      await this.prisma.setting.deleteMany({
        where: { key: progressKey(threadId) },
      });
    } catch {
      /* best-effort */
    }
  }

  async failThread(threadId: string) {
    if (!threadId) return;
    await this.clearProgress(threadId);
    await this.prisma.setting.deleteMany({
      where: { key: reanalyzeKey(threadId) },
    });
    await this.state.transition(threadId, 'error');
  }

  async failAttachment(attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) return;
    await this.finishAttachments(att.sha256, 'error');
    await this.notifyThreadsOfSha(att.sha256);
  }

  // ---- helpers ----

  /** Aplica el resultado a todos los Attachment con ese sha256 que aún no tienen resultado. */
  private finishAttachments(sha256: string, status: ProcessStatus) {
    return this.prisma.attachment.updateMany({
      where: { sha256, status: { notIn: DONE } },
      data: { status },
    });
  }

  private async notifyThreadsOfSha(sha256: string) {
    const threads = await this.prisma.thread.findMany({
      where: { messages: { some: { attachments: { some: { sha256 } } } } },
      select: { id: true },
    });
    for (const t of threads) await this.checkThreadReady(t.id);
  }

  /** Si todos los adjuntos terminaron encola la síntesis; si alguno falló, el hilo va a error. */
  async checkThreadReady(threadId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (thread?.status !== 'procesando') return;
    const atts = await this.prisma.attachment.findMany({
      where: { message: { threadId } },
      select: { status: true },
    });
    if (atts.some((a) => a.status === 'error')) {
      await this.state.transition(threadId, 'error');
      return;
    }
    if (!atts.every((a) => isDone(a.status))) return;
    const hash = await this.computeThreadHash(threadId);
    // Revisión manual ANTES del resumen: con zonas por corregir no se genera nada todavía.
    if ((await this.pendingReview(threadId)) > 0) {
      await this.state.transition(threadId, 'necesita_revision', {
        contentHash: hash,
      });
      return;
    }
    await this.queue.enqueue(
      JOB_TYPES.synthesizeThread,
      { threadId, hash },
      { dedupeKey: `synthesize_thread:${threadId}:${hash}`, rearm: true },
    );
  }
}
