import {
  PDFDict,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  rotateInPlace,
  translate,
  drawObject,
  StandardFonts,
} from 'pdf-lib';
import type { PDFPage, PDFRef } from 'pdf-lib';
import { rasterizePdf } from '../ocr/pdf-rasterizer.service';
import { loadPdfTemplate } from './pdf-fill';

/**
 * Vista previa: aplana una COPIA del PDF ya llenado (texto y casillas quedan pintados en el
 * contenido de la página, sin depender de que el visor dibuje widgets) y la rasteriza.
 * El PDF de descarga no se aplana. Pura (sin I/O de red ni BD).
 */
export async function flattenPdf(filled: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdfTemplate(filled);
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(helvetica);
  // `form.flatten()` de pdf-lib borra los hijos de cada campo al quitarlo y falla (-> «Expected
  // instance of PDFDict») cuando dos campos comparten widgets, como los espejados de Cirugía
  // (Text54...). Se pinta cada widget una sola vez y luego se retira el formulario completo.
  const internal = form as unknown as {
    findWidgetPage(w: unknown): PDFPage;
    findWidgetAppearanceRef(f: unknown, w: unknown): PDFRef;
  };
  const seen = new Set<unknown>();
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      if (seen.has(widget.dict)) continue;
      seen.add(widget.dict);
      try {
        const page = internal.findWidgetPage(widget);
        const ref = internal.findWidgetAppearanceRef(field, widget);
        const key = page.node.newXObject('FlatWidget', ref);
        const r = widget.getRectangle();
        page.pushOperators(
          pushGraphicsState(),
          translate(r.x, r.y),
          ...rotateInPlace({ ...r, rotation: 0 }),
          drawObject(key),
          popGraphicsState(),
        );
      } catch {
        // widget sin apariencia o sin página: no se pinta
      }
    }
  }
  // Quita todos los widgets de las páginas y el AcroForm.
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      if (
        a instanceof PDFDict &&
        a.lookup(PDFName.of('Subtype')) === PDFName.of('Widget')
      )
        annots.remove(i);
    }
  }
  doc.catalog.delete(PDFName.of('AcroForm'));
  return doc.save();
}

/** PNG por página del PDF llenado (~100 dpi por defecto; `dpi` configurable). */
export async function renderFormPreview(
  filled: Uint8Array,
  opts: { dpi?: number } = {},
): Promise<Buffer[]> {
  const flat = await flattenPdf(filled);
  const pages = await rasterizePdf(flat, opts.dpi ?? 100);
  return pages.map((p) => Buffer.from(p.png));
}
