import { LINE_MIN_WORD_CONFIDENCE } from './ocr-confidence';
import type { OcrPageResult, OcrWord } from './ocr-engine.interface';

interface AzureSpan {
  offset: number;
  length: number;
}

export interface AzureWord {
  content: string;
  polygon?: number[];
  confidence?: number;
  span?: AzureSpan;
}

export interface AzureLine {
  content: string;
  polygon?: number[];
  spans?: AzureSpan[];
}

export interface AzurePage {
  width?: number;
  height?: number;
  words?: AzureWord[];
  lines?: AzureLine[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Caja normalizada (0..1) que envuelve el polígono [x1,y1,x2,y2,...] en píxeles/pulgadas. */
function boxOf(polygon: number[] | undefined, width: number, height: number) {
  if (!polygon || polygon.length < 4 || !width || !height) return null;
  const xs = polygon.filter((_, i) => i % 2 === 0);
  const ys = polygon.filter((_, i) => i % 2 === 1);
  const x = clamp01(Math.min(...xs) / width);
  const y = clamp01(Math.min(...ys) / height);
  return {
    x,
    y,
    w: Math.min(clamp01((Math.max(...xs) - Math.min(...xs)) / width), 1 - x),
    h: Math.min(clamp01((Math.max(...ys) - Math.min(...ys)) / height), 1 - y),
  };
}

/**
 * Azure AI Document Intelligence (prebuilt-read) entrega polígonos en la unidad de la página
 * (píxeles en imágenes) y confianza 0..1 solo por palabra. Las líneas no traen confianza: se
 * promedia la de las palabras cuyo `span` cae dentro del `span` de la línea; si alguna palabra
 * baja de `LINE_MIN_WORD_CONFIDENCE`, la línea toma esa confianza.
 */
export function mapAzurePage(
  page: AzurePage | undefined,
  pageNumber: number,
): OcrPageResult {
  const width = page?.width ?? 0;
  const height = page?.height ?? 0;
  const words: OcrWord[] = [];
  const wordSpans: { w: OcrWord; offset: number }[] = [];
  for (const aw of page?.words ?? []) {
    const box = boxOf(aw.polygon, width, height);
    if (!box || !aw.content) continue;
    const w: OcrWord = {
      text: aw.content,
      confidence: clamp01(aw.confidence ?? 0),
      box,
    };
    words.push(w);
    if (aw.span) wordSpans.push({ w, offset: aw.span.offset });
  }
  const lines: OcrWord[] = [];
  for (const al of page?.lines ?? []) {
    const box = boxOf(al.polygon, width, height);
    if (!box || !al.content) continue;
    const span = al.spans?.[0];
    const inside = span
      ? wordSpans.filter(
          (s) =>
            s.offset >= span.offset && s.offset < span.offset + span.length,
        )
      : [];
    const mean = inside.length
      ? inside.reduce((a, s) => a + s.w.confidence, 0) / inside.length
      : 0;
    const weakest = inside.length
      ? Math.min(...inside.map((s) => s.w.confidence))
      : 0;
    // Una palabra muy débil no se diluye en el promedio de su línea.
    const confidence = weakest < LINE_MIN_WORD_CONFIDENCE ? weakest : mean;
    lines.push({ text: al.content, confidence, box });
  }
  return { pageNumber, words, lines };
}
