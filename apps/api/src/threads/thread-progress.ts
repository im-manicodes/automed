/** Progreso de análisis de un hilo, calculado solo con datos existentes (sin contenido de correos). */
export type EtapaProgreso =
  | 'en_cola'
  | 'escaneando_ocr'
  | 'ia_dudosas'
  | 'procesando_dudosas'
  | 'revision_manual'
  | 'generando_resumen'
  | 'resumen_listo';

/** Sub-etapa guardada por OcrService en el Setting `progress:<threadId>`. */
export interface StoredProgress {
  etapa: 'ocr' | 'vision_enviando' | 'vision_procesando';
  regiones?: { total: number; hechas: number };
  /** Modelo que lee las zonas dudosas (solo etapas de visión). */
  modelo?: string;
}

export interface ProgresoAnalisis {
  etapa: EtapaProgreso;
  /** 0-100 */
  porcentaje: number;
  adjuntos: { total: number; listos: number };
  paginas?: { total: number; leidas: number };
  regiones?: { total: number; hechas: number };
  /** Solo en ia_dudosas / procesando_dudosas: modelo que lee las zonas dudosas. */
  modelo?: string;
  reintento?: { intento: number; maximo: number };
}

export interface ProgressAttachment {
  status: string;
  /** Páginas ya rasterizadas del adjunto y cuántas ya tienen texto (OCR hecho). */
  paginasTotal?: number;
  paginasLeidas?: number;
}

export interface ProgressJob {
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
}

export interface ProgressInput {
  threadStatus: string;
  attachments: ProgressAttachment[];
  jobs?: ProgressJob[];
  /** Sub-etapa guardada (solo aplica con el hilo procesando y adjuntos pendientes). */
  stored?: StoredProgress | null;
  /** Última actualización del hilo (para detectar un resumen recién listo). */
  updatedAt?: Date;
  now?: Date;
}

const RECENT_MS = 60_000;

const DONE = new Set(['listo', 'dudoso', 'necesita_revision']);
const IN_QUEUE = 5;
const READ_END = 80;

/** Reintento: el trabajo activo con más intentos que ya falló al menos una vez. */
function pickRetry(jobs: ProgressJob[]): ProgresoAnalisis['reintento'] {
  let best: ProgressJob | undefined;
  for (const j of jobs) {
    if (j.status === 'listo' || j.status === 'error') continue;
    if (j.attempts > 1 && j.lastError && (!best || j.attempts > best.attempts))
      best = j;
  }
  return best
    ? { intento: best.attempts, maximo: best.maxAttempts }
    : undefined;
}

/** null si el hilo no está en marcha, ni en revisión, ni recién listo. */
export function computeProgress(input: ProgressInput): ProgresoAnalisis | null {
  const { threadStatus, attachments } = input;
  const total = attachments.length;
  const pending = attachments.filter((a) => !DONE.has(a.status));
  const listos = total - pending.length;
  const reintento = pickRetry(input.jobs ?? []);
  const base = { adjuntos: { total, listos }, ...(reintento && { reintento }) };

  if (threadStatus === 'necesita_revision')
    return { etapa: 'revision_manual', porcentaje: READ_END, ...base };
  if (threadStatus === 'listo') {
    if (!input.updatedAt) return null;
    const age = (input.now ?? new Date()).getTime() - input.updatedAt.getTime();
    return age < RECENT_MS
      ? { etapa: 'resumen_listo', porcentaje: 100, ...base }
      : null;
  }
  if (threadStatus !== 'pendiente' && threadStatus !== 'procesando')
    return null;

  if (threadStatus === 'pendiente')
    return { etapa: 'en_cola', porcentaje: IN_QUEUE, ...base };

  if (pending.length === 0)
    return { etapa: 'generando_resumen', porcentaje: READ_END, ...base };

  let pTotal = 0;
  let pLeidas = 0;
  let parcial = 0;
  for (const a of pending) {
    const t = a.paginasTotal ?? 0;
    const l = Math.min(a.paginasLeidas ?? 0, t);
    pTotal += t;
    pLeidas += l;
    if (t > 0) parcial += l / t;
  }
  const fraccion = (listos + parcial) / total;
  const porcentaje = Math.min(
    READ_END - 1,
    Math.round(IN_QUEUE + (READ_END - IN_QUEUE) * fraccion),
  );
  const st = input.stored;
  const etapa: EtapaProgreso =
    st?.etapa === 'vision_enviando'
      ? 'ia_dudosas'
      : st?.etapa === 'vision_procesando'
        ? 'procesando_dudosas'
        : 'escaneando_ocr';
  return {
    etapa,
    porcentaje,
    ...base,
    ...(etapa !== 'escaneando_ocr' &&
      st?.regiones && { regiones: st.regiones }),
    ...(etapa !== 'escaneando_ocr' && st?.modelo && { modelo: st.modelo }),
    ...(pTotal > 0 && { paginas: { total: pTotal, leidas: pLeidas } }),
  };
}
