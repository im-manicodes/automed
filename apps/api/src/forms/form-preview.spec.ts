import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { renderFormPreview } from './form-preview';
import { fillPdf } from './pdf-fill';

const dir = join(__dirname, '../../assets/formatos');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** pdfjs-dist es ESM (import() dinámico): Jest lo admite solo con --experimental-vm-modules (`pnpm test:preview`). */
const canImport = process.execArgv
  .concat(process.env.NODE_OPTIONS ?? '')
  .join(' ')
  .includes('experimental-vm-modules');
const maybe = canImport ? describe : describe.skip;

maybe('renderFormPreview', () => {
  it.each([
    ['FORMATO_VISITA_DIRECTIVA.pdf', 'nombre'],
    ['FORMATO_INGRESO_PEMEX.pdf', 'Unidad médica'],
    ['FORMATO_CIRUGIA_F03.pdf', 'Text54'],
  ])(
    '%s: un PNG válido por página (< 5 s)',
    async (file, campo) => {
      const tpl = new Uint8Array(readFileSync(join(dir, file)));
      const pages = (await PDFDocument.load(tpl)).getPageCount();
      const { bytes } = await fillPdf(tpl, {
        [campo]: 'José Ángel Muñoz Peña',
      });
      const t0 = Date.now();
      const pngs = await renderFormPreview(bytes);
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(pngs).toHaveLength(pages);
      for (const p of pngs) {
        expect(p.length).toBeGreaterThan(1000);
        expect(p.subarray(0, 8).equals(PNG_SIG)).toBe(true);
      }
    },
    30000,
  );
});
