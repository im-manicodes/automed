import type { AjustesIa, AjustesOcr, CambiosAjustesIa, CambiosAjustesOcr, MotorOcr } from './api'

/** Claves de AWS que el usuario va editando. undefined = sin cambios, string = nuevas, null = quitar. */
export interface ClavesAws {
  accessKeyId?: string | null
  secreto?: string | null
}

/** Datos de Azure que el usuario va editando. undefined = sin cambios; clave null = quitarla. */
export interface ClavesAzure {
  endpoint?: string
  clave?: string | null
}

export const OPCIONES_OCR: { id: MotorOcr; nombre: string; descripcion: string }[] = [
  { id: 'local', nombre: 'En mi computador', descripcion: 'Gratis y privado: la app lo instala en tu propio servidor (una vez, con internet) y el contenido no sale de ahí.' },
  { id: 'textract', nombre: 'Amazon Textract', descripcion: 'Servicio de AWS, muy preciso con letra manuscrita. Necesita credenciales de AWS.' },
  { id: 'azure', nombre: 'Azure Document Intelligence', descripcion: 'Servicio de Microsoft Azure, también muy preciso con letra manuscrita. Necesita la dirección y una clave de tu recurso de Azure.' },
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

/** Cambios de PUT /settings/ocr para Azure (solo lo que difiere de lo guardado), o null si no hay. */
export function cambiosAzure(c: ClavesAzure, actual: Pick<AjustesOcr, 'azureEndpoint'>): Pick<CambiosAjustesOcr, 'azureEndpoint' | 'claveAzure'> | null {
  const out: Pick<CambiosAjustesOcr, 'azureEndpoint' | 'claveAzure'> = {}
  const endpoint = c.endpoint?.trim()
  if (endpoint && endpoint !== actual.azureEndpoint) out.azureEndpoint = endpoint
  if (c.clave === null) out.claveAzure = null
  else if (typeof c.clave === 'string' && c.clave.trim()) out.claveAzure = c.clave.trim()
  return Object.keys(out).length ? out : null
}

/** ¿Falta algo para poder usar el motor elegido? Devuelve el motivo o null. */
export function faltaParaOcr(motor: MotorOcr, a: AjustesOcr, ia: Pick<AjustesIa, 'claves'>, claves: ClavesAws, azure: ClavesAzure = {}): string | null {
  if (motor === 'local') {
    // Mientras se instala o arranca se puede seguir: la instalación continúa en segundo plano.
    const { estado } = a.servicioLocal
    return estado === 'listo' || estado === 'iniciando'
      ? null
      : 'Primero instala e inicia el OCR local (botón «Instalar OCR local»), o elige «Configurar después».'
  }
  if (motor === 'textract') {
    if (awsIncompleta(claves)) return 'Escribe las dos claves de AWS.'
    const nuevas = cambiosAws(claves)
    if (nuevas?.claveAwsAccessKeyId) return null
    if (claves.accessKeyId === null) return 'Escribe las claves de AWS o elige otra opción.'
    return ia.claves.aws ? null : 'Escribe las claves de AWS o elige otra opción.'
  }
  if (motor === 'azure') {
    if (!(azure.endpoint ?? a.azureEndpoint).trim()) return 'Escribe la dirección de tu recurso de Azure.'
    if (azure.clave === null) return 'Escribe la clave de Azure o elige otra opción.'
    if (typeof azure.clave === 'string' && !azure.clave.trim()) return 'Escribe la clave de Azure o elige otra opción.'
    return azure.clave === undefined && !a.claveAzure ? 'Escribe la clave de Azure o elige otra opción.' : null
  }
  return null
}

/** Ajustes avanzados de lectura que el usuario edita antes de guardar. */
export type AvanzadoOcr = Pick<AjustesOcr, 'visionRetry' | 'visionSegundoIntento' | 'visionMaxRegions' | 'renderDpi' | 'textractMode' | 'visionAmbito'>

export const avanzadoDesde = (a: AjustesOcr): AvanzadoOcr => ({
  visionRetry: a.visionRetry,
  visionSegundoIntento: a.visionSegundoIntento,
  visionMaxRegions: a.visionMaxRegions,
  renderDpi: a.renderDpi,
  textractMode: a.textractMode,
  visionAmbito: a.visionAmbito,
})

export const MAX_VISION_AMBITO = 2000

export const avanzadoValido = (v: AvanzadoOcr): boolean =>
  Number.isInteger(v.visionMaxRegions) && v.visionMaxRegions >= 1 && v.visionMaxRegions <= 200 && v.visionAmbito.length <= MAX_VISION_AMBITO
