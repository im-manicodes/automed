import { dirname, join } from 'node:path';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { PdfTextPage } from './pdf-extract-client.service';

/** Una imagen que cubre más de esta fracción de la página la hace «imagen a página completa». */
const IMAGE_COVERAGE_THRESHOLD = 0.85;

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

interface Line {
  y: number;
  size: number;
  items: TextItem[];
}

/** Una página es digital solo si hay texto suficiente y no es una imagen a página completa. */
export function classifyPage(
  chars: number,
  coverage: number,
  minChars: number,
): 'digital' | 'escaneada' {
  if (chars < minChars) return 'escaneada';
  // Imagen a página completa: es un escaneo. Su capa de texto (sello/folio o el OCR del escáner
  // sobre manuscrito) no es fiable, así que la página pasa por nuestro OCR y su revisión.
  if (coverage > IMAGE_COVERAGE_THRESHOLD) return 'escaneada';
  return 'digital';
}

/** Equivalente a `_normalize` del servicio Python. */
function normalize(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/\0/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extractor de texto de PDFs digitales en Node (pdfjs-dist), alternativa al servicio Python
 * `pdf-extract` (`PDF_TEXT_MODE=node`). Agrupa el texto en líneas por posición, párrafos por
 * separación vertical y encabezados por tamaño de fuente. Sin tablas (menor fidelidad que
 * pymupdf4llm). Nunca lanza ni registra contenido: ante un PDF inválido/protegido devuelve null.
 */
export class PdfTextNode {
  constructor(private readonly minChars: number = 60) {}

  async extract(pdf: Uint8Array): Promise<PdfTextPage[] | null> {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const root = dirname(require.resolve('pdfjs-dist/package.json'));
      const task = pdfjs.getDocument({
        // pdfjs transfiere/consume el buffer: se le pasa una copia.
        data: new Uint8Array(pdf),
        standardFontDataUrl: join(root, 'standard_fonts') + '/',
        cMapUrl: join(root, 'cmaps') + '/',
        cMapPacked: true,
        useSystemFonts: false,
        isEvalSupported: false,
        verbosity: 0,
      });
      const doc = await task.promise;
      try {
        const pages: PdfTextPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          const items: TextItem[] = [];
          for (const it of content.items) {
            if (!('str' in it) || !it.str) continue;
            const t = it.transform as number[];
            const size = Math.hypot(t[2], t[3]) || it.height || 0;
            items.push({
              str: it.str,
              x: t[4],
              y: t[5],
              width: it.width,
              size,
            });
          }
          const chars = items.reduce(
            (a, i) => a + i.str.replace(/\s+/g, '').length,
            0,
          );
          const coverage = await this.imageCoverage(pdfjs, page);
          let kind = classifyPage(chars, coverage, this.minChars);
          let markdown = '';
          if (kind === 'digital') {
            markdown = normalize(this.toMarkdown(items));
            // Sin markdown utilizable: que lo resuelva el OCR.
            if (!markdown) kind = 'escaneada';
          }
          pages.push({
            pageNumber: n,
            kind,
            markdown,
            width: viewport.width,
            height: viewport.height,
            chars,
          });
          page.cleanup();
        }
        return pages;
      } finally {
        await doc.destroy();
      }
    } catch {
      return null;
    }
  }

  /** Mayor fracción de la página cubierta por una sola imagen (como `_image_coverage`). */
  private async imageCoverage(
    pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'),
    page: PDFPageProxy,
  ): Promise<number> {
    try {
      const [x0, y0, x1, y1] = page.view;
      const area = (x1 - x0) * (y1 - y0);
      if (area <= 0) return 0;
      const { OPS } = pdfjs;
      const ops = await page.getOperatorList();
      type M = [number, number, number, number, number, number];
      const mul = (m: M, n: M): M => [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
      ];
      let ctm: M = [1, 0, 0, 1, 0, 0];
      const stack: M[] = [];
      let best = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === OPS.save) stack.push([...ctm] as M);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) {
          const args: unknown = ops.argsArray[i];
          ctm = mul(ctm, args as M);
        } else if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageMaskXObject
        ) {
          const xs: number[] = [];
          const ys: number[] = [];
          for (const [u, v] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            xs.push(ctm[0] * u + ctm[2] * v + ctm[4]);
            ys.push(ctm[1] * u + ctm[3] * v + ctm[5]);
          }
          const w =
            Math.min(Math.max(...xs), x1) - Math.max(Math.min(...xs), x0);
          const h =
            Math.min(Math.max(...ys), y1) - Math.max(Math.min(...ys), y0);
          if (w > 0 && h > 0) best = Math.max(best, w * h);
        }
      }
      return best / area;
    } catch {
      return 0;
    }
  }

  private toMarkdown(items: TextItem[]): string {
    if (!items.length) return '';
    // Tamaño de cuerpo: el más frecuente ponderado por caracteres.
    const weight = new Map<number, number>();
    for (const it of items) {
      const k = Math.round(it.size * 2) / 2;
      weight.set(k, (weight.get(k) ?? 0) + it.str.length);
    }
    const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0] || 10;

    // Líneas: de arriba abajo; se une al renglón actual si la y difiere poco.
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Line[] = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      const tol = Math.max(it.size, last?.size ?? 0) * 0.4;
      if (last && Math.abs(last.y - it.y) <= tol) {
        last.items.push(it);
        last.size = Math.max(last.size, it.size);
      } else {
        lines.push({ y: it.y, size: it.size, items: [it] });
      }
    }

    const out: string[] = [];
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push(para.join('\n'));
      para = [];
    };
    let prev: { y: number; size: number; heading: boolean } | null = null;
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let text = '';
      let end: number | null = null;
      for (const it of line.items) {
        if (end !== null && text) {
          const gap = it.x - end;
          const spaced = text.endsWith(' ') || it.str.startsWith(' ');
          if (!spaced && gap > it.size * 0.15) text += ' ';
        }
        text += it.str;
        end = it.x + it.width;
      }
      text = text.replace(/[ \t]+/g, ' ').trim();
      if (!text) continue;

      const ratio = line.size / body;
      const short = text.length <= 120;
      const level =
        short && ratio >= 1.5
          ? 1
          : short && ratio >= 1.25
            ? 2
            : short && ratio >= 1.1
              ? 3
              : 0;
      const heading = level > 0;
      const gapY = prev ? prev.y - line.y : 0;
      const newPara =
        !prev ||
        heading ||
        prev.heading ||
        gapY > Math.max(line.size, prev.size) * 1.8;
      if (newPara) flush();
      para.push(heading ? `${'#'.repeat(level)} ${text}` : text);
      prev = { y: line.y, size: line.size, heading };
    }
    flush();
    return out.join('\n\n');
  }
}
