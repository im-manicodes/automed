import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';
import { fillPdf, fitFontSize } from './pdf-fill';

const dir = join(__dirname, '../../assets/formatos');
const load = (n: string) => new Uint8Array(readFileSync(join(dir, n)));

async function reload(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  // cirugía has null refs in /Fields; reuse the same cleanup through a second fill-free load
  return doc;
}

function textOf(doc: PDFDocument, name: string): string[] {
  return doc
    .getForm()
    .getFields()
    .filter((f) => f.getName() === name && f instanceof PDFTextField)
    .map((f) => (f as PDFTextField).getText() ?? '');
}

describe('fillPdf', () => {
  it('rellena FORMATO_INGRESO_PEMEX', async () => {
    const { bytes, missing } = await fillPdf(
      load('FORMATO_INGRESO_PEMEX.pdf'),
      {
        'Unidad médica': 'Hospital Peña Ñandú',
        'Cirugías previas': 'Colecistectomía en 2019\nApendicectomía',
        'Enfermedad general': true,
        'no existe': 'x',
      },
    );
    const doc = await reload(bytes);
    const form = doc.getForm();
    expect(textOf(doc, 'Unidad médica')).toEqual(['Hospital Peña Ñandú']);
    expect(textOf(doc, 'Cirugías previas')).toEqual([
      'Colecistectomía en 2019\nApendicectomía',
    ]);
    expect(
      (form.getField('Enfermedad general') as PDFCheckBox).isChecked(),
    ).toBe(true);
    expect(missing).toEqual(['no existe']);
  });

  it('rellena FORMATO_VISITA_DIRECTIVA', async () => {
    const { bytes, missing } = await fillPdf(
      load('FORMATO_VISITA_DIRECTIVA.pdf'),
      {
        nombre: 'José Ángel Muñoz',
        servicio: 'Cardiología',
        'La naturaleza  de su internamiento es 1':
          'Internamiento por atención médica. '.repeat(10),
      },
    );
    const doc = await reload(bytes);
    expect(textOf(doc, 'nombre')).toEqual(['José Ángel Muñoz']);
    expect(textOf(doc, 'servicio')).toEqual(['Cardiología']);
    expect(textOf(doc, 'La naturaleza  de su internamiento es 1')[0]).toContain(
      'Internamiento',
    );
    expect(missing).toEqual([]);
  });

  it('rellena FORMATO_CIRUGIA_F03 pese a referencias nulas y nombres repetidos', async () => {
    const tpl = load('FORMATO_CIRUGIA_F03.pdf');
    const { bytes, missing } = await fillPdf(tpl, {
      DÍA: '12',
      'nombre 1': 'María Núñez Peña',
      Text54: 'Dr. Sánchez',
      m1: true,
      zzz: 'x',
      'caracter raro': '€',
    });
    const doc = await reload(bytes).catch(async () => {
      // si pdf-lib no puede listar campos del resultado, falla el test
      throw new Error('el resultado no se puede recargar');
    });
    expect(textOf(doc, 'DÍA')).toEqual(['12']);
    expect(textOf(doc, 'nombre 1')).toEqual(['María Núñez Peña']);
    const t54 = textOf(doc, 'Text54');
    expect(t54.length).toBeGreaterThan(1);
    expect(new Set(t54)).toEqual(new Set(['Dr. Sánchez']));
    expect((doc.getForm().getField('m1') as PDFCheckBox).isChecked()).toBe(
      true,
    );
    expect(missing).toEqual(['zzz', 'caracter raro']);
  });

  it('no tumba el proceso con caracteres fuera de WinAnsi', async () => {
    const { bytes } = await fillPdf(load('FORMATO_VISITA_DIRECTIVA.pdf'), {
      nombre: 'Ana ✓ 日本 Žofia €',
    });
    const doc = await PDFDocument.load(bytes);
    expect(textOf(doc, 'nombre')[0]).toContain('Ana');
  });
});

describe('fitFontSize', () => {
  let font: PDFFont;
  beforeAll(async () => {
    const d = await PDFDocument.create();
    font = await d.embedFont(StandardFonts.Helvetica);
  });
  const base = { widthPt: 200, heightPt: 60, multiline: true, maxSize: 10 };

  it('texto corto = maxSize', () => {
    expect(fitFontSize({ ...base, text: 'Hola', font })).toBe(10);
  });
  it('decrece con texto más largo y respeta límites', () => {
    const a = fitFontSize({ ...base, text: 'palabra '.repeat(30), font });
    const b = fitFontSize({ ...base, text: 'palabra '.repeat(90), font });
    expect(b).toBeLessThan(a);
    expect(a).toBeLessThanOrEqual(10);
    const c = fitFontSize({ ...base, text: 'palabra '.repeat(2000), font });
    expect(c).toBe(5);
  });
  it('multilínea envuelve por palabras (cabe donde una línea no)', () => {
    const text = 'palabra '.repeat(20);
    const single = fitFontSize({ ...base, text, multiline: false, font });
    const multi = fitFontSize({ ...base, text, font });
    expect(multi).toBeGreaterThan(single);
  });
  it('respeta saltos de línea', () => {
    const h = { ...base, heightPt: 30 };
    expect(fitFontSize({ ...h, text: 'a', font })).toBe(10);
    expect(fitFontSize({ ...h, text: 'a\nb\nc\nd\ne\nf', font })).toBeLessThan(
      10,
    );
  });
  it('una línea baja hasta que cabe el ancho', () => {
    const s = fitFontSize({
      text: 'x'.repeat(30),
      widthPt: 150,
      heightPt: 20,
      multiline: false,
      font,
      maxSize: 10,
    });
    expect(s).toBeLessThan(10);
    expect(font.widthOfTextAtSize('x'.repeat(30), s)).toBeLessThanOrEqual(146);
  });
});

describe('fillPdf tamaño de letra', () => {
  it('Visita directiva: el campo largo no supera 10 pt', async () => {
    const name = 'La naturaleza  de su internamiento es 1';
    const { bytes } = await fillPdf(load('FORMATO_VISITA_DIRECTIVA.pdf'), {
      [name]: 'Está internado por hematomas subdurales bilaterales. '.repeat(6),
    });
    const doc = await PDFDocument.load(bytes);
    const f = doc.getForm().getTextField(name);
    const da = f.acroField.getDefaultAppearance() ?? '';
    const size = parseFloat(/([\d.]+)\s+Tf/.exec(da)![1]);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(10);
    const ap = f.acroField.getWidgets()[0].getNormalAppearance();
    const stream = (ap as any).getContentsString?.() ?? '';
    for (const m of stream.matchAll(/([\d.]+)\s+Tf/g))
      expect(parseFloat(m[1])).toBeLessThanOrEqual(10);
  });
});
