import type { OcrPageResult, OcrWord } from './ocr-engine.interface';

export type ClassifiedRegion = OcrWord & { status: 'ok' | 'dudoso' };

/** Unidad de región: líneas si el motor las entrega; si no, palabras. Descarta texto vacío. */
export function regionsOf(page: OcrPageResult): OcrWord[] {
  const src = page.lines && page.lines.length > 0 ? page.lines : page.words;
  return src.filter((r) => r.text.trim().length > 0);
}

/** Marca 'dudoso' toda región con confianza menor al umbral (el umbral mismo cuenta como ok). */
export function classifyRegions(
  regions: OcrWord[],
  threshold: number,
): ClassifiedRegion[] {
  return regions.map((r) => ({
    ...r,
    status: r.confidence < threshold ? 'dudoso' : 'ok',
  }));
}

export function meanConfidence(regions: { confidence: number }[]): number {
  if (regions.length === 0) return 0;
  return regions.reduce((s, r) => s + r.confidence, 0) / regions.length;
}
