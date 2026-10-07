// Cliente de la API (cookie de sesión am_session, prefijo /api; bajo /d/<id> si se entra por el relay).
import { apiUrl } from './base'
import { secureFetch, usaE2e } from './e2e'
import { CODIGO_PC_APAGADA, MENSAJE_PC_APAGADA, marcarPcApagada } from './pcApagada'

export type ProcessStatus =
  | 'sin_analizar'
  | 'pendiente'
  | 'procesando'
  | 'listo'
  | 'necesita_revision'
  | 'error'

export type EtapaProgreso = 'en_cola' | 'leyendo_pdfs' | 'escribiendo_resumen' | 'terminando'

export interface ProgresoAnalisis {
  etapa: EtapaProgreso
  /** 0-100 */
  porcentaje: number
  adjuntos: { total: number; listos: number }
  paginas?: { total: number; leidas: number }
  reintento?: { intento: number; maximo: number }
}

export interface ThreadListItem {
  id: string
  subject: string
  status: ProcessStatus
  seguimiento: boolean
  tieneMensajesNuevos: boolean
  updatedAt: string
  lastMessageAt: string
  messageCount: number
  attachmentCount: number
  progreso?: ProgresoAnalisis | null
}

export interface AttachmentInfo {
  id: string
  filename: string
  size: number
  sha256: string
  status: ProcessStatus
}

export interface MessageInfo {
  id: string
  from: string
  to: string[]
  cc: string[]
  subject: string
  bodyText: string
  isFromMe: boolean
  receivedAt: string
  attachments: AttachmentInfo[]
}

export interface ThreadDetail {
  id: string
  subject: string
  status: ProcessStatus
  seguimiento: boolean
  tieneMensajesNuevos: boolean
  lastMessageAt: string
  progreso?: ProgresoAnalisis | null
  messages: MessageInfo[]
}

export type SynthesisMode = 'full' | 'incremental'

export interface SynthesisLatest {
  version: number
  markdown: string
  model: string | null
  templateVersion: number | null
  mode: SynthesisMode
  inputTokensEstimados: number | null
  mensajesCubiertos: number
  createdAt: string
}

export interface SynthesisHistoryItem {
  version: number
  model: string | null
  templateVersion: number | null
  mode: SynthesisMode
  inputTokensEstimados: number | null
  createdAt: string
}

export interface SynthesisResponse {
  threadId: string
  status: ProcessStatus
  plantillaDesactualizada: boolean
  plantillaActivaVersion: number
  latest: SynthesisLatest | null
  history: SynthesisHistoryItem[]
}

export interface RegenerateResponse {
  threadId: string
  status: ProcessStatus
  mode: 'full'
  advertencia: string
}

export interface AnalyzeResult {
  id: string
  ok: boolean
  status?: ProcessStatus
  error?: string
}

export type TemplateKind = 'resumen' | 'whatsapp' | 'reporte'

export interface Template {
  id: string
  name: string
  kind: TemplateKind
  version: number
  markdown: string
  updatedAt: string
}

export interface SyncResult {
  started: boolean
  messages: number
  newMessages: number
  attachments: number
  deduped: number
  resetDelta: boolean
  error?: string
}

export interface MailStatus {
  connected: boolean
  email?: string
  lastSyncAt?: string | null
  syncing: boolean
  error?: string | null
}

export interface User {
  id: string
  email: string
  nombre: string
}

export interface JobsStatus {
  pendiente: number
  procesando: number
  listo: number
  error: number
}

export interface AttachmentPages {
  attachmentId: string
  filename: string
  status: ProcessStatus
  pages: { pageNumber: number; regions: { id: string; status: 'ok' | 'dudoso' | 'corregido' }[] }[]
}

export type ReportStatus = 'generando' | 'listo' | 'error'

export interface Reporte {
  id: string
  /** YYYY-MM-DD */
  fecha: string
  trigger: 'manual' | 'programado'
  status: ReportStatus
  fileName: string | null
  templateVersion: number | null
  totales: { hospitalizados: number; conNovedad: number; altas: number }
  progreso: { procesados: number; total: number }
  error: string | null
  descargable: boolean
  createdAt: string
  finishedAt: string | null
}

export interface ReporteFila {
  threadId: string
  asunto: string
  estado: string
  novedadTexto: string
  desactualizado: boolean
  extraccionOk: boolean
  datos: Record<string, string>
}

export interface ReporteDetalle extends Reporte {
  columnas: string[]
  filasConNovedad: ReporteFila[]
}

