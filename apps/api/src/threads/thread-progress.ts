/** Progreso de análisis de un hilo, calculado solo con datos existentes (sin contenido de correos). */
export type EtapaProgreso =
  'en_cola' | 'leyendo_pdfs' | 'escribiendo_resumen' | 'terminando';

export interface ProgresoAnalisis {
  etapa: EtapaProgreso;
  /** 0-100 */
  porcentaje: number;
  adjuntos: { total: number; listos: number };
  paginas?: { total: number; leidas: number };
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
}

const DONE = new Set(['listo', 'dudoso', 'necesita_revision']);
const IN_QUEUE = 5;
const READ_END = 80;
const WRITE_END = 95;

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

/** null si el hilo no está en marcha (pendiente/procesando). */
export function computeProgress(input: ProgressInput): ProgresoAnalisis | null {
  const { threadStatus, attachments } = input;
  if (threadStatus !== 'pendiente' && threadStatus !== 'procesando')
    return null;

  const total = attachments.length;
  const pending = attachments.filter((a) => !DONE.has(a.status));
  const listos = total - pending.length;
  const reintento = pickRetry(input.jobs ?? []);
  const base = { adjuntos: { total, listos }, ...(reintento && { reintento }) };

  if (threadStatus === 'pendiente')
    return { etapa: 'en_cola', porcentaje: IN_QUEUE, ...base };

  if (pending.length === 0) {
    const sintesisHecha = (input.jobs ?? []).some(
      (j) => j.type === 'synthesize_thread' && j.status === 'listo',
    );
    return sintesisHecha
      ? { etapa: 'terminando', porcentaje: WRITE_END, ...base }
      : { etapa: 'escribiendo_resumen', porcentaje: READ_END, ...base };
  }

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
  return {
    etapa: 'leyendo_pdfs',
    porcentaje,
    ...base,
    ...(pTotal > 0 && { paginas: { total: pTotal, leidas: pLeidas } }),
  };
}
