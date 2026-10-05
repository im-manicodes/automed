import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfRasterizerService } from './pdf-rasterizer.service';

async function samplePdf(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    doc
      .addPage([200, 100])
      .drawText(`Pagina ${i}`, { x: 10, y: 40, size: 18, font });
  }
  return doc.save();
}

/**
 * pdfjs-dist es ESM y se carga con import() dinámico, que Jest solo admite con
 * --experimental-vm-modules. Sin esa opción el test se omite (ver `pnpm test:raster`).
 */
const canImport = process.execArgv
  .concat(process.env.NODE_OPTIONS ?? '')
  .join(' ')
  .includes('experimental-vm-modules');
const maybe = canImport ? describe : describe.skip;

maybe('PdfRasterizerService', () => {
  it('genera un PNG por página con el tamaño según el DPI', async () => {
    const svc = new PdfRasterizerService({ get: () => undefined } as never);
    const pages = await svc.rasterize(await samplePdf(2), { dpi: 144 });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(pages[0].width).toBe(400); // 200 pt * 144/72
    expect(pages[0].height).toBe(200);
    expect(Buffer.from(pages[0].png.slice(0, 4)).toString('hex')).toBe(
      '89504e47',
    );
  });
});
