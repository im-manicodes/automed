import type { AjustesIa, AjustesOcr, CambiosAjustesIa, MotorOcr } from './api'

/** Claves de AWS que el usuario va editando. undefined = sin cambios, string = nuevas, null = quitar. */
export interface ClavesAws {
  accessKeyId?: string | null
  secreto?: string | null
}

export const OPCIONES_OCR: { id: MotorOcr; nombre: string; descripcion: string }[] = [
  { id: 'local', nombre: 'En mi computador', descripcion: 'Gratis y privado: se ejecuta en tu propio servidor; el contenido no sale de ahí.' },
  { id: 'textract', nombre: 'Amazon Textract', descripcion: 'Servicio de AWS, muy preciso con letra manuscrita. Necesita credenciales de AWS.' },
  { id: 'ninguno', nombre: 'Configurar después', descripcion: 'Los PDF normales se leen igual; una página escaneada pedirá configurar esto.' },
]

export const nombreMotorOcr = (m: MotorOcr) => OPCIONES_OCR.find((o) => o.id === m)?.nombre ?? m

/** Cambios de PUT /settings/ia para las claves de AWS (ambas juntas), o null si no hay cambios. */
export function cambiosAws(c: ClavesAws): Pick<CambiosAjustesIa, 'claveAwsAccessKeyId' | 'claveAwsSecreto'> | null {
  if (c.accessKeyId === null || c.secreto === null) return { claveAwsAccessKeyId: null, claveAwsSecreto: null }
  if (typeof c.accessKeyId === 'string' && typeof c.secreto === 'string' && c.accessKeyId.trim() && c.secreto.trim()) {
    return { claveAwsAccessKeyId: c.accessKeyId.trim(), claveAwsSecreto: c.secreto.trim() }
  }
  return null
}

/** Escribió solo una de las dos claves. */
export function awsIncompleta(c: ClavesAws): boolean {
  const a = typeof c.accessKeyId === 'string' ? c.accessKeyId.trim() : null
  const s = typeof c.secreto === 'string' ? c.secreto.trim() : null
  if (a === null && s === null) return false
  return !a || !s
}

/** ¿Falta algo para poder usar el motor elegido? Devuelve el motivo o null. */
export function faltaParaOcr(motor: MotorOcr, a: AjustesOcr, ia: Pick<AjustesIa, 'claves'>, claves: ClavesAws): string | null {
  if (motor === 'local') {
    return a.servicioLocal.estado === 'listo' ? null : 'Primero levanta el servicio de OCR del servidor, o elige «Configurar después».'
  }
  if (motor === 'textract') {
    if (awsIncompleta(claves)) return 'Escribe las dos claves de AWS.'
    const nuevas = cambiosAws(claves)
    if (nuevas?.claveAwsAccessKeyId) return null
    if (claves.accessKeyId === null) return 'Escribe las claves de AWS o elige otra opción.'
    return ia.claves.aws ? null : 'Escribe las claves de AWS o elige otra opción.'
  }
  return null
}

/** Ajustes avanzados de lectura que el usuario edita antes de guardar. */
export type AvanzadoOcr = Pick<AjustesOcr, 'visionRetry' | 'visionMaxRegions' | 'renderDpi' | 'textractMode'>

export const avanzadoDesde = (a: AjustesOcr): AvanzadoOcr => ({
  visionRetry: a.visionRetry,
  visionMaxRegions: a.visionMaxRegions,
  renderDpi: a.renderDpi,
  textractMode: a.textractMode,
})

export const avanzadoValido = (v: AvanzadoOcr): boolean =>
  Number.isInteger(v.visionMaxRegions) && v.visionMaxRegions >= 1 && v.visionMaxRegions <= 200
