import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { parseReportColumns } from '../templates/report-columns';
import type { ReportColumn } from '../templates/report-columns';
import { GeneratorService } from '../reports/generator.service';
import { ReportsService } from '../reports/reports.service';
import { localParts } from '../reports/report-time';
import type { ReportEstado } from '../reports/report-extraction';

export const EVENT_ESTADOS: readonly ReportEstado[] = [
  'hospitalizado',
  'alta',
  'otro',
];
export const MAX_EVENT_VALUE_CHARS = 2000;
export const MAX_EVENT_NOVEDAD_CHARS = 1000;

const MIN_EVENT_DATE = Date.UTC(2000, 0, 1);
const MAX_FUTURE_MS = 2 * 24 * 3600 * 1000;

interface EventRecord {
  id: string;
  threadId: string;
  synthesisId: string;
  fechaEvento: Date;
  fecha: string;
  estado: string;
  novedadTexto: string | null;
  data: unknown;
  columnas: unknown;
  templateVersion: number | null;
  createdAt: Date;
}

export interface EventDto {
  id: string;
  threadId: string;
  synthesisId: string;
  fechaEvento: string;
  fecha: string;
  estado: ReportEstado;
  novedadTexto: string;
  datos: Record<string, string>;
  columnas: string[];
  templateVersion: number | null;
  createdAt: string;
}

const asData = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, string>)
    : {};

export function toEventDto(e: EventRecord): EventDto {
  return {
    id: e.id,
    threadId: e.threadId,
    synthesisId: e.synthesisId,
    fechaEvento: e.fechaEvento.toISOString(),
    fecha: e.fecha,
    estado: e.estado as ReportEstado,
    novedadTexto: e.novedadTexto ?? '',
    datos: asData(e.data),
    columnas: Array.isArray(e.columnas) ? (e.columnas as string[]) : [],
    templateVersion: e.templateVersion,
    createdAt: e.createdAt.toISOString(),
  };
}

export interface CreateEventBody {
  synthesisId?: unknown;
  datos?: unknown;
  estado?: unknown;
  novedadTexto?: unknown;
  fechaEvento?: unknown;
}

