import { vi } from 'vitest'

/** Respuesta simulada: `body` se serializa a JSON (o se devuelve tal cual si es un Blob). */
export interface MockReply {
  status?: number
  body?: unknown
}

export interface MockRequest {
  method: string
  /** Ruta completa tal como se pidió, con /api y query (p.ej. '/api/threads?x=1'). */
  url: string
  body: unknown
}

export type MockHandler = MockReply | ((req: MockRequest) => MockReply | Promise<MockReply>)

/**
 * Sustituye `fetch` global por un mock que responde según "MÉTODO ruta".
 * Las claves son p.ej. 'GET /api/threads' o 'POST /api/auth/refresh'; se busca primero
 * la URL exacta (con query) y luego la ruta sin query. Sin coincidencia responde 404.
 * Devuelve el mock (`mock.calls`, `calls(...)`). Restaurar con `vi.unstubAllGlobals()`.
 */
export function mockFetch(routes: Record<string, MockHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`]
    let body: unknown = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    const reply: MockReply = !handler
      ? { status: 404, body: null }
      : typeof handler === 'function'
        ? await handler({ method, url, body })
        : handler
    const status = reply.status ?? 200
    // El Blob de jsdom no lo acepta el Response de Node: se pasa su texto.
    if (reply.body instanceof Blob) return new Response(await reply.body.text(), { status })
    return new Response(reply.body === undefined || reply.body === null ? '' : JSON.stringify(reply.body), {
      status,
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Llamadas hechas a un mock, como "MÉTODO url" (útil para aserciones). */
export function callsOf(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls.map(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`)
}
