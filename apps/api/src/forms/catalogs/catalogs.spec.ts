import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFRadioGroup } from 'pdf-lib';
import { fillPdf, loadPdfTemplate } from '../pdf-fill';
import {
  CATALOGS,
  catalogPdfNames,
  catalogToPdfValues,
  getCatalog,
  validateDraft,
  type FormCatalog,
} from './index';

const dir = join(__dirname, '../../../assets/formatos');
const load = (c: FormCatalog) =>
  new Uint8Array(readFileSync(join(dir, c.archivo)));

describe.each(CATALOGS)('catálogo $id', (catalog) => {
  let template: Uint8Array;
  let pdfNames: Set<string>;
  let radios: Map<string, string[]>;

  beforeAll(async () => {
    template = load(catalog);
    const doc = await loadPdfTemplate(template);
    const fields = doc.getForm().getFields();
    pdfNames = new Set(fields.map((f) => f.getName()));
    radios = new Map(
      fields
        .filter((f): f is PDFRadioGroup => f instanceof PDFRadioGroup)
        .map((f) => [f.getName(), f.getOptions()]),
    );
  });

  it('claves únicas y snake_case', () => {
    const claves = catalog.campos.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const k of claves) expect(k).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it('cada campo PDF del catálogo existe en el PDF', () => {
    const faltan: string[] = [];
    for (const c of catalog.campos) {
      for (const n of c.pdfCampos) if (!pdfNames.has(n)) faltan.push(n);
      for (const o of c.opciones ?? []) {
        if (c.radio) {
          if (!radios.get(c.radio)?.includes(o.pdfCampo))
            faltan.push(`${c.radio}/${o.pdfCampo}`);
        } else if (!pdfNames.has(o.pdfCampo)) faltan.push(o.pdfCampo);
      }
    }
    expect(faltan).toEqual([]);
  });

  it('el catálogo cubre todos los campos del PDF', () => {
    const cubiertos = catalogPdfNames(catalog);
    const sinCubrir = [...pdfNames].filter((n) => !cubiertos.has(n));
    expect(sinCubrir).toEqual([]);
  });

  it('opciones coherentes y soloManual sin pista', () => {
    for (const c of catalog.campos) {
      if (c.tipo === 'opcion') expect(c.opciones?.length).toBeGreaterThan(1);
      else expect(c.opciones).toBeUndefined();
      if (c.soloManual) expect(c.pista).toBe('');
      else expect(c.pista.length).toBeGreaterThan(5);
    }
  });

  it('catalogToPdfValues + fillPdf produce un PDF válido sin campos faltantes', async () => {
    const valores: Record<string, string | boolean | null> = {};
    for (const c of catalog.campos) {
      if (c.tipo === 'casilla') valores[c.clave] = true;
      else if (c.tipo === 'opcion') valores[c.clave] = c.opciones![0].valor;
      else if (c.tipo === 'fecha') valores[c.clave] = '2026-03-05';
      else valores[c.clave] = `Prueba ñ ${c.clave}`;
    }
    for (const input of [valores, {}]) {
      const { bytes, missing } = await fillPdf(
        template,
        catalogToPdfValues(catalog, input),
      );
      expect(missing).toEqual([]);
      const out = await loadPdfTemplate(bytes);
      expect(out.getPageCount()).toBeGreaterThan(0);
    }
  });

  it('con borrador vacío vacía los valores de fábrica salvo porDefecto', () => {
    const v = catalogToPdfValues(catalog, {});
    for (const c of catalog.campos) {
      if (c.tipo === 'texto' || c.tipo === 'texto_largo')
        for (const n of c.pdfCampos)
          expect(v[n]).toBe(
            typeof c.porDefecto === 'string' ? c.porDefecto : '',
          );
    }
  });
});

describe('catalogToPdfValues', () => {
  it('opción con casillas: true en la elegida y false en las demás', () => {
    const cat = getCatalog('cirugia-f03')!;
    const v = catalogToPdfValues(cat, { sexo: 'femenino' });
    expect(v).toMatchObject({ m1: false, f1: true });
  });

  it('opción radio y grupo compartido (el primero elegido gana)', () => {
    const cat = getCatalog('ingreso-pemex')!;
    expect(catalogToPdfValues(cat, { triage: 'verde' }).Group1).toBe(
      'Opción23',
    );
    expect(catalogToPdfValues(cat, {}).Group1).toBe('');
    expect(
      catalogToPdfValues(cat, { sexo: 'femenino', triage: 'verde' }).Group1,
    ).toBe('Opción2');
  });

  it('fecha: 3 campos separados o dd/mm/aaaa', () => {
    const cir = catalogToPdfValues(getCatalog('cirugia-f03')!, {
      fecha_inicio_padecimiento: '2026-03-05',
    });
    expect(cir).toMatchObject({ DÍA: '05', MES: '03', AÑO: '2026' });
    const ing = catalogToPdfValues(getCatalog('ingreso-pemex')!, {
      fecha_nacimiento: '1950-12-31',
    });
    expect(ing['Nombre completo']).toBe('31/12/1950');
  });

  it('sufijo fijo tras el texto y porDefecto conservado con null', () => {
    const cat = getCatalog('visita-directiva')!;
    const v = catalogToPdfValues(cat, { naturaleza_internamiento: 'Hola' });
    expect(v['La naturaleza  de su internamiento es 1']).toBe(
      'Hola\n\nPEMEX SE RESERVA DERECHO DE TRASLADO',
    );
    expect(catalogToPdfValues(cat, { unidad_medica: null }).Text1).toBe(
      '50 DOCTORS S.A DE C.V.',
    );
  });
});

describe('validateDraft', () => {
  const cat = getCatalog('ingreso-pemex')!;

  it('descarta claves fuera del catálogo y las reporta', () => {
    const r = validateDraft(cat, { edad: '67 años', inventado: 'x' });
    expect(r.valores).toEqual({ edad: '67 años' });
    expect(r.errores.join()).toContain('inventado');
  });

  it('rechaza opciones, tipos, fechas y longitudes inválidos', () => {
    const r = validateDraft(cat, {
      sexo: 'otro',
      alergia_alimentaria: 'sí',
      fecha_nacimiento: '1950-02-31',
      edad: 'x'.repeat(50),
      peso: 80,
    });
    expect(r.valores).toEqual({});
    expect(r.errores).toHaveLength(5);
  });

  it('acepta valores válidos y null', () => {
    const r = validateDraft(cat, {
      sexo: 'masculino',
      alergia_alimentaria: true,
      fecha_nacimiento: '1950-02-03',
      peso: null,
    });
    expect(r.errores).toEqual([]);
    expect(r.valores).toEqual({
      sexo: 'masculino',
      alergia_alimentaria: true,
      fecha_nacimiento: '1950-02-03',
      peso: null,
    });
  });

  it('un borrador que no es objeto da error', () => {
    expect(validateDraft(cat, 'x').errores).toHaveLength(1);
  });
});
