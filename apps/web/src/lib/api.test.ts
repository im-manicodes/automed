import { api, ApiError, setUnauthorizedHandler } from './api'

function mockFetch(status: number, body: unknown) {
  const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

describe('cliente API', () => {
  it('envía cookies y prefijo /api', async () => {
    const f = mockFetch(200, { ok: true })
    await api('/auth/me')
    expect(f).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include', method: 'GET' }))
  })

  it('avisa a la sesión en un 401 si el refresh también falla y lanza ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{"message":"Unauthorized"}', { status: 401 }))))
    const h = vi.fn()
    setUnauthorizedHandler(h)
    await expect(api('/threads')).rejects.toBeInstanceOf(ApiError)
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('usa el mensaje del servidor en errores', async () => {
    mockFetch(409, { message: 'El ticket ya se está procesando' })
    await expect(api('/x', { method: 'POST' })).rejects.toMatchObject({ status: 409, message: 'El ticket ya se está procesando' })
  })

  it('da un mensaje claro sin conexión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')))
    await expect(api('/x')).rejects.toMatchObject({ status: 0 })
  })

  it('ante 401 hace un refresh y reintenta la petición una vez', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"user":{}}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":1}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const h = vi.fn()
    setUnauthorizedHandler(h)
    await expect(api('/threads')).resolves.toEqual({ ok: 1 })
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/threads', '/api/auth/refresh', '/api/threads'])
    expect(h).not.toHaveBeenCalled()
  })

  it('si el refresh falla cierra la sesión sin reintentar', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 401 })))
    vi.stubGlobal('fetch', f)
    const h = vi.fn()
    setUnauthorizedHandler(h)
    await expect(api('/threads')).rejects.toMatchObject({ status: 401 })
    expect(f).toHaveBeenCalledTimes(2)
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('peticiones concurrentes comparten un solo refresh', async () => {
    const f = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') return Promise.resolve(new Response('{}', { status: 200 }))
      const first = !seen.has(url)
      seen.add(url)
      return Promise.resolve(new Response(first ? '{}' : '{"ok":true}', { status: first ? 401 : 200 }))
        .then((r) => { void init; return r })
    })
    const seen = new Set<string>()
    vi.stubGlobal('fetch', f)
    const r = await Promise.all([api('/a'), api('/b'), api('/c')])
    expect(r).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(f.mock.calls.filter((c) => c[0] === '/api/auth/refresh')).toHaveLength(1)
  })

  it('un 401 en el login no intenta refresh', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"message":"Correo o contraseña incorrectos"}', { status: 401 }))
    vi.stubGlobal('fetch', f)
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, message: 'Correo o contraseña incorrectos' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
