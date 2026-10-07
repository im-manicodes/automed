import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfExtractClientService } from './pdf-extract-client.service';
import { PdfTextNode, classifyPage } from './pdf-text-node';

const LONG =
  'El paciente ingresa por urgencias con dolor abdominal de dos dias de evolucion y fiebre.';

async function buildPdf(
  pages: Array<
    { kind: 'text' } | { kind: 'blank' } | { kind: 'scan'; residual?: string }
  >,
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const canvas = createCanvas(40, 40);
  const png = await doc.embedPng(canvas.toBuffer('image/png'));
  for (const p of pages) {
    const page = doc.addPage([600, 800]);
    if (p.kind === 'text') {
      page.drawText('Informe medico', { x: 50, y: 740, size: 24, font: bold });
      page.drawText(LONG, { x: 50, y: 700, size: 11, font });
      page.drawText('Segunda linea del mismo parrafo con mas texto.', {
        x: 50,
        y: 685,
        size: 11,
        font,
      });
      page.drawText('Otro parrafo separado por un espacio vertical grande.', {
        x: 50,
        y: 620,
        size: 11,
        font,
      });
    } else if (p.kind === 'scan') {
      page.drawImage(png, { x: 0, y: 0, width: 600, height: 800 });
      if (p.residual)
        page.drawText(p.residual, { x: 50, y: 50, size: 10, font });
    }
  }
  return new Uint8Array(await doc.save());
}

/**
 * pdfjs-dist es ESM y se carga con import() dinámico, que Jest solo admite con
 * --experimental-vm-modules. Sin esa opción estos tests se omiten
 * (NODE_OPTIONS=--experimental-vm-modules jest src/ocr/pdf-text-node).
 */
const canImport = process.execArgv
  .concat(process.env.NODE_OPTIONS ?? '')
  .join(' ')
  .includes('experimental-vm-modules');
const maybe = canImport ? describe : describe.skip;

describe('classifyPage', () => {
  it('replica las reglas del servicio Python', () => {
    expect(classifyPage(59, 0, 60)).toBe('escaneada');
    expect(classifyPage(60, 0, 60)).toBe('digital');
    expect(classifyPage(100, 0.9, 60)).toBe('escaneada');
    expect(classifyPage(240, 0.9, 60)).toBe('digital');
    expect(classifyPage(100, 0.85, 60)).toBe('digital');
  });
});

maybe('PdfTextNode', () => {
  const node = new PdfTextNode(60);

  it('página con texto: digital, con encabezado, párrafos y dimensiones', async () => {
    const pages = await node.extract(await buildPdf([{ kind: 'text' }]));
    expect(pages).toHaveLength(1);
    const p = pages![0];
    expect(p.pageNumber).toBe(1);
    expect(p.kind).toBe('digital');
    expect(p.width).toBe(600);
    expect(p.height).toBe(800);
    expect(p.chars).toBeGreaterThan(100);
    const [h, para1, para2] = p.markdown.split('\n\n');
    expect(h).toBe('# Informe medico');
    expect(para1).toBe(
      `${LONG}\nSegunda linea del mismo parrafo con mas texto.`,
    );
    expect(para2).toBe('Otro parrafo separado por un espacio vertical grande.');
  });

  it('página sin texto: escaneada, sin markdown', async () => {
    const pages = await node.extract(await buildPdf([{ kind: 'blank' }]));
    expect(pages![0]).toMatchObject({
      kind: 'escaneada',
      markdown: '',
      chars: 0,
    });
  });

  it('mezcla: respeta el orden y clasifica cada página', async () => {
    const pages = await node.extract(
      await buildPdf([{ kind: 'text' }, { kind: 'scan' }, { kind: 'blank' }]),
    );
    expect(pages!.map((p) => [p.pageNumber, p.kind])).toEqual([
      [1, 'digital'],
      [2, 'escaneada'],
      [3, 'escaneada'],
    ]);
  });

  it('imagen a página completa con poco texto residual sigue siendo escaneada', async () => {
    const residual =
      'Folio 123 sello recibido hospital central norte sucursal oriente turno matutino';
    const pages = await node.extract(
      await buildPdf([{ kind: 'scan', residual }]),
    );
    expect(pages![0].chars).toBeGreaterThanOrEqual(60);
    expect(pages![0].chars).toBeLessThan(240);
    expect(pages![0].kind).toBe('escaneada');
  });

  it('PDF inválido devuelve null sin lanzar', async () => {
    expect(await node.extract(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await node.extract(new Uint8Array())).toBeNull();
  });
});

maybe('PdfExtractClientService con PDF_TEXT_MODE=node', () => {
  it('usa el extractor en Node sin llamar a HTTP', async () => {
    const f = jest.fn();
    const real = global.fetch;
    global.fetch = f as any;
    try {
      const svc = new PdfExtractClientService({
        get: (k: string) => ({ PDF_TEXT_MODE: 'node' })[k],
      } as any);
      expect(svc.enabled).toBe(true);
      const pages = await svc.extract(await buildPdf([{ kind: 'text' }]));
      expect(pages![0].kind).toBe('digital');
      expect(await svc.extract(new Uint8Array([1]))).toBeNull();
      expect(f).not.toHaveBeenCalled();
    } finally {
      global.fetch = real;
    }
  });
});
