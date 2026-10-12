import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProcessStatus } from '../generated/prisma/client';
import {
  computeProgress,
  type ProgresoAnalisis,
  type StoredProgress,
} from './thread-progress';

@Injectable()
export class ThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status?: ProcessStatus) {
    const threads = await this.prisma.thread.findMany({
      where: status ? { status } : undefined,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          select: {
            _count: { select: { attachments: true } },
            attachments: { select: { status: true } },
          },
        },
      },
    });
    return threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      seguimiento: t.seguimiento,
      tieneMensajesNuevos: t.tieneMensajesNuevos,
      updatedAt: t.updatedAt,
      lastMessageAt: t.lastMessageAt,
      messageCount: t.messages.length,
      attachmentCount: t.messages.reduce((n, m) => n + m._count.attachments, 0),
      // Versión barata (sin páginas ni reintentos); null si el hilo no está en marcha
      progreso: computeProgress({
        threadStatus: t.status,
        attachments: t.messages.flatMap((m) => m.attachments),
      }),
    }));
  }

  async detail(id: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { receivedAt: 'asc' },
          include: {
            attachments: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                filename: true,
                size: true,
                sha256: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      seguimiento: t.seguimiento,
      tieneMensajesNuevos: t.tieneMensajesNuevos,
      lastMessageAt: t.lastMessageAt,
      progreso: await this.progress(
        t.id,
        t.status,
        t.messages.flatMap((m) => m.attachments),
        t.updatedAt,
      ),
      // incluye isFromMe (mensaje propio) en cada mensaje
      messages: t.messages,
    };
  }

  async setSeguimiento(id: string, seguimiento: boolean) {
    const r = await this.prisma.thread.updateMany({
      where: { id },
      data: { seguimiento },
    });
    if (r.count === 0) throw new NotFoundException('Ticket no encontrado');
    return { id, seguimiento };
  }

  /** Progreso detallado (páginas y reintentos); solo consulta extra si el hilo está en marcha. */
  private async progress(
    threadId: string,
    status: ProcessStatus,
    atts: { id: string; status: string }[],
    updatedAt?: Date,
  ): Promise<ProgresoAnalisis | null> {
    const enMarcha = status === 'pendiente' || status === 'procesando';
    if (!enMarcha && status !== 'necesita_revision' && status !== 'listo')
      return null;
    if (!enMarcha) {
      return computeProgress({
        threadStatus: status,
        attachments: atts.map((a) => ({ status: a.status })),
        updatedAt,
      });
    }
    const ids = atts.map((a) => a.id);
    const [pages, jobs, setting] = await Promise.all([
      ids.length
        ? this.prisma.ocrPage.findMany({
            where: { attachmentId: { in: ids } },
            select: { attachmentId: true, text: true },
          })
        : Promise.resolve([]),
      this.prisma.job.findMany({
        where: {
          OR: [
            { payload: { path: ['threadId'], equals: threadId } },
            ...ids.map((id) => ({
              payload: { path: ['attachmentId'], equals: id },
            })),
          ],
        },
        select: {
          type: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          lastError: true,
        },
      }),
      this.prisma.setting
        .findUnique({ where: { key: `progress:${threadId}` } })
        .catch(() => null),
    ]);
    const byAtt = new Map<string, { total: number; leidas: number }>();
    for (const p of pages) {
      const c = byAtt.get(p.attachmentId) ?? { total: 0, leidas: 0 };
      c.total++;
      if (p.text !== null) c.leidas++;
      byAtt.set(p.attachmentId, c);
    }
    return computeProgress({
      threadStatus: status,
      attachments: atts.map((a) => ({
        status: a.status,
        paginasTotal: byAtt.get(a.id)?.total,
        paginasLeidas: byAtt.get(a.id)?.leidas,
      })),
      jobs,
      stored: parseStored(setting?.value),
      updatedAt,
    });
  }
}

function parseStored(v: unknown): StoredProgress | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as {
    etapa?: unknown;
    regiones?: { total?: unknown; hechas?: unknown };
  };
  if (
    o.etapa !== 'ocr' &&
    o.etapa !== 'vision_enviando' &&
    o.etapa !== 'vision_procesando'
  )
    return null;
  const r = o.regiones;
  return {
    etapa: o.etapa,
    ...(r && typeof r.total === 'number' && typeof r.hechas === 'number'
      ? { regiones: { total: r.total, hechas: r.hechas } }
      : {}),
  };
}