/**
 * Bitácora de eventos de hospitalización. El borrador usa una sola llamada al LLM con la
 * síntesis vigente (nunca el hilo) y NO guarda nada; solo el alta confirmada por el usuario
 * crea el evento. Los logs llevan solo ids (nada de contenido de correos ni de pacientes).
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly reports: ReportsService,
  ) {}

  private async thread(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, status: true, lastMessageAt: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return t;
  }

  /** Síntesis vigente (última versión) o 409 si el hilo no está listo / no tiene síntesis. */
  private async currentSynthesis(threadId: string) {
    const t = await this.thread(threadId);
    if (t.status === 'pendiente' || t.status === 'procesando')
      throw new ConflictException(
        'El ticket se está analizando. Espera a que termine.',
      );
    if (t.status === 'necesita_revision')
      throw new ConflictException('Resuelve las dudas del PDF primero.');
    if (t.status !== 'listo')
      throw new ConflictException('Analiza el ticket antes de añadirlo.');
    const [syn] = await this.prisma.synthesis.findMany({
      where: { threadId },
      orderBy: { version: 'desc' },
      take: 1,
      select: { id: true, markdown: true, coveredMessageIds: true },
    });
    if (!syn)
      throw new ConflictException('El ticket todavía no tiene resumen.');
    return { thread: t, syn };
  }

  private async activeColumns(): Promise<{
    columnas: ReportColumn[];
    version: number;
  }> {
    const tpl = await this.templates.getActive('reporte');
    const { columnas, error } = parseReportColumns(tpl.markdown);
    if (error)
      throw new ConflictException(
        `La plantilla de columnas no es válida: ${error}`,
      );
    return { columnas, version: tpl.version };
  }

  /** Fecha del último correo cubierto por la síntesis (o del último del hilo). */
  private async defaultEventDate(
    threadId: string,
    covered: unknown,
    fallback: Date | null,
  ): Promise<Date> {
    const ids = new Set(Array.isArray(covered) ? (covered as string[]) : []);
    const msgs = await this.prisma.message.findMany({
      where: { threadId },
      select: { id: true, receivedAt: true },
    });
    let best: Date | null = null;
    for (const m of msgs)
      if ((ids.size === 0 || ids.has(m.id)) && (!best || m.receivedAt > best))
        best = m.receivedAt;
    return best ?? fallback ?? new Date();
  }

  async draft(threadId: string) {
    const { thread, syn } = await this.currentSynthesis(threadId);
    const { columnas, version } = await this.activeColumns();
    const events = await this.prisma.hospitalEvent.findMany({
      where: { threadId },
      orderBy: { fechaEvento: 'desc' },
    });
    const registrado = events.find((e) => e.synthesisId === syn.id) ?? null;
    if (registrado) {
      // Ya añadido para esta versión: no se gasta una llamada al LLM.
      const dto = toEventDto(registrado);
      return {
        synthesisId: syn.id,
        templateVersion: version,
        columnas,
        datos: dto.datos,
        estado: dto.estado,
        novedadTexto: dto.novedadTexto,
        fechaEvento: dto.fechaEvento,
        yaRegistrado: dto,
      };
    }
    const prev = events[0] ?? null;
    const ex = await this.generator.extract(
      syn.markdown,
      columnas,
      prev
        ? {
            fecha: prev.fecha,
            estado: prev.estado,
            datos: asData(prev.data),
          }
        : null,
    );
    if (!ex) {
      this.logger.warn(`No se pudo preparar el borrador (hilo ${threadId})`);
      throw new ServiceUnavailableException(
        'No se pudo leer la actualización ahora. Intenta de nuevo en un momento.',
      );
    }
    const fechaEvento = await this.defaultEventDate(
      threadId,
      syn.coveredMessageIds,
      thread.lastMessageAt,
    );
    return {
      synthesisId: syn.id,
      templateVersion: version,
      columnas,
      datos: ex.data,
      estado: ex.estado,
      novedadTexto: ex.novedadTexto,
      fechaEvento: fechaEvento.toISOString(),
      yaRegistrado: null,
    };
  }

  async create(threadId: string, body: CreateEventBody) {
    const b = body ?? {};
    const { syn } = await this.currentSynthesis(threadId);
    if (typeof b.synthesisId !== 'string' || !b.synthesisId)
      throw new BadRequestException('Falta la versión del resumen');
    if (b.synthesisId !== syn.id)
      throw new ConflictException(
        'El resumen cambió desde el borrador. Vuelve a prepararlo.',
      );
    if (
      typeof b.estado !== 'string' ||
      !(EVENT_ESTADOS as readonly string[]).includes(b.estado)
    )
      throw new BadRequestException('Estado no válido');
    const estado = b.estado as ReportEstado;
    if (b.novedadTexto != null && typeof b.novedadTexto !== 'string')
      throw new BadRequestException('"Qué cambió" debe ser texto');
    const novedad = (b.novedadTexto ?? '').trim();
    if (novedad.length > MAX_EVENT_NOVEDAD_CHARS)
      throw new BadRequestException(
        `"Qué cambió" supera ${MAX_EVENT_NOVEDAD_CHARS} caracteres`,
      );
    if (typeof b.fechaEvento !== 'string')
      throw new BadRequestException('Fecha del evento no válida');
    const fechaEvento = new Date(b.fechaEvento);
    const ms = fechaEvento.getTime();
    if (
      Number.isNaN(ms) ||
      ms < MIN_EVENT_DATE ||
      ms > Date.now() + MAX_FUTURE_MS
    )
      throw new BadRequestException('Fecha del evento no válida');
    if (!b.datos || typeof b.datos !== 'object' || Array.isArray(b.datos))
      throw new BadRequestException('Los datos deben ser un objeto');
    const { columnas, version } = await this.activeColumns();
    const nombres = columnas.map((c) => c.nombre);
    const datos: Record<string, string> = {};
    for (const n of nombres) datos[n] = '';
    for (const [k, v] of Object.entries(b.datos as Record<string, unknown>)) {
      if (!nombres.includes(k))
        throw new BadRequestException(
          `La columna "${k.slice(0, 60)}" no existe`,
        );
      if (typeof v !== 'string')
        throw new BadRequestException(`El valor de "${k}" debe ser texto`);
      if (v.length > MAX_EVENT_VALUE_CHARS)
        throw new BadRequestException(
          `El valor de "${k}" supera ${MAX_EVENT_VALUE_CHARS} caracteres`,
        );
      datos[k] = v.trim();
    }
    const existing = await this.prisma.hospitalEvent.findFirst({
      where: { threadId, synthesisId: syn.id },
    });
    if (existing) throw new ConflictException(YA_AÑADIDO);
    const { zona } = await this.reports.getSettings();
    try {
      const ev = await this.prisma.hospitalEvent.create({
        data: {
          threadId,
          synthesisId: syn.id,
          fechaEvento,
          fecha: localParts(fechaEvento, zona).fecha,
          estado,
          novedadTexto: novedad || null,
          data: datos,
          columnas: nombres,
          templateVersion: version,
        },
      });
      return toEventDto(ev);
    } catch (e) {
      // Carrera con otro alta: la restricción única (hilo, síntesis) la detiene.
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException(YA_AÑADIDO);
      throw e;
    }
  }

  async list(threadId: string) {
    const t = await this.thread(threadId);
    const rows = await this.prisma.hospitalEvent.findMany({
      where: { threadId },
      orderBy: { fechaEvento: 'desc' },
    });
    let synthesisVigente: string | null = null;
    if (t.status === 'listo') {
      const [syn] = await this.prisma.synthesis.findMany({
        where: { threadId },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true },
      });
      synthesisVigente = syn?.id ?? null;
    }
    return { eventos: rows.map(toEventDto), synthesisId: synthesisVigente };
  }

  async remove(id: string): Promise<void> {
    const e = await this.prisma.hospitalEvent.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Evento no encontrado');
    await this.prisma.hospitalEvent.delete({ where: { id } });
  }
}

const YA_AÑADIDO = 'Esta actualización ya se añadió al Excel.';
