import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';

export type PdfFillValues = Record<string, string | boolean>;

export interface PdfFillResult {
  bytes: Uint8Array;
  /** Field names from `values` that do not exist in the PDF (or could not be set). */
  missing: string[];
}

const DEFAULT_MAX_FONT_SIZE = 10;
const MIN_FONT_SIZE = 5;
/** pdf-lib spaces multiline text at heightAtSize * 1.2. */
const LINE_HEIGHT_FACTOR = 1.2;

export interface FitFontSizeInput {
  text: string;
  widthPt: number;
  heightPt: number;
  multiline: boolean;
  font: Pick<PDFFont, 'widthOfTextAtSize' | 'heightAtSize'>;
  maxSize: number;
  minSize?: number;
  padding?: number;
}

/** Number of lines the text takes at `size` (word wrap, honours `\n`). */
function wrappedLineCount(
  text: string,
  size: number,
  maxWidth: number,
  font: FitFontSizeInput['font'],
): number {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/ +/).filter((w) => w !== '');
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let current = '';
    let count = 1;
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        count += 1;
        current = word;
      } else current = candidate;
      // a single word wider than the box breaks by characters
      const w = font.widthOfTextAtSize(current, size);
      if (w > maxWidth) {
        const extra = Math.ceil(w / maxWidth) - 1;
        count += extra;
        current = '';
      }
    }
    lines += count;
  }
  return lines;
}

/**
 * Largest font size (0.5 pt steps, between minSize and maxSize) at which `text` fits the box.
 * Pure. Never returns below minSize (even if it does not fit) nor above maxSize.
 */
export function fitFontSize(input: FitFontSizeInput): number {
  const { text, widthPt, heightPt, multiline, font, maxSize } = input;
  const minSize = Math.min(input.minSize ?? MIN_FONT_SIZE, maxSize);
  const padding = input.padding ?? 2;
  const availW = Math.max(1, widthPt - 2 * padding);
  const availH = Math.max(1, heightPt - 2 * padding);
  for (let size = maxSize; size > minSize; size -= 0.5) {
    if (multiline) {
      const lines = wrappedLineCount(text, size, availW, font);
      if (lines * font.heightAtSize(size) * LINE_HEIGHT_FACTOR <= availH)
        return size;
    } else {
      if (
        font.widthOfTextAtSize(text, size) <= availW &&
        font.heightAtSize(size) <= availH
      )
        return size;
    }
  }
  return minSize;
}

/** Font size from the field's /DA (e.g. `/Helv 9 Tf 0 g`); 0/absent -> default. */
function originalFontSize(field: PDFTextField): number {
  const da = field.acroField.getDefaultAppearance() ?? '';
  const m = /([\d.]+)\s+Tf/.exec(da);
  const n = m ? parseFloat(m[1]) : 0;
  return n > 0 ? n : DEFAULT_MAX_FONT_SIZE;
}

/** Remove null / non-dictionary entries from /AcroForm/Fields (pdf-lib throws on them). */
function cleanAcroFormFields(doc: PDFDocument): void {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) return;
  const fields = acro.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) return;
  for (let i = fields.size() - 1; i >= 0; i--) {
    if (!(fields.lookup(i) instanceof PDFDict)) fields.remove(i);
  }
}

/** Replace characters that WinAnsi (Helvetica) cannot encode; keeps newlines. */
function sanitizeText(text: string, font: PDFFont): string {
  const cache = new Map<string, string>();
  let out = '';
  for (const ch of text.normalize('NFC').replace(/\r\n?/g, '\n')) {
    let r = cache.get(ch);
    if (r === undefined) {
      if (ch === '\n') r = ch;
      else if (ch === '\t') r = ' ';
      else {
        try {
          font.encodeText(ch);
          r = ch;
        } catch {
          const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
          r =
            base !== ch && base.length > 0 && canEncode(base, font) ? base : '';
        }
      }
      cache.set(ch, r);
    }
    out += r;
  }
  return out;
}

function canEncode(text: string, font: PDFFont): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Loads a PDF form template with the null-ref cleanup applied (shared with tests). */
export async function loadPdfTemplate(
  template: Uint8Array,
): Promise<PDFDocument> {
  const doc = await PDFDocument.load(template, { updateMetadata: false });
  cleanAcroFormFields(doc);
  return doc;
}

/**
 * Fills the AcroForm fields of a PDF. Keys of `values` are PDF field names.
 * Does not flatten: fields stay editable. Pure (no I/O).
 */
export async function fillPdf(
  template: Uint8Array,
  values: PdfFillValues,
): Promise<PdfFillResult> {
  const doc = await loadPdfTemplate(template);
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const byName = new Map<string, ReturnType<typeof form.getFields>>();
  for (const f of form.getFields()) {
    const list = byName.get(f.getName());
    if (list) list.push(f);
    else byName.set(f.getName(), [f]);
  }

  const missing: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const fields = byName.get(name);
    if (!fields) {
      missing.push(name);
      continue;
    }
    let applied = false;
    for (const field of fields) {
      try {
        if (field instanceof PDFTextField) {
          const text = sanitizeText(
            String(value === true ? 'X' : value === false ? '' : value),
            helvetica,
          );
          const max = field.getMaxLength();
          field.setText(
            text === '' ? undefined : max ? text.slice(0, max) : text,
          );
          if (text !== '') {
            const maxSize = originalFontSize(field);
            const widgets = field.acroField.getWidgets();
            let w = Infinity;
            let h = Infinity;
            for (const widget of widgets) {
              const r = widget.getRectangle();
              if (r.width * r.height < w * h) {
                w = r.width;
                h = r.height;
              }
            }
            const size = Number.isFinite(w)
              ? fitFontSize({
                  text: max ? text.slice(0, max) : text,
                  widthPt: w,
                  heightPt: h,
                  multiline: field.isMultiline(),
                  font: helvetica,
                  maxSize,
                })
              : maxSize;
            try {
              field.setFontSize(size);
            } catch {
              // sin /DA: se crea uno (pdf-lib exige uno para fijar el tamaño)
              field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
            }
          }
          applied = true;
        } else if (field instanceof PDFCheckBox) {
          const on =
            value === true ||
            (typeof value === 'string' &&
              /^(true|si|sí|x|1|on)$/i.test(value.trim()));
          if (on) field.check();
          else field.uncheck();
          applied = true;
        } else if (field instanceof PDFRadioGroup) {
          const opts = field.getOptions();
          const wanted = String(value);
          if (value === false || wanted === '') {
            field.clear();
            applied = true;
          } else if (opts.includes(wanted)) {
            field.select(wanted);
            applied = true;
          }
        }
      } catch {
        // field could not be set; reported below
      }
    }
    if (!applied) missing.push(name);
  }

  form.updateFieldAppearances(helvetica);
  return { bytes: await doc.save(), missing };
}
