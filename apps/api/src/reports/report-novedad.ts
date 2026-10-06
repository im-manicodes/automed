import type { ReportEstado } from './report-extraction';

export interface PreviousRow {
  synthesisId: string | null;
  estado: string;
  data: Record<string, string>;
}

export interface NovedadInput {
  synthesisId: string;
  estado: ReportEstado;
  data: Record<string, string>;
  novedadTexto: string;
  /** Última fila del hilo en un reporte de un día anterior (null = hilo nuevo). */
  previous: PreviousRow | null;
}

export interface NovedadResult {
  novedad: boolean;
  /** Texto para la columna «Qué cambió»; vacío si no hay novedad. */
  texto: string;
}

const MAX_CHANGED = 4;

/**
 * Hay novedad si el hilo es nuevo en el reporte, cambió la síntesis o cambió el estado respecto a
 * la última fila de un reporte anterior. El texto compara columnas contra esa fila (sin LLM).
 */
export function computeNovedad(i: NovedadInput): NovedadResult {
  const p = i.previous;
  if (!p) {
    return {
      novedad: true,
      texto: ['Paciente nuevo en el reporte', i.novedadTexto]
        .filter(Boolean)
        .join('. '),
    };
  }
  const estadoCambio = p.estado !== i.estado;
  const sinCambio = !estadoCambio && p.synthesisId === i.synthesisId;
  if (sinCambio) return { novedad: false, texto: '' };
  const partes: string[] = [];
  if (estadoCambio)
    partes.push(
      i.estado === 'alta'
        ? 'Alta del paciente'
        : `Estado: ${p.estado} → ${i.estado}`,
    );
  const cambiadas = Object.entries(i.data)
    .filter(([k, v]) => (p.data[k] ?? '') !== v)
    .map(([k]) => k);
  if (cambiadas.length)
    partes.push(
      `Cambió: ${cambiadas.slice(0, MAX_CHANGED).join(', ')}${cambiadas.length > MAX_CHANGED ? ` y ${cambiadas.length - MAX_CHANGED} más` : ''}`,
    );
  if (i.novedadTexto) partes.push(i.novedadTexto);
  if (!partes.length) partes.push('Se actualizó el resumen del ticket');
  return { novedad: true, texto: partes.join('. ') };
}
