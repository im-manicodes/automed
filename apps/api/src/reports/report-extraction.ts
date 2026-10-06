import type { ReportColumn } from '../templates/report-columns';

export type ReportEstado = 'hospitalizado' | 'alta' | 'otro';

export interface ExtractedPatient {
  estado: ReportEstado;
  novedadTexto: string;
  data: Record<string, string>;
}

/** Evento previo del hilo, para que la IA redacte «qué cambió» respecto a él. */
export interface PreviousEventHint {
  fecha: string;
  estado: string;
  datos: Record<string, string>;
}

export const REPORT_SYSTEM_PROMPT = `Eres un asistente de un intermediario entre un hospital y una aseguradora. Recibes el resumen vigente de un hilo de correo que discute el estatus de UN paciente y debes extraer datos para una fila de un Excel.
Reglas: usa SOLO lo que dice el resumen; no inventes datos. Si un dato no aparece, usa una cadena vacía. Responde únicamente con un objeto JSON válido, sin texto adicional ni bloques de código.`;

export function buildReportPrompt(
  synthesisMarkdown: string,
  columnas: ReportColumn[],
  retry = false,
  previous: PreviousEventHint | null = null,
): string {
  const cols = columnas
    .map((c) => `- "${c.nombre}": ${c.instruccion}`)
    .join('\n');
  const prev = previous
    ? `\n\nEvento anterior ya registrado (${previous.fecha}, estado ${previous.estado}); en "novedad_texto" describe SOLO lo que cambió desde entonces:\n${JSON.stringify(previous.datos)}`
    : '';
  return `${retry ? 'Tu respuesta anterior no fue un JSON válido con la forma pedida. Responde SOLO el JSON.\n\n' : ''}Devuelve un JSON con esta forma exacta:
{"estado": "hospitalizado" | "alta" | "otro", "novedad_texto": "lo más reciente que ocurrió, en una frase", "columnas": {"<nombre de columna>": "<valor>"}}

"estado": "hospitalizado" si el paciente sigue internado; "alta" si ya fue dado de alta (o egresó); "otro" si el hilo no trata de un paciente hospitalizado.
"columnas" debe tener exactamente estas claves, con valores de texto:
${cols}

Resumen del hilo:
<<<
${synthesisMarkdown}
>>>${prev}`;
}

const normEstado = (v: unknown): ReportEstado | null => {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (s.startsWith('hospital') || s === 'internado' || s === 'internada')
    return 'hospitalizado';
  if (s === 'alta' || s.startsWith('alta ') || s === 'egreso') return 'alta';
  if (s === 'otro' || s === 'otra') return 'otro';
  return null;
};

const asText = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('; ');
  return '';
};

/** Extrae y valida el JSON del LLM. Devuelve null si no es utilizable. */
export function parseExtraction(
  raw: string,
  columnas: ReportColumn[],
): ExtractedPatient | null {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const estado = normEstado(o.estado);
  const cols = o.columnas;
  if (!estado || !cols || typeof cols !== 'object' || Array.isArray(cols))
    return null;
  const c = cols as Record<string, unknown>;
  const data: Record<string, string> = {};
  for (const col of columnas) data[col.nombre] = asText(c[col.nombre]);
  return { estado, novedadTexto: asText(o.novedad_texto), data };
}
