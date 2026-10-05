import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  DeltaExpiredError,
  GraphService,
  MAIL_FOLDERS,
  MailFolder,
} from './graph.service';
import { stateOnNewContent } from '../jobs/thread-state.service';
import { GraphMessage, isPdfAttachment, mapMessage } from './graph-mapper';

export interface SyncResult {
  started: boolean;
  messages: number;
  newMessages: number;
  attachments: number;
  deduped: number;
  resetDelta: boolean;
  error?: string;
}

const JOB = 'mail-sync';

@Injectable()
export class MailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailSyncService.name);
  private running = false;
  lastResult: (SyncResult & { at: Date }) | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly storage: StorageService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    // JOBS_ENABLED=false (pruebas/despliegues de verificación) también apaga el polling del sync.
    if (this.config.get('JOBS_ENABLED') === 'false') return;
    const minutes = Number(this.config.get('SYNC_INTERVAL_MIN') ?? 5);
    if (!(minutes > 0)) return;
    const timer = setInterval(() => void this.syncNow(), minutes * 60_000);
    this.scheduler.addInterval(JOB, timer);
  }

  onModuleDestroy() {
    if (this.scheduler.doesExist('interval', JOB))
      this.scheduler.deleteInterval(JOB);
  }

  isRunning() {
    return this.running;
  }

  /** Sincroniza ahora. Si ya hay una ejecución en curso, no se solapa. */
  async syncNow(): Promise<SyncResult> {
    const result: SyncResult = {
      started: false,
      messages: 0,
      newMessages: 0,
      attachments: 0,
      deduped: 0,
      resetDelta: false,
    };
    if (this.running) return result;
    this.running = true;
    result.started = true;
    try {
      const account = await this.prisma.mailAccount.findFirst();
      if (!account?.tokenEnc) {
        result.error = 'No hay cuenta conectada';
        return result;
      }
      for (const folder of MAIL_FOLDERS) {
        const key = { accountId_folder: { accountId: account.id, folder } };
        const state = await this.prisma.mailFolderSync.findUnique({
          where: key,
        });
        try {
          await this.runDelta(
            account,
            folder,
            state?.deltaLink ?? null,
            result,
          );
        } catch (e) {
          if (!(e instanceof DeltaExpiredError)) throw e;
          // deltaLink expirado: se descarta y se hace un delta completo (idempotente).
          result.resetDelta = true;
          await this.prisma.mailFolderSync.upsert({
            where: key,
            create: { accountId: account.id, folder, deltaLink: null },
            update: { deltaLink: null },
          });
          await this.runDelta(account, folder, null, result);
        }
      }
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { lastSyncAt: new Date() },
      });
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Error desconocido';
      this.logger.error(`Sync falló: ${result.error}`);
    } finally {
      this.running = false;
      this.lastResult = { ...result, at: new Date() };
    }
    return result;
  }

  private async runDelta(
    account: { id: string; email: string },
    folder: MailFolder,
    deltaLink: string | null,
    result: SyncResult,
  ) {
    let finalLink: string | undefined;
    for await (const page of this.graph.deltaMessages(folder, deltaLink)) {
      for (const m of page.messages) {
        if (m['@removed'] || m.isDraft) continue;
        await this.processMessage(account, m, result);
      }
      if (page.deltaLink) finalLink = page.deltaLink;
    }
    // El deltaLink solo se guarda tras recorrer todo: si falla a mitad se repite (idempotente).
    if (finalLink) {
      await this.prisma.mailFolderSync.upsert({
        where: { accountId_folder: { accountId: account.id, folder } },
        create: { accountId: account.id, folder, deltaLink: finalLink },
        update: { deltaLink: finalLink },
      });
    }
  }

  private async processMessage(
    account: { id: string; email: string },
    raw: GraphMessage,
    result: SyncResult,
  ) {
    const accountId = account.id;
    const m = mapMessage(raw, account.email);
    result.messages++;

    const existing = await this.prisma.message.findUnique({
      where: { graphId: m.graphId },
    });
    let messageId: string;
    let threadId: string;
    let changed = false;

    if (existing) {
      messageId = existing.id;
      threadId = existing.threadId;
    } else {
      const thread = await this.prisma.thread.upsert({
        where: {
          accountId_conversationId: {
            accountId,
            conversationId: m.conversationId,
          },
        },
        create: {
          accountId,
          conversationId: m.conversationId,
          subject: m.subject,
          lastMessageAt: m.receivedAt,
        },
        update: {},
      });
      threadId = thread.id;
      const created = await this.prisma.message.create({
        data: {
          threadId,
          graphId: m.graphId,
          from: m.from,
          to: m.to,
          cc: m.cc,
          subject: m.subject,
          bodyText: m.bodyText,
          isFromMe: m.isFromMe,
          receivedAt: m.receivedAt,
        },
      });
      messageId = created.id;
      result.newMessages++;
      changed = true;
      const t = await this.prisma.thread.findUnique({
        where: { id: threadId },
      });
      if (t && (!t.lastMessageAt || t.lastMessageAt < m.receivedAt)) {
        await this.prisma.thread.update({
          where: { id: threadId },
          data: { lastMessageAt: m.receivedAt },
        });
      }
    }

    if (m.hasAttachments) {
      const added = await this.syncAttachments(m.graphId, messageId, result);
      changed = changed || added > 0;
    }
    if (changed) {
      // Hay contenido nuevo. El análisis (OCR/LLM) es siempre bajo petición del usuario:
      // un hilo nuevo/nunca analizado queda 'sin_analizar'; uno ya analizado solo se
      // reanaliza solo si tiene seguimiento, y si no se marca tieneMensajesNuevos.
      const t = await this.prisma.thread.findUnique({
        where: { id: threadId },
        select: {
          status: true,
          seguimiento: true,
          _count: { select: { syntheses: true } },
        },
      });
      const change = t
        ? stateOnNewContent({
            status: t.status,
            seguimiento: t.seguimiento,
            syntheses: t._count.syntheses,
          })
        : null;
      if (change) {
        await this.prisma.thread.update({
          where: { id: threadId },
          data: change,
        });
      }
    }
  }

  private async syncAttachments(
    graphMessageId: string,
    messageId: string,
    result: SyncResult,
  ) {
    let added = 0;
    const list = (await this.graph.listAttachments(graphMessageId)).filter(
      isPdfAttachment,
    );
    for (const att of list) {
      const known = await this.prisma.attachment.findFirst({
        where: { messageId, graphId: att.id },
      });
      if (known) continue;
      const bytes = await this.graph.downloadAttachment(graphMessageId, att.id);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // Dedupe por hash: si el mismo PDF ya está guardado se reutiliza su storageKey.
      const sameHash = await this.prisma.attachment.findFirst({
        where: { sha256 },
      });
      let storageKey: string;
      if (sameHash) {
        storageKey = sameHash.storageKey;
        result.deduped++;
      } else {
        storageKey = `attachments/${sha256}.pdf`;
        await this.storage.put(storageKey, bytes, 'application/pdf');
      }
      await this.prisma.attachment.create({
        data: {
          messageId,
          graphId: att.id,
          filename: att.name ?? 'adjunto.pdf',
          mimeType: 'application/pdf',
          size: bytes.length,
          storageKey,
          sha256,
        },
      });
      result.attachments++;
      added++;
    }
    return added;
  }
}