export interface ReporteAjustes {
  programado: boolean
  /** HH:mm */
  hora: string
  zona: string
}

export interface ColumnaReporte {
  nombre: string
  instruccion: string
}

export type EventoEstado = 'hospitalizado' | 'alta' | 'otro'

/** Evento de la bitácora de hospitalización (viaja en la hoja «Eventos» del Excel). */
export interface Evento {
  id: string
  threadId: string
  synthesisId: string
  /** ISO */
  fechaEvento: string
  /** YYYY-MM-DD */
  fecha: string
  estado: EventoEstado
  novedadTexto: string
  datos: Record<string, string>
  columnas: string[]
  templateVersion: number | null
  createdAt: string
}

export interface EventoBorrador {
  synthesisId: string
  templateVersion: number | null
  columnas: ColumnaReporte[]
  datos: Record<string, string>
  estado: EventoEstado
  novedadTexto: string
  /** ISO */
  fechaEvento: string
  yaRegistrado: Evento | null
}

export interface EventoNuevo {
  synthesisId: string
  datos: Record<string, string>
  estado: EventoEstado
  novedadTexto?: string
  fechaEvento: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
  /** El relay no logra hablar con la computadora (apagada, sin internet o sin respuesta). */
  get pcApagada(): boolean {
    return this.status === 503 && this.message === MENSAJE_PC_APAGADA
  }
  /** Errores que no mejoran reintentando (sesión vencida, datos inválidos, no existe). */
  get definitivo(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

/** La sesión registra aquí qué hacer cuando ya no hay sesión (volver al login). */
export function setUnauthorizedHandler(h: UnauthorizedHandler | null) {
  onUnauthorized = h
}

/** Respuesta del relay con code 'pc_apagada' (503/502/504): marca el aviso global y devuelve el texto fijo. */
function detectaPcApagada(status: number, body: unknown): boolean {
  if (status !== 502 && status !== 503 && status !== 504) return false
  if ((body as { code?: unknown } | null)?.code !== CODIGO_PC_APAGADA) return false
  marcarPcApagada()
  return true
}

function messageFor(status: number, body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message
  if (typeof m === 'string' && m) return m
  if (Array.isArray(m) && m.length) return m.join('. ')
  if (status === 401) return 'Tu sesión terminó. Entra de nuevo.'
  if (status === 404) return 'No se encontró lo que buscabas.'
  if (status === 429) return 'Hubo demasiados intentos. Espera un minuto y vuelve a intentar.'
  if (status >= 500) return 'Algo falló en el servidor. Intenta de nuevo en un momento.'
  return 'No se pudo completar la acción.'
}

/**
 * Única salida de red hacia la API. Directo (escritorio/Docker): fetch con cookies. Por el relay
 * (/d/<id>): sobre cifrado de extremo a extremo (lib/e2e.ts); el relay no ve rutas, cookies ni cuerpos.
 */
function apiFetch(path: string, opts: { method?: string; body?: unknown }): Promise<Response> {
  const method = opts.method ?? 'GET'
  const headers = opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  if (usaE2e()) return secureFetch(path, { method, headers, body })
  return fetch(apiUrl(path), { method, credentials: 'include', headers, body })
}

async function rawRequest(path: string, opts: { method?: string; body?: unknown }): Promise<{ res: Response; data: unknown }> {
  let res: Response
  try {
    res = await apiFetch(path, opts)
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet.')
  }
  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  return { res, data }
}

// Un único refresh en vuelo: las peticiones concurrentes con 401 lo comparten.
let refreshing: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = rawRequest('/auth/refresh', { method: 'POST' })
      .then(({ res }) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

// Rutas de autenticación: un 401 aquí significa "datos incorrectos" o "sin sesión", no se reintenta.
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me', '/auth/setup-status', '/auth/setup']

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  let { res, data } = await rawRequest(path, opts)
  if (res.status === 401 && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) {
      ;({ res, data } = await rawRequest(path, opts))
    }
    if (res.status === 401) onUnauthorized?.()
  }
  if (!res.ok) {
    if (detectaPcApagada(res.status, data)) throw new ApiError(503, MENSAJE_PC_APAGADA)
    throw new ApiError(res.status, messageFor(res.status, data))
  }
  return data as T
}

/** Descarga un archivo autenticado por cookie como Blob (reintenta una vez si la sesión caducó). */
export async function apiBlob(path: string, opts: { method?: string; body?: unknown } = {}): Promise<Blob> {
  const pedir = async () => {
    try {
      return await apiFetch(path, opts)
    } catch {
      throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet.')
    }
  }
  let res = await pedir()
  if (res.status === 401 && (await refreshSession())) res = await pedir()
  if (res.status === 401) onUnauthorized?.()
  if (!res.ok) {
    let data: unknown = null
    try {
      data = JSON.parse(await res.text())
    } catch {
      data = null
    }
    if (detectaPcApagada(res.status, data)) throw new ApiError(503, MENSAJE_PC_APAGADA)
    if (res.status === 404 || res.status === 409) {
      const m = (data as { message?: unknown } | null)?.message
      throw new ApiError(res.status, typeof m === 'string' && m ? m : 'El archivo todavía no está listo.')
    }
    throw new ApiError(res.status, messageFor(res.status, data))
  }
  return res.blob()
}

// --- Configuración de IA (/settings/ia) ---
export type LlmTask = 'resumen' | 'whatsapp' | 'evento' | 'reporte' | 'vision'
export type ProveedorIa = 'ollama' | 'openai' | 'anthropic' | 'bedrock'

export interface AjustesIa {
  necesitaBienvenida: boolean
  proveedor: ProveedorIa
  origen: 'panel' | 'servidor'
  modelos: Record<LlmTask, string>
  ollamaUrl: string
  awsRegion: string
  maxInputTokens: number
  /** Solo si hay clave guardada; la clave en sí nunca llega al navegador. */
  claves: { openai: boolean; anthropic: boolean; aws: boolean }
  sugeridos: Record<ProveedorIa, { texto: string[]; vision: string[] }>
}

export interface CambiosAjustesIa {
  proveedor?: ProveedorIa
  modelos?: Partial<Record<LlmTask, string>>
  ollamaUrl?: string
  awsRegion?: string
  maxInputTokens?: number
  /** string = nueva clave, null = quitar, ausente = no cambiar. */
  claveOpenai?: string | null
  claveAnthropic?: string | null
  /** Ambas juntas (nuevas) o ambas null (quitar). */
  claveAwsAccessKeyId?: string | null
  claveAwsSecreto?: string | null
  bienvenidaCompletada?: true
}

export interface PruebaIaBorrador {
  proveedor?: ProveedorIa
  modelo?: string
  claveOpenai?: string
  claveAnthropic?: string
  ollamaUrl?: string
  awsRegion?: string
}

export interface PruebaIaResultado {
  ok: boolean
  ms: number
  mensaje: string
}

export interface HardwareIa {
  entorno: 'docker' | 'local'
  ramGb: number
  cpus: number
  gpu?: { nombre: string; vramGb: number }
  ollama: { alcanzable: boolean; version?: string; modelos: string[]; versionMinima?: string; requiereActualizar?: boolean; motivo?: 'rechazada' | 'tiempo' | 'invalida'; urlDetectada?: string }
  ollamaApto: { apto: boolean; velocidad: 'rapida' | 'lenta' | null; motivo: string }
}

export interface DescargaOllama {
  modelo: string
  estado: 'descargando' | 'listo' | 'error' | 'inactivo'
  completado: number
  total: number
  error?: string
}

// --- Primer usuario ---
export interface SetupStatus {
  needsSetup: boolean
}

export interface NuevoPrimerUsuario {
  email: string
  nombre: string
  password: string
}

// --- Lectura de PDFs escaneados (/settings/ocr) ---
export type MotorOcr = 'local' | 'textract' | 'ninguno'

export interface GuiaPython {
  titulo: string
  pasos: string[]
  comandos: string[]
  enlace?: string
}

export interface AjustesOcr {
  motor: MotorOcr
  origen: 'panel' | 'servidor'
  textractMode: 'detect' | 'analyze'
  entorno: { escritorio: boolean; servidor: boolean; so: 'windows' | 'linux' | 'otro' }
  python: {
    requerido: string
    rango: string
    detectado: boolean
    version?: string
    ejecutable?: string
    compatible: boolean
    motivo?: string
    guia: GuiaPython
  }
  entornoPython: { estado: 'sin_preparar' | 'preparando' | 'listo' | 'error'; mensaje?: string }
  servicioLocal: { estado: 'detenido' | 'iniciando' | 'listo' | 'error'; fallbackReason?: string | null; mensaje?: string }
}

export interface CambiosAjustesOcr {
  motor?: MotorOcr
  textractMode?: 'detect' | 'analyze'
}

export interface ProgresoPython {
  estado: 'inactivo' | 'preparando' | 'listo' | 'error'
  lineas: string[]
  mensaje?: string
}

export interface PruebaOcrResultado {
  ok: boolean
  ms: number
  mensaje: string
}
