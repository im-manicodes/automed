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

  it('avisa a la sesión en un 401 y lanza ApiError', async () => {
    mockFetch(401, { message: 'Unauthorized' })
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
})
