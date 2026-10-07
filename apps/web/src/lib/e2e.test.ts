import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureKeyFromHash, cookieHeaderFor, deriveKeys, loadKey, secureFetch, sealRequest, storeSetCookies, usaE2e } from './e2e'

const ID = 'AbCdEf0123456789abcdef'
const BASE = `/d/${ID}`
const KEY = 'A'.repeat(43)

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('clave E2E del QR', () => {
  it('se activa solo bajo /d/<id>', () => {
    expect(usaE2e('')).toBe(false)
    expect(usaE2e(BASE)).toBe(true)
  })

  it('captura la clave del fragmento, la guarda y no la acepta mal formada', () => {
    expect(captureKeyFromHash('', `#k=${KEY}`)).toBe(false)
    expect(captureKeyFromHash(BASE, '#k=corta')).toBe(false)
    expect(loadKey(BASE)).toBeNull()
    expect(captureKeyFromHash(BASE, `#k=${KEY}`)).toBe(true)
    expect(loadKey(BASE)).toBe(KEY)
    expect(localStorage.getItem(`am_e2e_${ID}`)).toBe(KEY)
  })
})

describe('tabla de cookies (dentro del sobre)', () => {
  it('guarda, filtra por ruta, y borra con Max-Age=0 o valor vacío', () => {
    storeSetCookies(ID, ['am_access=a1; Path=/; HttpOnly; Max-Age=900', 'am_refresh=r1; Path=/api/auth; HttpOnly'])
    expect(cookieHeaderFor(ID, '/api/threads')).toBe('am_access=a1')
    expect(cookieHeaderFor(ID, '/api/auth/refresh?x=1')).toBe('am_access=a1; am_refresh=r1')
    storeSetCookies(ID, ['am_refresh=; Path=/api/auth; Max-Age=0'])
    expect(cookieHeaderFor(ID, '/api/auth/refresh')).toBe('am_access=a1')
    storeSetCookies(ID, ['am_access=; Path=/'])
    expect(cookieHeaderFor(ID, '/api/threads')).toBe('')
  })

  it('las cookies vencidas no se envían', () => {
    const now = 1_000_000
    storeSetCookies(ID, ['c=1; Path=/; Max-Age=10'], now)
    expect(cookieHeaderFor(ID, '/api/x', now + 5_000)).toBe('c=1')
    expect(cookieHeaderFor(ID, '/api/x', now + 11_000)).toBe('')
  })
})

describe('secureFetch', () => {
  it('sin clave guardada no sale nada a la red y avisa que hay que escanear el QR', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await secureFetch('/threads', {}, BASE)
    expect(r.status).toBe(400)
    expect((await r.json()).message).toMatch(/QR/)
    expect(f).not.toHaveBeenCalled()
  })

  it('envía solo POST /d/<id>/e con bytes opacos: ni ruta, ni cookie, ni cuerpo en claro', async () => {
    captureKeyFromHash(BASE, `#k=${KEY}`)
    storeSetCookies(ID, ['am_access=token-secreto; Path=/'])
    const f = vi.fn().mockResolvedValue(new Response('{"message":"apagado"}', { status: 503 }))
    vi.stubGlobal('fetch', f)
    const r = await secureFetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"hunter2"}' }, BASE)
    expect(r.status).toBe(503) // errores del relay pasan tal cual
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/e`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    const wire = Buffer.from(init.body as Uint8Array).toString('latin1')
    for (const claro of ['token-secreto', 'hunter2', 'auth/login', 'am_access']) expect(wire).not.toContain(claro)
  })

  it('una respuesta que no autentica (relay manipulador) lanza error', async () => {
    captureKeyFromHash(BASE, `#k=${KEY}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(64), { status: 200 })))
    await expect(secureFetch('/threads', {}, BASE)).rejects.toThrow()
  })

  it('cada sobre lleva un nonce distinto', async () => {
    const keys = await deriveKeys(KEY)
    const head = { m: 'GET', p: '/api/x', h: {}, t: 1 }
    const a = await sealRequest(keys, ID, head, new Uint8Array(0))
    const b = await sealRequest(keys, ID, head, new Uint8Array(0))
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false)
  })
})
