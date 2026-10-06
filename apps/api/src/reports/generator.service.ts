import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TemplatesService } from '../templates/templates.service';
import { parseReportColumns } from '../templates/report-columns';
import type { ReportColumn } from '../templates/report-columns';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import {
  buildReportPrompt,
  parseExtraction,
  REPORT_SYSTEM_PROMPT,
} from './report-extraction';
import type { ExtractedPatient, PreviousEventHint } from './report-extraction';
import { computeNovedad } from './report-novedad';
import type { PreviousRow } from './report-novedad';
import { buildReportWorkbook } from './report-excel';
import type { ExcelEvent, ExcelRow } from './report-excel';
import { DEFAULT_REPORT_ZONE, localParts } from './report-time';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const asData = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, string>)
    : {};

/**
 * Genera el reporte: una extracción por hilo con síntesis (caché por síntesis + versión de
 * columnas), novedad contra el reporte de un día anterior y el .xlsx en RustFS.
 * Solo incluye hilos ya analizados (con al menos una síntesis); los sin analizar ni se listan.
 * NUNCA dispara análisis (OCR/síntesis) ni reenvía hilos: solo usa la síntesis vigente.
 * Los logs llevan solo ids y conteos (nada de contenido de correos ni de pacientes).
 */
@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly templates: TemplatesService,
    private readonly config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** Una extracción con 1 reintento. Devuelve null si ambas fallan (o el LLM no responde). */
  async extract(
    synthesisMarkdown: string,
    columnas: ReportColumn[],
    previous: PreviousEventHint | null = null,
  ): Promise<ExtractedPatient | null> {
    for (const retry of [false, true]) {
      try {
        const raw = await this.llm.text(
          REPORT_SYSTEM_PROMPT,
          buildReportPrompt(synthesisMarkdown, columnas, retry, previous),
          { maxTokens: 1800 },
        );
        const parsed = parseExtraction(raw, columnas);
        if (parsed) return parsed;
      } catch (e) {
        this.logger.warn(
          `Extracción falló: ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
    return null;
  }

  async generate(reportId: string, now = new Date()): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report || report.status === 'listo') return; // reintento de un trabajo ya terminado
    const zone = await this.zone();
    const template = await this.templates.getActive('reporte');
    const { columnas, error } = parseReportColumns(template.markdown);
    if (error) {
      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'error',
          error: `Plantilla de columnas no válida: ${error}`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    const threads = await this.prisma.thread.findMany({
      where: { syntheses: { some: {} } },
      select: {
        id: true,
        subject: true,
        status: true,
        tieneMensajesNuevos: true,
        syntheses: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, markdown: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    await this.prisma.reportRow.deleteMany({ where: { reportId } });
    await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'generando',
        error: null,
        total: threads.length,
        procesados: 0,
        templateVersion: template.version,
        columnas: columnas.map((c) => c.nombre),
      },
    });

    const baseline = await this.baselines(
      threads.map((t) => t.id),
      report.fecha,
    );
    const rows: ExcelRow[] = [];
    let done = 0;
    for (const t of threads) {
      const syn = t.syntheses[0];
      if (!syn) {
        done++;
        continue;
      }
      const cached = await this.prisma.threadReportData.findFirst({
        where: {
          threadId: t.id,
          synthesisId: syn.id,
          templateVersion: template.version,
        },
      });
      const ex: ExtractedPatient | null = cached
        ? {
            estado: cached.estado as ExtractedPatient['estado'],
            novedadTexto: cached.novedadTexto ?? '',
            data: asData(cached.data),
          }
        : await this.extract(syn.markdown, columnas);
      if (!cached && ex) {
        try {
          await this.prisma.threadReportData.create({
            data: {
              threadId: t.id,
              synthesisId: syn.id,
              templateVersion: template.version,
              estado: ex.estado,
              novedadTexto: ex.novedadTexto,
              data: ex.data,
            },
          });
        } catch {
          /* carrera con otro reporte: el caché ya existe */
        }
      }
      const desactualizado =
        t.tieneMensajesNuevos ||
        t.status === 'pendiente' ||
        t.status === 'procesando';
      const prev = baseline.get(t.id) ?? null;
      let row: ExcelRow | null = null;
      if (!ex) {
        // Extracción incompleta: la fila entra igual (nunca aborta el reporte).
        row = {
          threadId: t.id,
          subject: t.subject,
          estado: 'otro',
          novedad: true,
          novedadTexto: 'No se pudo leer el resumen con IA; revisa el ticket',
          desactualizado,
          extraccionOk: false,
          data: {},
          actualizadoEn: syn.createdAt,
        };
      } else if (ex.estado === 'otro') {
        row = null;
      } else if (ex.estado === 'alta' && prev?.estado === 'alta') {
        row = null; // el alta ya salió una vez
      } else {
        const nov = computeNovedad({
          synthesisId: syn.id,
          estado: ex.estado,
          data: ex.data,
          novedadTexto: ex.novedadTexto,
          previous: prev,
        });
        row = {
          threadId: t.id,
          subject: t.subject,
          estado: ex.estado,
          novedad: nov.novedad,
          novedadTexto: nov.texto,
          desactualizado,
          extraccionOk: true,
          data: ex.data,
          actualizadoEn: syn.createdAt,
        };
      }
      if (row) {
        rows.push(row);
        await this.prisma.reportRow.create({
          data: {
            reportId,
            threadId: t.id,
            synthesisId: syn.id,
            estado: row.estado,
            novedad: row.novedad,
            novedadTexto: row.novedadTexto,
            desactualizado: row.desactualizado,
            data: row.data,
            extraccionOk: row.extraccionOk,
            actualizadoEn: row.actualizadoEn,
          },
        });
      }
      done++;
      await this.prisma.report.update({
        where: { id: reportId },
        data: { procesados: done },
      });
    }

    const totales = {
      hospitalizados: rows.filter((r) => r.estado === 'hospitalizado').length,
      conNovedad: rows.filter((r) => r.novedad).length,
      altas: rows.filter((r) => r.estado === 'alta').length,
    };
    const eventos = await this.loadEvents();
    const { hora } = localParts(now, zone);
    const fmt = (d: Date) => {
      const p = localParts(d, zone);
      return `${p.fecha} ${p.hora}`;
    };
    const buffer = await buildReportWorkbook({
      fecha: report.fecha,
      generadoEn: fmt(now),
      trigger: report.trigger,
      columnas: columnas.map((c) => c.nombre),
      rows,
      eventos,
      webOrigin:
        this.config.get<string>('WEB_ORIGIN') || 'http://localhost:5173',
      totales,
      formatDate: fmt,
    });
    const hhmm = hora.replace(':', '');
    let key = `reportes/${report.fecha}/reporte_${hhmm}.xlsx`;
    if (await this.storage.exists(key))
      key = `reportes/${report.fecha}/reporte_${hhmm}_${reportId.slice(0, 8)}.xlsx`;
    await this.storage.put(key, buffer, XLSX_MIME);
    await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'listo',
        storageKey: key,
        fileName: `reporte_${report.fecha}_${hhmm}.xlsx`,
        totalHospitalizados: totales.hospitalizados,
        totalConNovedad: totales.conNovedad,
        totalAltas: totales.altas,
        finishedAt: new Date(),
      },
    });
    this.logger.log(
      `Reporte ${reportId} listo: ${rows.length} filas, ${totales.conNovedad} con novedad`,
    );
  }

  /** Bitácora de eventos de TODOS los hilos (sin LLM), más reciente primero. */
  private async loadEvents(): Promise<ExcelEvent[]> {
    const evs = await this.prisma.hospitalEvent.findMany({
      orderBy: { fechaEvento: 'desc' },
    });
    return evs.map((e) => ({
      threadId: e.threadId,
      fechaEvento: e.fechaEvento,
      fecha: e.fecha,
      estado: e.estado,
      novedadTexto: e.novedadTexto ?? '',
      data: asData(e.data),
      createdAt: e.createdAt,
    }));
  }

  private async zone(): Promise<string> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'reporte.zona' },
    });
    return typeof s?.value === 'string' && s.value
      ? s.value
      : DEFAULT_REPORT_ZONE;
  }

  /** Última fila de cada hilo en reportes LISTOS de un día anterior a `fecha`. */
  private async baselines(
    threadIds: string[],
    fecha: string,
  ): Promise<Map<string, PreviousRow>> {
    const map = new Map<string, PreviousRow>();
    if (!threadIds.length) return map;
    const prev = await this.prisma.reportRow.findMany({
      where: {
        threadId: { in: threadIds },
        extraccionOk: true,
        report: { status: 'listo', fecha: { lt: fecha } },
      },
      orderBy: { createdAt: 'desc' },
      select: { threadId: true, synthesisId: true, estado: true, data: true },
    });
    for (const r of prev) {
      if (!map.has(r.threadId))
        map.set(r.threadId, {
          synthesisId: r.synthesisId,
          estado: r.estado,
          data: asData(r.data),
        });
    }
    return map;
  }
}
