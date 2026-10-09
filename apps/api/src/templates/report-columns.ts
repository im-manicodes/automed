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

export const DEFAULT_REPORT_TEMPLATE_MARKDOWN = `<!-- Una columna por viñeta: "- NOMBRE: instrucción para la IA". Censo de pacientes hospitalizados. Todo en MAYÚSCULAS; si un dato no aparece en el resumen, deja la celda vacía y no inventes. -->
- REGION: Región o zona del convenio solo si el hilo la menciona; si no, vacío. En MAYÚSCULAS.
- LOCALIDAD: Ciudad o localidad del hospital solo si aparece; si no, vacío. En MAYÚSCULAS.
- PRESTADOR DE SERVICIO: Nombre del hospital o clínica donde está internado el paciente. En MAYÚSCULAS.
- NUMERO DE CONTRATO: Número de contrato o convenio solo si aparece; si no, vacío.
- FECHA DE INGRESO (AAAA-MM-DD): Fecha de ingreso al hospital en formato AAAA-MM-DD; vacío si no aparece.
- TIPO DE INGRESO: Tipo de ingreso (URGENCIAS, PROGRAMADO, TRASLADO u otro que indique el hilo). En MAYÚSCULAS.
- DIAS DE ESTANCIA HOSPITALARIA: Días de estancia desde el ingreso, solo el número; vacío si no hay fecha de ingreso.
- ESTATUS DE LA HOSPITALIZACION (ACTIVA/ALTA): Escribe ACTIVA si el paciente sigue internado o ALTA si ya egresó.
- FECHA DE REPORTE DE LA GESTIÓN OPERATIVA Y/O EGRESO: Fecha del último reporte o, si hubo alta, del egreso, en formato AAAA-MM-DD.
- NOMBRE DEL PACIENTE HOSPITALIZADO (APELLIDOS NOMBRE): Nombre del paciente en orden APELLIDOS NOMBRE y en MAYÚSCULAS.
- FICHA: Ficha, expediente o número de afiliación del paciente solo si aparece; si no, vacío.
- CODIFICACION: Código o clave de codificación del caso solo si aparece; si no, vacío.
- EDAD (AÑOS): Edad en años, solo el número.
- GENERO (MASCULINO/FEMENINO): MASCULINO o FEMENINO; vacío si no se puede saber.
- DIAGNOSTICO: Diagnóstico principal o motivo de la hospitalización, en una frase y en MAYÚSCULAS.
- CIE-10: Código CIE-10 del diagnóstico solo si aparece; no lo deduzcas. Vacío si falta.
- ESPECIALIDAD: Especialidad médica que lleva el caso (p. ej. CIRUGIA GENERAL, MEDICINA INTERNA). En MAYÚSCULAS.
- TIPO DE MANEJO (MEDICO/QUIRURGICO): MEDICO si solo hay tratamiento médico; QUIRURGICO si hubo o se programó cirugía.
- EVOLUCION INICIAL (DÍA 1): Evolución clínica del primer día: cuadro de ingreso, signos vitales y hallazgos principales, en pocas líneas y en MAYÚSCULAS.
- PLAN DE MANEJO INTRAHOSPITALARIO: Plan de manejo vigente: dieta, soluciones, medicamentos, antibióticos y cuidados, en MAYÚSCULAS.
- EVOLUCION: Una línea por día con formato "dd/mm/aa hh:mm H: evolución", separadas por salto de línea; de la más antigua a la más reciente.
`;
