import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProcessStatus } from '../generated/prisma/client';

const ALLOWED: Record<ProcessStatus, ProcessStatus[]> = {
  // Solo el usuario (analyze/reprocess) saca a un hilo de sin_analizar.
  sin_analizar: ['pendiente'],
  pendiente: ['procesando', 'error'],
  procesando: ['listo', 'necesita_revision', 'error', 'pendiente'],
  listo: ['pendiente'],
  necesita_revision: ['pendiente'],
  error: ['pendiente'],
};

export function canTransition(from: ProcessStatus, to: ProcessStatus) {
  return from === to || ALLOWED[from].includes(to);
}

const ANALYZED_STATES: ProcessStatus[] = [
  'listo',
  'necesita_revision',
  'error',
];

/**
 * Qué hacer cuando llegan mensajes/adjuntos nuevos a un hilo (lo usa el sync de correo).
 * - Nunca analizado (sin síntesis ni estado listo/necesita_revision/error): conserva su estado
 *   (sin_analizar sigue igual; nada sale a OCR/LLM).
 * - Ya analizado + seguimiento: pasa a 'pendiente' (reanálisis automático).
 * - Ya analizado sin seguimiento: conserva el estado y marca tieneMensajesNuevos.
 * Devuelve `null` si no hay nada que cambiar.
 */
export function stateOnNewContent(t: {
  status: ProcessStatus;
  seguimiento: boolean;
  syntheses: number;
}): { status?: ProcessStatus; tieneMensajesNuevos?: boolean } | null {
  const analizado = t.syntheses > 0 || ANALYZED_STATES.includes(t.status);
  if (!analizado) return null;
  if (t.seguimiento) {
    return t.status === 'pendiente'
      ? { tieneMensajesNuevos: false }
      : { status: 'pendiente', tieneMensajesNuevos: false };
  }
  return { tieneMensajesNuevos: true };
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
    extra: {
      contentHash?: string;
      tieneMensajesNuevos?: boolean;
      seguimiento?: boolean;
    } = {},
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
