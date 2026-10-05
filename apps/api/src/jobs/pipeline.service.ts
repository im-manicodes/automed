import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
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
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Orquestador: process_thread -> N x process_attachment -> synthesize_thread.
 * Los trabajos son idempotentes (dedupeKey por hash de contenido / sha256 del PDF).
 */
@Injectable()
export class PipelineService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
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
    // El sync solo deja el Thread en 'pendiente'; este barrido lo convierte en trabajo.
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

  /** Vuelve a procesar el hilo desde cero (adjuntos incluidos). */
  async reprocess(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'procesando')
      throw new ConflictException('El ticket ya se está procesando');
    await this.prisma.attachment.updateMany({
      where: { message: { threadId } },
      data: { status: 'pendiente' },
    });
    await this.state.transition(threadId, 'pendiente');
    const hash = await this.computeThreadHash(threadId);
    await this.queue.enqueue(
      JOB_TYPES.processThread,
      { threadId },
      { dedupeKey: `process_thread:${threadId}:${hash}`, rearm: true },
    );
    return { threadId, status: 'pendiente' as const };
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
    const threads = await this.prisma.thread.findMany({
      where: { messages: { some: { attachments: { some: { sha256 } } } } },
      select: { id: true },
    });
    const queued: string[] = [];
    const stamp = Date.now();
    for (const t of threads) {
      // listo/necesita_revision -> pendiente -> procesando (únicas transiciones válidas)
      if (!(await this.state.transition(t.id, 'pendiente'))) continue;
      if (!(await this.state.transition(t.id, 'procesando'))) continue;
      const hash = await this.computeThreadHash(t.id);
      await this.queue.enqueue(
        JOB_TYPES.synthesizeThread,
        { threadId: t.id, hash },
        {
          dedupeKey: `synthesize_thread:${t.id}:${hash}:correccion:${stamp}`,
        },
      );
      queued.push(t.id);
    }
    return queued;
  }

  /**
   * Regenera la síntesis de un hilo (el LLM se vuelve a llamar aunque la entrada no cambie).
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
    return { threadId, status: 'procesando' as const };
  }

  // ---- handlers ----

  async processThread(job: JobRecord) {
    const threadId = str(job.payload.threadId);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) return;
    await this.state.transition(threadId, 'procesando');

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
    await this.synthesizer.synthesize(threadId, {
      force: job.payload.force === true,
    });

    if ((await this.computeThreadHash(threadId)) !== hash) {
      // Llegó contenido nuevo mientras se procesaba: se reprocesa con el hash nuevo.
      await this.state.transition(threadId, 'pendiente');
      return;
    }
    const review = await this.prisma.attachment.count({
      where: { message: { threadId }, status: 'necesita_revision' },
    });
    await this.state.transition(
      threadId,
      review > 0 ? 'necesita_revision' : 'listo',
      { contentHash: hash },
    );
  }

  // ---- fallos definitivos ----

  async failThread(threadId: string) {
    if (threadId) await this.state.transition(threadId, 'error');
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
    await this.queue.enqueue(
      JOB_TYPES.synthesizeThread,
      { threadId, hash },
      { dedupeKey: `synthesize_thread:${threadId}:${hash}`, rearm: true },
    );
  }
}
