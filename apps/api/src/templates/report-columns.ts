/**
 * Plantilla de tipo 'reporte': lista markdown `- Columna: instrucción para la IA`.
 * Parser puro (sin dependencias de Nest/Prisma) y validación.
 */
export interface ReportColumn {
  nombre: string;
  instruccion: string;
}

export const MIN_REPORT_COLUMNS = 1;
export const MAX_REPORT_COLUMNS = 30;
export const MAX_REPORT_COLUMN_NAME = 60;
export const MAX_REPORT_COLUMN_INSTRUCTION = 400;
export const MAX_REPORT_TEMPLATE_CHARS = 8000;

/** Columnas fijas del Excel: una columna de la plantilla no puede llamarse igual. */
export const FIXED_REPORT_COLUMNS = [
  'Novedad',
  'Qué cambió',
  'Estatus',
  'Última actualización',
  'Enlace al ticket',
] as const;

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const BULLET = /^\s*[-*+]\s+(.*)$/;

export interface ParsedReportColumns {
  columnas: ReportColumn[];
  /** Mensaje en español (primer problema) o null si es válida. */
  error: string | null;
}

/**
 * Lee las viñetas `- Nombre: instrucción` (se ignoran comentarios <!-- --> y las líneas que no
 * son viñetas). Sin ":" la instrucción queda igual al nombre. No lanza: devuelve `error`.
 */
export function parseReportColumns(markdown: unknown): ParsedReportColumns {
  if (typeof markdown !== 'string')
    return { columnas: [], error: 'La plantilla debe ser texto' };
  if (markdown.length > MAX_REPORT_TEMPLATE_CHARS * 2)
    return { columnas: [], error: 'La plantilla es demasiado larga' };
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const columnas: ReportColumn[] = [];
  const seen = new Set<string>();
  let error: string | null = null;
  const fail = (m: string) => {
    if (!error) error = m;
  };
  for (const line of text.split(/\r?\n/)) {
    const m = BULLET.exec(line);
    if (!m) continue;
    const body = m[1].trim();
    if (!body) continue;
    const i = body.indexOf(':');
    const nombre = (i >= 0 ? body.slice(0, i) : body).trim();
    const instruccion = (i >= 0 ? body.slice(i + 1).trim() : '') || nombre;
    if (!nombre) {
      fail('Hay una columna sin nombre');
      continue;
    }
    if (nombre.length > MAX_REPORT_COLUMN_NAME)
      fail(
        `El nombre de la columna "${nombre.slice(0, 20)}…" supera ${MAX_REPORT_COLUMN_NAME} caracteres`,
      );
    if (instruccion.length > MAX_REPORT_COLUMN_INSTRUCTION)
      fail(
        `La instrucción de "${nombre}" supera ${MAX_REPORT_COLUMN_INSTRUCTION} caracteres`,
      );
    const k = norm(nombre);
    if (seen.has(k)) fail(`La columna "${nombre}" está repetida`);
    else if (FIXED_REPORT_COLUMNS.some((f) => norm(f) === k))
      fail(`"${nombre}" ya es una columna fija del Excel`);
    seen.add(k);
    columnas.push({ nombre, instruccion });
  }
  if (columnas.length < MIN_REPORT_COLUMNS)
    fail('Agrega al menos una columna con el formato "- Nombre: instrucción"');
  else if (columnas.length > MAX_REPORT_COLUMNS)
    fail(`Máximo ${MAX_REPORT_COLUMNS} columnas`);
  return { columnas, error };
}

export function validateReportTemplate(markdown: unknown): string | null {
  if (typeof markdown !== 'string') return 'La plantilla debe ser texto';
  if (markdown.trim().length > MAX_REPORT_TEMPLATE_CHARS)
    return `La plantilla supera ${MAX_REPORT_TEMPLATE_CHARS} caracteres`;
  return parseReportColumns(markdown).error;
}

export const DEFAULT_REPORT_TEMPLATE_NAME = 'Columnas del reporte estándar';

export const DEFAULT_REPORT_TEMPLATE_MARKDOWN = `<!-- Una columna por viñeta: "- Nombre de la columna: instrucción para la IA". Si un dato no aparece en el resumen, la celda queda vacía. -->
- Paciente: Nombre completo del paciente.
- Hospital: Hospital o clínica donde está hospitalizado.
- Aseguradora/póliza: Aseguradora y número de póliza, si aparecen.
- Folio/siniestro: Número de folio, siniestro o reclamo.
- Diagnóstico: Diagnóstico o motivo de la hospitalización, en una frase.
- Fecha de ingreso: Fecha de ingreso al hospital (AAAA-MM-DD).
- Días de estancia: Días de estancia hasta hoy según el resumen, solo el número.
- Estatus clínico: Estado clínico actual en una frase corta (p. ej. estable, en terapia intensiva, en recuperación).
- Autorización/carta de garantía: Estado de la autorización o carta de garantía (autorizada, pendiente, rechazada) y fecha.
- Monto/presupuesto: Monto o presupuesto mencionado, con moneda.
- Pendientes con aseguradora: Lo que falta que responda o entregue la aseguradora.
- Pendientes con hospital: Lo que falta que responda o entregue el hospital.
- Próxima acción y responsable: Siguiente paso concreto y quién lo hace.
- Última novedad (fecha y texto): Fecha y descripción breve de lo más reciente que ocurrió.
`;
