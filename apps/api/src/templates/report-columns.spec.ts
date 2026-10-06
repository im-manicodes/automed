import {
  DEFAULT_REPORT_TEMPLATE_MARKDOWN,
  parseReportColumns,
  validateReportTemplate,
} from './report-columns';
import { TEMPLATE_KINDS } from './template-kinds';

describe('parseReportColumns', () => {
  it('lee viñetas "- Columna: instrucción" e ignora comentarios y texto suelto', () => {
    const r = parseReportColumns(
      '<!-- ayuda\n- Oculta: no -->\nTexto suelto\n- Paciente: Nombre completo\n* Hospital: Dónde: está\n+ Solo nombre\n',
    );
    expect(r.error).toBeNull();
    expect(r.columnas).toEqual([
      { nombre: 'Paciente', instruccion: 'Nombre completo' },
      { nombre: 'Hospital', instruccion: 'Dónde: está' },
      { nombre: 'Solo nombre', instruccion: 'Solo nombre' },
    ]);
  });

  it('la plantilla por defecto es válida y trae las 14 columnas del plan', () => {
    const r = parseReportColumns(DEFAULT_REPORT_TEMPLATE_MARKDOWN);
    expect(r.error).toBeNull();
    expect(r.columnas.map((c) => c.nombre)).toEqual([
      'Paciente',
      'Hospital',
      'Aseguradora/póliza',
      'Folio/siniestro',
      'Diagnóstico',
      'Fecha de ingreso',
      'Días de estancia',
      'Estatus clínico',
      'Autorización/carta de garantía',
      'Monto/presupuesto',
      'Pendientes con aseguradora',
      'Pendientes con hospital',
      'Próxima acción y responsable',
      'Última novedad (fecha y texto)',
    ]);
    expect(
      TEMPLATE_KINDS.reporte.validate(DEFAULT_REPORT_TEMPLATE_MARKDOWN),
    ).toBeNull();
  });

  it('exige de 1 a 30 columnas', () => {
    expect(validateReportTemplate('sin viñetas')).toContain('al menos una');
    const treinta = Array.from({ length: 30 }, (_, i) => `- C${i}: x`).join(
      '\n',
    );
    expect(validateReportTemplate(treinta)).toBeNull();
    expect(validateReportTemplate(`${treinta}\n- C31: x`)).toContain('30');
  });

  it('rechaza nombres repetidos (sin importar mayúsculas ni acentos) y columnas fijas', () => {
    expect(
      validateReportTemplate('- Diagnóstico: a\n- diagnostico: b'),
    ).toContain('repetida');
    expect(validateReportTemplate('- Novedad: a')).toContain('fija');
    expect(validateReportTemplate('- estatus: a')).toContain('fija');
  });

  it('limita la longitud de nombre e instrucción y rechaza no-texto', () => {
    expect(validateReportTemplate(`- ${'a'.repeat(61)}: x`)).toContain(
      'nombre',
    );
    expect(validateReportTemplate(`- A: ${'x'.repeat(401)}`)).toContain(
      'instrucción',
    );
    expect(validateReportTemplate(42)).toContain('texto');
  });
});
