import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const threads = await this.prisma.thread.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { select: { _count: { select: { attachments: true } } } },
      },
    });
    return threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      messageCount: t.messages.length,
      attachmentCount: t.messages.reduce((n, m) => n + m._count.attachments, 0),
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
      lastMessageAt: t.lastMessageAt,
      // incluye isFromMe (mensaje propio) en cada mensaje
      messages: t.messages,
    };
  }
}
