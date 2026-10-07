// Cifrado extremo a extremo con el escritorio (lado celular, WebCrypto). Pareja de
// apps/desktop/src/e2e-crypto.ts: mismo formato exacto. Diseño y amenazas: docs/relay-e2e.md.
//
// Mensaje en el cable: [1 byte versión=1][12 bytes nonce aleatorio][AES-256-GCM: cifrado + etiqueta 16 B]
// Claves por dirección con HKDF-SHA256 (info 'c2d' celular->escritorio, 'd2c' escritorio->celular).
// AAD petición "am-e2e1|req|<deviceId>"; AAD respuesta "am-e2e1|res|<deviceId>|" + nonce de la petición.
import { BASE_PATH } from './base'

const VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
const enc = new TextEncoder()
const dec = new TextDecoder()

export interface E2eKeys {
  c2d: CryptoKey
  d2c: CryptoKey
}

export interface E2eRequestHead {
  m: string
  p: string
  h: Record<string, string>
  t: number
}

export interface E2eResponseHead {
  s: number
  h: Record<string, string | string[]>
}

export class E2eError extends Error {}

const buf = (u: Uint8Array) => u as unknown as BufferSource

export function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

export function bytesToB64url(u: Uint8Array): string {
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function isValidKey(k: unknown): k is string {
  return typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k)
}

export async function deriveKeys(keyB64u: string): Promise<E2eKeys> {
  if (!isValidKey(keyB64u)) throw new E2eError('clave inválida')
  const ikm = await crypto.subtle.importKey('raw', buf(b64urlToBytes(keyB64u)), 'HKDF', false, ['deriveKey'])
  const derive = (info: string, usage: KeyUsage) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: buf(enc.encode('automed-e2e-v1')), info: buf(enc.encode(info)) },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage],
    )
  return { c2d: await derive('c2d', 'encrypt'), d2c: await derive('d2c', 'decrypt') }
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const aadReq = (deviceId: string) => enc.encode(`am-e2e1|req|${deviceId}`)
const aadRes = (deviceId: string, reqNonce: Uint8Array) => concat(enc.encode(`am-e2e1|res|${deviceId}|`), reqNonce)

function pack(head: unknown, body: Uint8Array): Uint8Array {
  const h = enc.encode(JSON.stringify(head))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, h.length)
  return concat(len, h, body)
}

function unpack(plain: Uint8Array): { head: unknown; body: Uint8Array } {
  if (plain.length < 4) throw new E2eError('contenido incompleto')
  const n = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0)
  if (4 + n > plain.length) throw new E2eError('contenido incompleto')
  try {
    return { head: JSON.parse(dec.decode(plain.subarray(4, 4 + n))), body: plain.subarray(4 + n) }
  } catch {
    throw new E2eError('cabecera inválida')
  }
}

/** Cifra una petición: devuelve el mensaje del cable y su nonce (con él se ata la respuesta). */
export async function sealRequest(
  keys: E2eKeys,
  deviceId: string,
  head: E2eRequestHead,
  body: Uint8Array,
): Promise<{ wire: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aadReq(deviceId)), tagLength: TAG_BYTES * 8 },
      keys.c2d,
      buf(pack(head, body)),
    ),
  )
  return { wire: concat(new Uint8Array([VERSION]), nonce, ct), nonce }
}

/** Abre la respuesta de SU petición; lanza E2eError si no autentica (clave errónea, manipulada, otra petición). */
export async function openResponse(
  keys: E2eKeys,
  deviceId: string,
  reqNonce: Uint8Array,
  wire: Uint8Array,
): Promise<{ head: E2eResponseHead; body: Uint8Array }> {
  if (wire.length < 1 + NONCE_BYTES + TAG_BYTES || wire[0] !== VERSION) throw new E2eError('mensaje inválido')
  let plain: Uint8Array
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: buf(wire.subarray(1, 1 + NONCE_BYTES)),
          additionalData: buf(aadRes(deviceId, reqNonce)),
          tagLength: TAG_BYTES * 8,
        },
        keys.d2c,
        buf(wire.subarray(1 + NONCE_BYTES)),
      ),
    )
  } catch {
    throw new E2eError('no se pudo autenticar')
  }
  const { head, body } = unpack(plain)
  const h = head as E2eResponseHead
  if (!h || !Number.isInteger(h.s) || typeof h.h !== 'object' || h.h === null) throw new E2eError('cabecera inválida')
  return { head: h, body }
}

// --- Almacenamiento de la clave y de las cookies (localStorage, siempre con try/catch) ---

// Respaldo en memoria por si localStorage no está disponible (ventana privada).
const mem = new Map<string, string>()

const keyName = (deviceId: string) => `am_e2e_${deviceId}`
const jarName = (deviceId: string) => `am_jar_${deviceId}`

/** null = no hay valor; undefined = localStorage no disponible (entonces vale la copia en memoria). */
function lsGet(k: string): string | null | undefined {
  try {
    return localStorage.getItem(k)
  } catch {
    return undefined
  }
}
const stored = (k: string): string | null => {
  const v = lsGet(k)
  return v === undefined ? (mem.get(k) ?? null) : v
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* sin almacenamiento: la clave solo dura esta pestaña (ver memoria) */
  }
}


export function deviceIdFromBase(base: string): string {
  return base.startsWith('/d/') ? base.slice(3) : ''
}

/**
 * Lee la clave del fragmento `#k=<clave>` del QR, la guarda y la quita de la barra de direcciones.
 * El fragmento nunca se envía al servidor.
 */
