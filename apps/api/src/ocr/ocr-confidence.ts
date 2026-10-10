/** Reglas de confianza del OCR: una palabra muy débil o una página en general pobre piden revisión. */

/** Una línea con una palabra por debajo de este valor toma esa confianza (Azure). */
export const LINE_MIN_WORD_CONFIDENCE = 0.7;
/** Una página con confianza media menor a este valor se manda a revisión. */
export const PAGE_REVIEW_CONFIDENCE = 0.75;
/** Desde este valor la lectura se considera «alta». */
export const LEVEL_HIGH = 0.9;
/** Máximo de líneas que se marcan por página por baja confianza general. */
export const MAX_FLAGGED_PER_PAGE = 10;

export type ConfidenceLevel = 'digital' | 'alta' | 'media' | 'baja';

export interface ConfidenceRegion {
  text: string;
  confidence: number;
  userText?: string | null;
}

/** `null` = página digital (texto del PDF, sin OCR). */
export function confidenceLevel(c: number | null): ConfidenceLevel {
  if (c === null) return 'digital';
  if (c >= LEVEL_HIGH) return 'alta';
  if (c >= PAGE_REVIEW_CONFIDENCE) return 'media';
  return 'baja';
}

/**
 * Confianza de una página (0..1): media ponderada por el largo del texto. Una región corregida
 * por el usuario cuenta como 1. Sin regiones (página digital) -> null.
 */
export function pageConfidence(regions: ConfidenceRegion[]): number | null {
  if (regions.length === 0) return null;
  let weight = 0;
  let sum = 0;
  for (const r of regions) {
    const w = Math.max(1, (r.userText?.trim() || r.text).length);
    weight += w;
    sum += w * (r.userText?.trim() ? 1 : r.confidence);
  }
  return sum / weight;
}

/**
 * Si ninguna línea falló por sí sola pero la página en conjunto es pobre, marca como dudosas las
 * líneas más débiles (bajo la media de la página, máx. `MAX_FLAGGED_PER_PAGE`) para que haya
 * recuadros que corregir.
 */
export function flagLowConfidencePage<
  T extends ConfidenceRegion & { status: 'ok' | 'dudoso' },
>(regions: T[]): T[] {
  if (regions.some((r) => r.status === 'dudoso')) return regions;
  const mean = pageConfidence(regions);
  if (mean === null || mean >= PAGE_REVIEW_CONFIDENCE) return regions;
  const weakest = new Set(
    regions
      .filter((r) => r.confidence <= mean)
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, MAX_FLAGGED_PER_PAGE),
  );
  return regions.map((r) =>
    weakest.has(r) ? { ...r, status: 'dudoso' as const } : r,
  );
}
