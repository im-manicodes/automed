import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JOB_TYPES } from '../jobs/job-handler.interface';
import type { JobRecord } from '../jobs/job-handler.interface';
import { JobQueueService } from '../jobs/job-queue.service';
import { JobWorkerService } from '../jobs/job-worker.service';
import { GeneratorService, XLSX_MIME } from './generator.service';
import {
  DEFAULT_REPORT_HOUR,
  DEFAULT_REPORT_ZONE,
  isDue,
  isValidHour,
  isValidZone,
  localParts,
} from './report-time';

export type ReportTrigger = 'manual' | 'programado';

export interface ReportSettings {
  programado: boolean;
  hora: string;
  zona: string;
}

export const SETTING_KEYS = {
  programado: 'reporte.programado',
  hora: 'reporte.hora',
  zona: 'reporte.zona',
} as const;

const reportIdOf = (p: Record<string, unknown>) =>
  typeof p.reportId === 'string' ? p.reportId : '';

const QUICK_ROWS = 20;
const HISTORY_LIMIT = 60;

interface ReportRecord {
  id: string;
  fecha: string;
  trigger: string;
  status: string;
  fileName: string | null;
  storageKey: string | null;
  templateVersion: number | null;
  totalHospitalizados: number;
  totalConNovedad: number;
  totalAltas: number;
  procesados: number;
  total: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Forma pública del reporte (sin storageKey). */
export function toReportDto(r: ReportRecord) {
  return {
    id: r.id,
    fecha: r.fecha,
    trigger: r.trigger,
    status: r.status,
    fileName: r.fileName,
    templateVersion: r.templateVersion,
    totales: {
      hospitalizados: r.totalHospitalizados,
      conNovedad: r.totalConNovedad,
      altas: r.totalAltas,
    },
    progreso: { procesados: r.procesados, total: r.total },
    error: r.error,
    descargable: r.status === 'listo' && !!r.storageKey,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
  };
}

@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: JobQueueService,
    private readonly worker: JobWorkerService,
    private readonly generator: GeneratorService,
  ) {}

  onModuleInit() {
    this.worker.register(JOB_TYPES.generateReport, {
      handle: (j) => this.generator.generate(reportIdOf(j.payload)),
      onFailed: (j, e) => this.markFailed(j, e),
    });
    // Revisión periódica (la ejecuta el housekeeping del worker, cada pocos segundos; es idempotente).
    this.worker.addPeriodic(() => this.checkSchedule());
  }

  private async markFailed(job: JobRecord, error: Error) {
    const id = reportIdOf(job.payload);
    if (!id) return;
    await this.prisma.report.updateMany({
      where: { id, status: 'generando' },
      data: {
        status: 'error',
        // Solo el mensaje técnico del error (sin contenido de correos).
        error: error.message.slice(0, 300),
        finishedAt: new Date(),
      },
    });
  }

  async getSettings(): Promise<ReportSettings> {
    const rows = await Promise.all(
      Object.values(SETTING_KEYS).map((key) =>
        this.prisma.setting.findUnique({ where: { key } }),
      ),
    );
    const [p, h, z] = rows.map((r) => r?.value);
    return {
      programado: p === true,
      hora: isValidHour(h) ? h : DEFAULT_REPORT_HOUR,
      zona: isValidZone(z) ? z : DEFAULT_REPORT_ZONE,
    };
  }

  async updateSettings(body: {
    programado?: unknown;
    hora?: unknown;
    zona?: unknown;
  }): Promise<ReportSettings> {
    const upd: Partial<ReportSettings> = {};
    if (body?.programado !== undefined) {
      if (typeof body.programado !== 'boolean')
        throw new BadRequestException('programado debe ser verdadero o falso');
      upd.programado = body.programado;
    }
    if (body?.hora !== undefined) {
      if (!isValidHour(body.hora))
        throw new BadRequestException('La hora debe tener formato HH:mm');
      upd.hora = body.hora;
    }
    if (body?.zona !== undefined) {
      if (!isValidZone(body.zona))
        throw new BadRequestException('Zona horaria no válida');
      upd.zona = body.zona;
    }
    for (const k of Object.keys(upd) as (keyof ReportSettings)[]) {
      const key = SETTING_KEYS[k];
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: upd[k] as never },
        update: { value: upd[k] as never },
      });
    }
    return this.getSettings();
  }

  async list() {
    const rows = await this.prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    return { reportes: rows.map(toReportDto) };
  }

  /** Reporte manual. Si ya hay uno 'generando' devuelve ESE (`reutilizado: true`). */
  async createManual() {
    const running = await this.prisma.report.findFirst({
      where: { status: 'generando' },
      orderBy: { createdAt: 'desc' },
    });
    if (running) return { reporte: toReportDto(running), reutilizado: true };
    const r = await this.create('manual');
    return { reporte: toReportDto(r), reutilizado: false };
  }

  private async create(trigger: ReportTrigger, now = new Date()) {
    const { zona } = await this.getSettings();
    const report = await this.prisma.report.create({
      data: {
        fecha: localParts(now, zona).fecha,
        trigger,
        status: 'generando',
      },
    });
    await this.queue.enqueue(
      JOB_TYPES.generateReport,
      { reportId: report.id },
      { dedupeKey: `generate_report:${report.id}` },
      now,
    );
    return report;
  }

  /**
   * Programación (idempotente): si está activada, ya pasó la hora local en la zona configurada y no
   * existe un reporte programado de hoy, encola uno. Devuelve true si creó uno.
   */
  async checkSchedule(now = new Date()): Promise<boolean> {
    const s = await this.getSettings();
    if (!s.programado || !isDue(now, s.zona, s.hora)) return false;
    const { fecha } = localParts(now, s.zona);
    const exists = await this.prisma.report.findFirst({
      where: { trigger: 'programado', fecha },
    });
    if (exists) return false;
    const running = await this.prisma.report.findFirst({
      where: { status: 'generando' },
    });
    if (running) return false; // se reintenta en la siguiente pasada
    await this.create('programado', now);
    this.logger.log(`Reporte programado ${fecha} encolado`);
    return true;
  }

  private async find(id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Reporte no encontrado');
    return r;
  }

  async detail(id: string) {
    const r = await this.find(id);
    const rows = await this.prisma.reportRow.findMany({
      where: { reportId: id, novedad: true },
      orderBy: { createdAt: 'asc' },
      take: QUICK_ROWS,
      include: { thread: { select: { subject: true } } },
    });
    return {
      ...toReportDto(r),
      columnas: Array.isArray(r.columnas) ? (r.columnas as string[]) : [],
      filasConNovedad: rows.map((x) => ({
        threadId: x.threadId,
        asunto: x.thread.subject,
        estado: x.estado,
        novedadTexto: x.novedadTexto ?? '',
        desactualizado: x.desactualizado,
        extraccionOk: x.extraccionOk,
        datos: x.data as Record<string, string>,
      })),
    };
  }

  async download(id: string): Promise<StreamableFile> {
    const r = await this.find(id);
    if (r.status !== 'listo' || !r.storageKey)
      throw new ConflictException('El reporte aún no está listo');
    let bytes: Uint8Array;
    try {
      bytes = await this.storage.get(r.storageKey);
    } catch {
      throw new NotFoundException('El archivo del reporte no está disponible');
    }
    const name = (r.fileName ?? 'reporte.xlsx').replace(/[^\w.-]/g, '_');
    return new StreamableFile(bytes, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${name}"`,
    });
  }
}
