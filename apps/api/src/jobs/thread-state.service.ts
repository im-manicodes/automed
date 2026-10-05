import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProcessStatus } from '../generated/prisma/client';

const ALLOWED: Record<ProcessStatus, ProcessStatus[]> = {
  pendiente: ['procesando', 'error'],
  procesando: ['listo', 'necesita_revision', 'error', 'pendiente'],
  listo: ['pendiente'],
  necesita_revision: ['pendiente'],
  error: ['pendiente'],
};

export function canTransition(from: ProcessStatus, to: ProcessStatus) {
  return from === to || ALLOWED[from].includes(to);
}

/** Único lugar donde cambia el estado de un Thread desde el pipeline. */
@Injectable()
export class ThreadStateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cambia el estado si la transición es válida. Atómico (compare-and-set sobre el estado
   * leído). Devuelve false si el hilo no existe, la transición no es válida o cambió en paralelo.
   */
  async transition(
    threadId: string,
    to: ProcessStatus,
    extra: { contentHash?: string } = {},
  ): Promise<boolean> {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!t || !canTransition(t.status, to)) return false;
    const r = await this.prisma.thread.updateMany({
      where: { id: threadId, status: t.status },
      data: { status: to, ...extra },
    });
    return r.count === 1;
  }
}
