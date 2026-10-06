// Cliente de la API (cookie de sesión am_session, prefijo /api).

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

export type TemplateKind = 'resumen' | 'whatsapp'

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

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

/** La sesión registra aquí qué hacer cuando ya no hay sesión (volver al login). */
export function setUnauthorizedHandler(h: UnauthorizedHandler | null) {
  onUnauthorized = h
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

async function rawRequest(path: string, opts: { method?: string; body?: unknown }): Promise<{ res: Response; data: unknown }> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
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
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me']

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
  if (!res.ok) throw new ApiError(res.status, messageFor(res.status, data))
  return data as T
}

const enc = encodeURIComponent

export const authApi = {
  me: () => api<{ authenticated: boolean; user?: User }>('/auth/me'),
  login: (email: string, password: string) =>
    api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }),
  refresh: () => api<{ user: User }>('/auth/refresh', { method: 'POST' }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  changePassword: (actual: string, nueva: string) =>
    api<void>('/auth/change-password', { method: 'POST', body: { actual, nueva } }),
}

export const mailApi = {
  sync: () => api<SyncResult>('/mail/sync', { method: 'POST' }),
  status: () => api<MailStatus>('/mail/status'),
  connect: () => api<{ url: string }>('/mail/connect', { method: 'POST' }),
  disconnect: () => api<void>('/mail/connection', { method: 'DELETE' }),
}

export const jobsApi = { status: () => api<JobsStatus>('/jobs/status') }

export const threadsApi = {
  list: (status?: ProcessStatus) =>
    api<ThreadListItem[]>(status ? `/threads?status=${enc(status)}` : '/threads'),
  get: (id: string) => api<ThreadDetail>(`/threads/${enc(id)}`),
  analyze: (id: string, seguimiento?: boolean) =>
    api<{ threadId: string; status: ProcessStatus }>(`/threads/${enc(id)}/analyze`, {
      method: 'POST',
      body: seguimiento === undefined ? {} : { seguimiento },
    }),
  analyzeMany: (ids: string[], seguimiento?: boolean) =>
    api<{ results: AnalyzeResult[] }>('/threads/analyze', {
      method: 'POST',
      body: seguimiento === undefined ? { ids } : { ids, seguimiento },
    }),
  setSeguimiento: (id: string, seguimiento: boolean) =>
    api<{ id: string; seguimiento: boolean }>(`/threads/${enc(id)}/seguimiento`, {
      method: 'PATCH',
      body: { seguimiento },
    }),
  reprocess: (id: string) =>
    api<{ threadId: string; status: ProcessStatus }>(`/threads/${enc(id)}/reprocess`, {
      method: 'POST',
    }),
  reanalyzeLast: (id: string) =>
    api<{ threadId: string; status: ProcessStatus; mode: 'incremental'; messageId: string }>(
      `/threads/${enc(id)}/reanalyze-last`,
      { method: 'POST' },
    ),
  /** Mensaje de WhatsApp redactado por IA solo con el último correo (no guarda nada). */
  whatsappLast: (id: string) => api<{ texto: string }>(`/threads/${enc(id)}/whatsapp-last`, { method: 'POST' }),
  synthesis: (id: string) => api<SynthesisResponse>(`/threads/${enc(id)}/synthesis`),
  regenerate: (id: string) =>
    api<RegenerateResponse>(`/threads/${enc(id)}/synthesis/regenerate`, { method: 'POST' }),
}

export const attachmentsApi = {
  pages: (id: string) => api<AttachmentPages>(`/attachments/${enc(id)}/pages`),
}

export const templatesApi = {
  active: (kind: TemplateKind = 'resumen') => api<Template>(`/templates/active?kind=${kind}`),
  save: (markdown: string, kind: TemplateKind = 'resumen') =>
    api<Template>(`/templates/active?kind=${kind}`, { method: 'PUT', body: { markdown } }),
  reset: (kind: TemplateKind = 'resumen') => api<Template>(`/templates/reset?kind=${kind}`, { method: 'POST' }),
  preview: (markdown?: string, kind: TemplateKind = 'resumen') =>
    api<{ markdown: string }>('/templates/preview', {
      method: 'POST',
      body: markdown ? { markdown, kind } : { kind },
    }),
}
