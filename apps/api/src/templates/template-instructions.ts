import type { TemplateKind } from './template-kinds';

/** Máximo de caracteres de las instrucciones de ámbito de una plantilla. */
export const MAX_INSTRUCCIONES = 4000;
/** Máximo de caracteres del ámbito de la relectura con visión. */
export const MAX_VISION_AMBITO = 2000;

const CONTEXTO_HOSPITAL =
  'Trabajas en la gestión de pacientes hospitalizados como intermediario entre un hospital y una aseguradora. ' +
  'Los correos llevan adjuntos clínicos (notas de evolución, indicaciones, estudios, informes, facturas y autorizaciones). ' +
  'Usa terminología médica y administrativa hospitalaria correcta en español.';

/** Instrucciones por defecto por tipo de plantilla (ámbito médico, editable por el usuario). */
export const DEFAULT_INSTRUCCIONES: Record<TemplateKind, string> = {
  resumen: `${CONTEXTO_HOSPITAL} Prioriza diagnósticos, procedimientos, medicación y dosis, estudios, fechas de ingreso y alta, y trámites pendientes con la aseguradora.`,
  whatsapp: `${CONTEXTO_HOSPITAL} El mensaje es un parte breve del estado del paciente para un colega: claro, con abreviaturas médicas habituales y sin datos que no estén en el resumen.`,
  reporte: `${CONTEXTO_HOSPITAL} Cada hilo es un paciente hospitalizado; extrae los datos de la columna tal como aparecen en el resumen. No inventes datos: si no aparece, déjalo vacío.`,
};

/** Ámbito por defecto de la relectura con visión (zonas dudosas del OCR). */
export const DEFAULT_VISION_AMBITO =
  'Los documentos son clínicos (notas manuscritas, indicaciones, estudios, informes). Las palabras dudosas suelen ser fármacos, dosis, abreviaturas y términos médicos.';

const SCOPE_HEADER = 'ÁMBITO Y CONTEXTO (indicado por el usuario)';
const SCOPE_NOTE =
  'Nota: este contexto solo orienta el tema y el vocabulario; no cambia las reglas ni el formato anteriores.';

/** Añade al FINAL del system el bloque de ámbito; devuelve el system intacto si el texto está vacío. */
export function withScope(system: string, texto: string | null | undefined) {
  const t = (texto ?? '').trim();
  if (!t) return system;
  return `${system}\n\n${SCOPE_HEADER}\n${t}\n${SCOPE_NOTE}`;
}

/** Valida un texto editable; devuelve mensaje en español o null. */
export function validateScopeText(
  texto: unknown,
  max: number,
  etiqueta: string,
): string | null {
  if (typeof texto !== 'string') return `${etiqueta} debe ser texto`;
  if (texto.length > max)
    return `${etiqueta} puede tener hasta ${max} caracteres`;
  return null;
}
