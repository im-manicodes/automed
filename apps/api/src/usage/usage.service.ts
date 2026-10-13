import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_REPORT_ZONE, isValidZone } from '../reports/report-time';
import {
  addDays,
  costOf,
  dayRange,
  daysInMonth,
  localDate,
  isOcrPriceKey,
  normalizePrices,
  validatePrices,
  zonedStartOfDay,
  type UsageRow,
} from './usage-pure';
import type { IaPrecios } from './usage-pure';

export const PRICES_KEY = 'ia.precios';
export const USAGE_PERIODS = ['hoy', '7d', '30d', 'mes'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** Una entrada del registro: SOLO cifras e identificadores (nunca contenido). */
export interface UsageEntry {
  kind: 'llm' | 'ocr';
  provider: string;
  model: string;
  task: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  pages?: number;
  estimated?: boolean;
  threadId?: string | null;
}

const int = (v: number | undefined) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Registro de uso de IA (tokens por llamada, páginas de OCR de pago) y consultas agregadas con
 * costo calculado AL CONSULTAR con los precios vigentes (`Setting` `ia.precios`). El registro es
 * best-effort: nunca rompe la llamada que lo origina. Días en la zona `reporte.zona`.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Guarda una entrada; cualquier error se traga (solo se avisa en el registro, sin contenido). */
  async record(entry: UsageEntry): Promise<void> {
    try {
      await this.prisma.llmUsage.create({
        data: {
          kind: entry.kind,
          provider: entry.provider.slice(0, 50),
          model: entry.model.slice(0, 200),
          task: entry.task.slice(0, 50),
          inputTokens: int(entry.inputTokens),
          outputTokens: int(entry.outputTokens),
          cachedTokens: int(entry.cachedTokens),
          cacheWriteTokens: int(entry.cacheWriteTokens),
          pages: int(entry.pages),
          estimated: entry.estimated === true,
          threadId: entry.threadId || null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `No se pudo registrar el uso de IA: ${(e as Error)?.name ?? 'error'}`,
      );
    }
  }

  // ---- precios ----

  async getPrices(): Promise<IaPrecios> {
    const s = await this.prisma.setting.findUnique({
      where: { key: PRICES_KEY },
    });
    return normalizePrices(s?.value);
  }

  async savePrices(body: unknown): Promise<IaPrecios> {
    const { value, error } = validatePrices(body);
    if (error || !value) throw new BadRequestException(error);
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: PRICES_KEY },
      create: { key: PRICES_KEY, value: json },
      update: { value: json },
    });
    return value;
  }

  // ---- consultas ----

  private async zone(): Promise<string> {
    try {
      const s = await this.prisma.setting.findUnique({
        where: { key: 'reporte.zona' },
      });
      const z = typeof s?.value === 'string' ? s.value : DEFAULT_REPORT_ZONE;
      return isValidZone(z) ? z : 'UTC';
    } catch {
      return 'UTC';
    }
  }

  private rows(desde: Date, hasta: Date): Promise<UsageRow[]> {
    return this.prisma.llmUsage.findMany({
      where: { createdAt: { gte: desde, lte: hasta } },
      select: {
        createdAt: true,
        kind: true,
        provider: true,
        model: true,
        task: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        cacheWriteTokens: true,
        pages: true,
        estimated: true,
      },
    });
  }

  /** Resumen del periodo: totales, por modelo/actividad y por día. */
  async summary(periodoRaw: unknown, now = new Date()) {
    const periodo: UsagePeriod =
      periodoRaw === undefined || periodoRaw === ''
        ? '7d'
        : (USAGE_PERIODS as readonly unknown[]).includes(periodoRaw)
          ? (periodoRaw as UsagePeriod)
          : badPeriod();
    const zone = await this.zone();
    const hoy = localDate(now, zone);
    const desdeFecha =
      periodo === 'hoy'
        ? hoy
        : periodo === '7d'
          ? addDays(hoy, -6)
          : periodo === '30d'
            ? addDays(hoy, -29)
            : `${hoy.slice(0, 8)}01`;
    const desde = zonedStartOfDay(desdeFecha, zone);
    const [rows, prices] = await Promise.all([
      this.rows(desde, now),
      this.getPrices(),
    ]);

    const totales = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      paginasOcr: 0,
      costo: 0,
    };
    const groups = new Map<
      string,
      {
        kind: string;
        provider: string;
        model: string;
        task: string;
        llamadas: number;
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        cacheWriteTokens: number;
        paginas: number;
        costo: number | null;
        estimado: boolean;
      }
    >();
    const dias = new Map<string, { costo: number; tokens: number }>(
      dayRange(desdeFecha, hoy).map((f) => [f, { costo: 0, tokens: 0 }]),
    );
    const sinPrecio = new Set<string>();
    const ocrSinPrecio = new Set<string>();

    for (const r of rows) {
      const c = costOf(r, prices);
      if (c === null) {
        if (r.kind === 'ocr' || isOcrPriceKey(r.model))
          ocrSinPrecio.add(r.model);
        else sinPrecio.add(r.model);
      }
      totales.inputTokens += r.inputTokens;
      totales.outputTokens += r.outputTokens;
      totales.cachedTokens += r.cachedTokens;
      totales.cacheWriteTokens += r.cacheWriteTokens ?? 0;
      if (r.kind === 'ocr') totales.paginasOcr += r.pages;
      if (c !== null) totales.costo += c;

      const key = JSON.stringify([r.kind, r.provider, r.model, r.task]);
      let g = groups.get(key);
      if (!g) {
        g = {
          kind: r.kind,
          provider: r.provider,
          model: r.model,
          task: r.task,
          llamadas: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          paginas: 0,
          costo: 0,
          estimado: false,
        };
        groups.set(key, g);
      }
      g.llamadas += 1;
      g.inputTokens += r.inputTokens;
      g.outputTokens += r.outputTokens;
      g.cachedTokens += r.cachedTokens;
      g.cacheWriteTokens += r.cacheWriteTokens ?? 0;
      g.paginas += r.pages;
      g.costo = c === null || g.costo === null ? null : g.costo + c;
      g.estimado ||= r.estimated;

      const d = dias.get(localDate(r.createdAt, zone));
      if (d) {
        d.costo += c ?? 0;
        d.tokens += r.inputTokens + r.outputTokens;
      }
    }

    return {
      desde: desde.toISOString(),
      hasta: now.toISOString(),
      moneda: prices.moneda,
      totales: { ...totales, costo: round(totales.costo) },
      porModelo: [...groups.values()]
        .map((g) => ({
          ...g,
          costo: g.costo === null ? null : round(g.costo),
        }))
        .sort(
          (a, b) =>
            (b.costo ?? 0) - (a.costo ?? 0) ||
            b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
        ),
      porDia: [...dias.entries()].map(([fecha, d]) => ({
        fecha,
        costo: round(d.costo),
        tokens: d.tokens,
      })),
      modelosSinPrecio: [...sinPrecio].sort(),
      ocrSinPrecio: [...ocrSinPrecio].sort(),
    };
  }

  /**
   * Pronóstico: promedio diario de costo (solo lo que tiene precio) en los últimos `dias` días
   * locales, proyectado a fin de mes (gasto real del mes + promedio × días que faltan) y a 30 días.
   * El promedio se divide entre los días desde el primer día con datos dentro de la ventana
   * (una instalación nueva no se diluye con días sin uso previos a empezar).
   */
  async forecast(diasRaw: unknown, now = new Date()) {
    const parsed =
      diasRaw === undefined || diasRaw === '' ? 7 : Number(diasRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90)
      throw new BadRequestException(
        'Los días deben ser un número entero entre 1 y 90.',
      );
    const ventanaDias = parsed;
    const zone = await this.zone();
    const hoy = localDate(now, zone);
    const inicioVentana = addDays(hoy, -(ventanaDias - 1));
    const inicioMes = `${hoy.slice(0, 8)}01`;
    const desdeFecha = inicioMes < inicioVentana ? inicioMes : inicioVentana;
    const [rows, prices] = await Promise.all([
      this.rows(zonedStartOfDay(desdeFecha, zone), now),
      this.getPrices(),
    ]);

    let costoVentana = 0;
    let costoMes = 0;
    const fechas = new Set<string>();
    const porModelo = new Map<
      string,
      { model: string; task: string; costo: number }
    >();
    for (const r of rows) {
      const fecha = localDate(r.createdAt, zone);
      const c = costOf(r, prices);
      if (fecha >= inicioMes) costoMes += c ?? 0;
      if (fecha < inicioVentana) continue;
      fechas.add(fecha);
      if (c === null) continue;
      costoVentana += c;
      const key = JSON.stringify([r.model, r.task]);
      const g = porModelo.get(key) ?? {
        model: r.model,
        task: r.task,
        costo: 0,
      };
      g.costo += c;
      porModelo.set(key, g);
    }
    const primera = [...fechas].sort()[0];
    const divisor = primera ? dayRange(primera, hoy).length : ventanaDias;
    const promedioDiario = costoVentana / divisor;
    const restantes = daysInMonth(hoy) - Number(hoy.slice(8, 10));
    return {
      moneda: prices.moneda,
      ventanaDias,
      diasConDatos: fechas.size,
      promedioDiario: round(promedioDiario),
      finDeMes: round(costoMes + promedioDiario * restantes),
      proximos30Dias: round(promedioDiario * 30),
      porModelo: [...porModelo.values()]
        .map((g) => ({
          model: g.model,
          task: g.task,
          promedioDiario: round(g.costo / divisor),
          proximos30Dias: round((g.costo / divisor) * 30),
        }))
        .sort((a, b) => b.promedioDiario - a.promedioDiario),
    };
  }
}

function badPeriod(): never {
  throw new BadRequestException(
    'El periodo debe ser «hoy», «7d», «30d» o «mes».',
  );
}
