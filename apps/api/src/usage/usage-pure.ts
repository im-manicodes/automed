/** Funciones puras del uso de IA: precios, costo y fechas locales (sin BD). */

export const OCR_PRICE_KEYS = [
  'textract-detect',
  'textract-analyze',
  'azure-read',
] as const;
export type OcrPriceKey = (typeof OCR_PRICE_KEYS)[number];

export interface ModelPrice {
  /** USD por millón de tokens de entrada. */
  entrada: number;
  /** USD por millón de tokens de salida. */
  salida: number;
  /** USD por millón de tokens leídos de caché (si falta, se cobran como entrada). */
  cacheada?: number;
  /** USD por millón de tokens escritos en caché (si falta, se cobran como entrada). */
  escrituraCache?: number;
}

export interface IaPrecios {
  moneda: 'USD';
  modelos: Record<string, ModelPrice>;
  /** USD por página. */
  ocr: Partial<Record<OcrPriceKey, number>>;
}

export interface UsageRow {
  createdAt: Date;
  kind: string;
  provider: string;
  model: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Tokens escritos en caché (opcional: filas antiguas no lo traen). */
  cacheWriteTokens?: number;
  pages: number;
  estimated: boolean;
}

const MAX_MODELS = 200;
const MAX_MODEL_NAME = 200;
const MAX_PRICE = 1_000_000;

const isPrice = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE;

/** Los motores OCR se precian por página (`ocr`); nunca son modelos de LLM. */
export const isOcrPriceKey = (k: string): boolean =>
  (OCR_PRICE_KEYS as readonly string[]).includes(k);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Lectura tolerante del Setting guardado (descarta lo que no sea válido). */
export function normalizePrices(raw: unknown): IaPrecios {
  const out: IaPrecios = { moneda: 'USD', modelos: {}, ocr: {} };
  if (!isObj(raw)) return out;
  if (isObj(raw.modelos)) {
    for (const [k, v] of Object.entries(raw.modelos)) {
      if (
        !k ||
        isOcrPriceKey(k) ||
        !isObj(v) ||
        !isPrice(v.entrada) ||
        !isPrice(v.salida)
      )
        continue;
      out.modelos[k] = {
        entrada: v.entrada,
        salida: v.salida,
        ...(isPrice(v.cacheada) ? { cacheada: v.cacheada } : {}),
        ...(isPrice(v.escrituraCache)
          ? { escrituraCache: v.escrituraCache }
          : {}),
      };
    }
  }
  if (isObj(raw.ocr)) {
    for (const k of OCR_PRICE_KEYS) {
      if (isPrice(raw.ocr[k])) out.ocr[k] = raw.ocr[k];
    }
  }
  return out;
}

/** Validación estricta del PUT (mensajes en español). */
export function validatePrices(body: unknown): {
  value?: IaPrecios;
  error?: string;
} {
  if (!isObj(body)) return { error: 'Envía los precios como un objeto.' };
  if (body.moneda !== undefined && body.moneda !== 'USD')
    return { error: 'La moneda debe ser USD.' };
  const modelos = body.modelos ?? {};
  const ocr = body.ocr ?? {};
  if (!isObj(modelos))
    return { error: '«modelos» debe ser un objeto con un precio por modelo.' };
  if (!isObj(ocr))
    return { error: '«ocr» debe ser un objeto con el precio por página.' };
  const entries = Object.entries(modelos);
  if (entries.length > MAX_MODELS)
    return { error: `Como máximo ${MAX_MODELS} modelos con precio.` };
  const value: IaPrecios = { moneda: 'USD', modelos: {}, ocr: {} };
  for (const [name, p] of entries) {
    const k = name.trim();
    if (!k || k.length > MAX_MODEL_NAME)
      return { error: 'El nombre de un modelo no es válido.' };
    if (isOcrPriceKey(k)) continue; // motor OCR: se precia por página, no es un modelo
    if (!isObj(p))
      return { error: `El precio del modelo «${k}» no es válido.` };
    for (const f of ['entrada', 'salida'] as const) {
      if (!isPrice(p[f]))
        return {
          error: `El precio de ${f} del modelo «${k}» debe ser un número mayor o igual a 0.`,
        };
    }
    if (p.cacheada !== undefined && p.cacheada !== null && !isPrice(p.cacheada))
      return {
        error: `El precio de lo cacheado del modelo «${k}» debe ser un número mayor o igual a 0.`,
      };
    if (
      p.escrituraCache !== undefined &&
      p.escrituraCache !== null &&
      !isPrice(p.escrituraCache)
    )
      return {
        error: `El precio de escritura en caché del modelo «${k}» debe ser un número mayor o igual a 0.`,
      };
    value.modelos[k] = {
      entrada: p.entrada as number,
      salida: p.salida as number,
      ...(isPrice(p.cacheada) ? { cacheada: p.cacheada } : {}),
      ...(isPrice(p.escrituraCache)
        ? { escrituraCache: p.escrituraCache }
        : {}),
    };
  }
  for (const [k, v] of Object.entries(ocr)) {
    if (!(OCR_PRICE_KEYS as readonly string[]).includes(k))
      return { error: `«${k}» no es un servicio de OCR con precio.` };
    if (v === undefined || v === null) continue;
    if (!isPrice(v))
      return {
        error: `El precio por página de «${k}» debe ser un número mayor o igual a 0.`,
      };
    value.ocr[k as OcrPriceKey] = v;
  }
  return { value };
}

/**
 * Costo de una fila con los precios vigentes, o null si no hay precio. LLM:
 * (entrada − leídos − escritos) × entrada + leídos × cacheada (o entrada)
 * + escritos × escrituraCache (o entrada) + salida × salida, por millón. OCR: páginas × precio por página.
 */
export function costOf(
  r: Pick<
    UsageRow,
    'kind' | 'model' | 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'pages'
  > & { cacheWriteTokens?: number },
  prices: IaPrecios,
): number | null {
  if (r.kind === 'ocr') {
    const p = prices.ocr[r.model as OcrPriceKey];
    return p === undefined ? null : r.pages * p;
  }
  const p = prices.modelos[r.model];
  if (!p) return null;
  const cached = Math.min(r.cachedTokens, r.inputTokens);
  const written = Math.min(r.cacheWriteTokens ?? 0, r.inputTokens - cached);
  return (
    ((r.inputTokens - cached - written) * p.entrada +
      cached * (p.cacheada ?? p.entrada) +
      written * (p.escrituraCache ?? p.entrada) +
      r.outputTokens * p.salida) /
    1_000_000
  );
}

// ---- fechas locales ----

/** 'YYYY-MM-DD' de `d` en la zona dada. */
export function localDate(d: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Desfase (ms) de la zona respecto a UTC en el instante dado. */
function offsetMs(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    g('year'),
    g('month') - 1,
    g('day'),
    g('hour'),
    g('minute'),
    g('second'),
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Instante UTC del inicio (00:00 local) del día 'YYYY-MM-DD' en la zona dada. */
export function zonedStartOfDay(fecha: string, zone: string): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, zone);
  t = guess - offsetMs(t, zone); // corrige si el cambio de horario cae entre medias
  return new Date(t);
}

export function addDays(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Fechas desde `desde` hasta `hasta` (inclusive), máx. 400 días. */
export function dayRange(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let f = desde; f <= hasta && out.length < 400; f = addDays(f, 1))
    out.push(f);
  return out;
}

export function daysInMonth(fecha: string): number {
  const [y, m] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
