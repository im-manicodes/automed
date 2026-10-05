// Cliente de la API (cookie de sesión am_session, prefijo /api).

export type ProcessStatus =
  | 'sin_analizar'
  | 'pendiente'
  | 'procesando'
  | 'listo'
  | 'necesita_revision'
  | 'error'

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

export interface Template {
  id: string
  name: string
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
  connectedEmail: string | null
  running: boolean
  last: (SyncResult & { at: string }) | null
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

/** La sesión registra aquí qué hacer ante un 401 (volver a la pantalla de entrada). */
export function setUnauthorizedHandler(h: UnauthorizedHandler | null) {
  onUnauthorized = h
}

function messageFor(status: number, body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message
  if (typeof m === 'string' && m) return m
  if (Array.isArray(m) && m.length) return m.join('. ')
  if (status === 401) return 'Tu sesión terminó. Entra de nuevo.'
  if (status === 404) return 'No se encontró lo que buscabas.'
  if (status >= 500) return 'Algo falló en el servidor. Intenta de nuevo en un momento.'
  return 'No se pudo completar la acción.'
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
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
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(res.status, messageFor(res.status, data))
  }
  return data as T
}

const enc = encodeURIComponent

export const authApi = {
  me: () => api<{ authenticated: boolean; email?: string }>('/auth/me'),
  logout: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  loginUrl: '/api/auth/login',
}

export const mailApi = {
  sync: () => api<SyncResult>('/mail/sync', { method: 'POST' }),
  status: () => api<MailStatus>('/mail/status'),
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
  synthesis: (id: string) => api<SynthesisResponse>(`/threads/${enc(id)}/synthesis`),
  regenerate: (id: string) =>
    api<RegenerateResponse>(`/threads/${enc(id)}/synthesis/regenerate`, { method: 'POST' }),
}

export const attachmentsApi = {
  pages: (id: string) => api<AttachmentPages>(`/attachments/${enc(id)}/pages`),
}

export const templatesApi = {
  active: () => api<Template>('/templates/active'),
  save: (markdown: string) =>
    api<Template>('/templates/active', { method: 'PUT', body: { markdown } }),
  reset: () => api<Template>('/templates/reset', { method: 'POST' }),
  preview: (markdown?: string) =>
    api<{ markdown: string }>('/templates/preview', {
      method: 'POST',
      body: markdown ? { markdown } : {},
    }),
}