export function captureKeyFromHash(base: string = BASE_PATH, hash: string = typeof location === 'undefined' ? '' : location.hash): boolean {
  const id = deviceIdFromBase(base)
  if (!id) return false
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash)
  if (!m) return false
  mem.set(keyName(id), m[1])
  lsSet(keyName(id), m[1])
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    try {
      history.replaceState(history.state, '', location.pathname + location.search)
    } catch {
      /* nada */
    }
  }
  return true
}

export function loadKey(base: string = BASE_PATH): string | null {
  const id = deviceIdFromBase(base)
  if (!id) return null
  const k = stored(keyName(id))
  return isValidKey(k) ? k : null
}

/** Se usa el cifrado extremo a extremo cuando la app se abre por el relay (/d/<id>). */
export const usaE2e = (base: string = BASE_PATH) => !!deviceIdFromBase(base)

// --- Cookies: el relay no ve cookies, así que viajan DENTRO del sobre y las guarda esta tabla ---

interface JarEntry {
  value: string
  path: string
  exp?: number
}
type Jar = Record<string, JarEntry>

function readJar(id: string): Jar {
  try {
    const j = JSON.parse(stored(jarName(id)) ?? '{}')
    return j && typeof j === 'object' ? (j as Jar) : {}
  } catch {
    return {}
  }
}
function writeJar(id: string, jar: Jar) {
  const s = JSON.stringify(jar)
  mem.set(jarName(id), s)
  lsSet(jarName(id), s)
}

/** Aplica los Set-Cookie de una respuesta de la API a la tabla. */
export function storeSetCookies(id: string, setCookies: string[], now = Date.now()): void {
  if (!setCookies.length) return
  const jar = readJar(id)
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';').map((x) => x.trim())
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    let path = '/'
    let exp: number | undefined
    for (const a of attrs) {
      const [k, v = ''] = a.split('=')
      const key = k.toLowerCase()
      if (key === 'path' && v.startsWith('/')) path = v
      else if (key === 'max-age' && /^-?\d+$/.test(v)) exp = now + Number(v) * 1000
      else if (key === 'expires' && exp === undefined && !Number.isNaN(Date.parse(v))) exp = Date.parse(v)
    }
    if (!value || (exp !== undefined && exp <= now)) delete jar[name]
    else jar[name] = { value, path, exp }
  }
  writeJar(id, jar)
}

/** Cabecera Cookie para una ruta de la API (p. ej. '/api/threads'). */
export function cookieHeaderFor(id: string, apiPath: string, now = Date.now()): string {
  const jar = readJar(id)
  const pathOnly = apiPath.split('?')[0]
  const parts: string[] = []
  let dirty = false
  for (const [name, c] of Object.entries(jar)) {
    if (c.exp !== undefined && c.exp <= now) {
      delete jar[name]
      dirty = true
      continue
    }
    if (pathOnly === c.path || pathOnly.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`)) parts.push(`${name}=${c.value}`)
  }
  if (dirty) writeJar(id, jar)
  return parts.join('; ')
}

export const MENSAJE_SIN_CLAVE = 'Este celular no está vinculado. Escanea el código QR de tu computadora otra vez.'

const jsonResponse = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, message }), { status, headers: { 'Content-Type': 'application/json' } })

let keysCache: { key: string; keys: E2eKeys } | null = null

/**
 * Equivalente a `fetch` para la API, cifrado de extremo a extremo: toda la petición (método, ruta,
 * cookies, cuerpo) va dentro de un sobre; al relay solo llega `POST /d/<id>/e` con bytes opacos.
 * `path` es relativo a /api (como en `api()`).
 */
export async function secureFetch(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  base: string = BASE_PATH,
): Promise<Response> {
  const id = deviceIdFromBase(base)
  const key = loadKey(base)
  if (!key) return jsonResponse(400, MENSAJE_SIN_CLAVE)
  if (keysCache?.key !== key) keysCache = { key, keys: await deriveKeys(key) }
  const keys = keysCache.keys
  const apiPath = `/api${path}`
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  const cookie = cookieHeaderFor(id, apiPath)
  if (cookie) headers.cookie = cookie
  const { wire, nonce } = await sealRequest(
    keys,
    id,
    { m: init.method ?? 'GET', p: apiPath, h: headers, t: Date.now() },
    init.body ? enc.encode(init.body) : new Uint8Array(0),
  )
  const outer = await fetch(`${base}/e`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf(wire),
    credentials: 'omit',
    cache: 'no-store',
  })
  if (!outer.ok) {
    // Errores del propio relay/túnel (apagado, límite, tamaño...) vienen en claro y sin datos.
    if (outer.status === 400) return jsonResponse(400, 'No se pudo abrir la conexión segura. Escanea el código QR de tu computadora otra vez.')
    return outer
  }
  const opened = await openResponse(keys, id, nonce, new Uint8Array(await outer.arrayBuffer()))
  const resHeaders = new Headers()
  const cookies: string[] = []
  for (const [k, v] of Object.entries(opened.head.h)) {
    if (k.toLowerCase() === 'set-cookie') cookies.push(...(Array.isArray(v) ? v : [v]))
    else for (const x of Array.isArray(v) ? v : [v]) resHeaders.append(k, x)
  }
  storeSetCookies(id, cookies)
  const nullBody = [101, 204, 205, 304].includes(opened.head.s)
  return new Response(nullBody ? null : buf(opened.body), { status: opened.head.s, headers: resHeaders })
}
