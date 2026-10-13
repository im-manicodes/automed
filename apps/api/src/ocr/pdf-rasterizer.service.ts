import { Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { OcrSettingsService } from '../settings/ocr-settings.service';

export interface RasterPage {
  pageNumber: number; // 1-based
  width: number;
  height: number;
  png: Uint8Array;
}

/** Tope del lado mayor en píxeles (evita imágenes gigantes en planos/hojas enormes). */
const MAX_SIDE_PX = 6000;

/**
 * Rasteriza un PDF a PNG por página sin binarios del sistema: pdfjs-dist (WASM/JS) +
 * @napi-rs/canvas. pdfjs-dist 4.x es ESM, por eso se carga con import() dinámico.
 * Función pura compartida por el OCR y la vista previa de formatos.
 */
export async function rasterizePdf(
  pdf: Uint8Array,
  dpi: number,
): Promise<RasterPage[]> {
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
  const pages: RasterPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const side = Math.max(base.width, base.height) * scale;
      if (side > MAX_SIDE_PX) scale *= MAX_SIDE_PX / side;
      const viewport = page.getViewport({ scale });
      const factory = doc.canvasFactory as {
        create(
          w: number,
          h: number,
        ): {
          canvas: { toBuffer(mime: 'image/png'): Buffer };
          context: unknown;
        };
      };
      const { canvas, context } = factory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvasContext: context as never,
        viewport,
      }).promise;
      pages.push({
        pageNumber: n,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        png: new Uint8Array(canvas.toBuffer('image/png')),
      });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/** Servicio del OCR: resuelve el dpi configurado y delega en `rasterizePdf`. */
@Injectable()
export class PdfRasterizerService {
  constructor(private readonly ocrSettings: OcrSettingsService) {}

  async rasterize(
    pdf: Uint8Array,
    opts: { dpi?: number } = {},
  ): Promise<RasterPage[]> {
    const dpi = opts.dpi ?? (await this.ocrSettings.getEffective()).renderDpi;
    return rasterizePdf(pdf, dpi);
  }
}
