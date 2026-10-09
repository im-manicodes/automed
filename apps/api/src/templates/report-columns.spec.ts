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

  it('la plantilla por defecto es válida y trae las 21 columnas del censo A-U', () => {
    const r = parseReportColumns(DEFAULT_REPORT_TEMPLATE_MARKDOWN);
    expect(r.error).toBeNull();
    expect(r.columnas).toHaveLength(21);
    expect(r.columnas.map((c) => c.nombre)).toEqual([
      'REGION',
      'LOCALIDAD',
      'PRESTADOR DE SERVICIO',
      'NUMERO DE CONTRATO',
      'FECHA DE INGRESO (AAAA-MM-DD)',
      'TIPO DE INGRESO',
      'DIAS DE ESTANCIA HOSPITALARIA',
      'ESTATUS DE LA HOSPITALIZACION (ACTIVA/ALTA)',
      'FECHA DE REPORTE DE LA GESTIÓN OPERATIVA Y/O EGRESO',
      'NOMBRE DEL PACIENTE HOSPITALIZADO (APELLIDOS NOMBRE)',
      'FICHA',
      'CODIFICACION',
      'EDAD (AÑOS)',
      'GENERO (MASCULINO/FEMENINO)',
      'DIAGNOSTICO',
      'CIE-10',
      'ESPECIALIDAD',
      'TIPO DE MANEJO (MEDICO/QUIRURGICO)',
      'EVOLUCION INICIAL (DÍA 1)',
      'PLAN DE MANEJO INTRAHOSPITALARIO',
      'EVOLUCION',
    ]);
    for (const c of r.columnas) {
      expect(c.nombre.length).toBeLessThanOrEqual(60);
      expect(c.instruccion.length).toBeLessThanOrEqual(400);
    }
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
