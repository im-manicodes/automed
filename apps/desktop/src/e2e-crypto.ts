import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado extremo a extremo celular <-> escritorio (lado escritorio, node:crypto). Su pareja en el
 * navegador es `apps/web/src/lib/e2e.ts` (WebCrypto); ambas deben producir/leer EXACTAMENTE el mismo
 * formato (el e2e local del escritorio prueba la interoperabilidad). Diseño y amenazas: docs/relay-e2e.md.
 *
 * Mensaje en el cable:  [1 byte versión=1][12 bytes nonce aleatorio][texto cifrado AES-256-GCM + etiqueta 16 B]
 *   - Clave: K (32 bytes, solo en el QR y en el escritorio). Se derivan dos claves por dirección con
 *     HKDF-SHA256 (info 'c2d' celular->escritorio, 'd2c' escritorio->celular): un mensaje de una dirección
 *     jamás se acepta en la otra (sin reflejos).
 *   - AAD petición:  "am-e2e1|req|<deviceId>".  AAD respuesta: "am-e2e1|res|<deviceId>|" + nonce de la petición
 *     (la respuesta queda atada a SU petición: no se puede cambiar por otra ni repetir una vieja).
 *   - Petición (texto claro):  [u32 BE largo cabecera][JSON {m,p,h,t}][cuerpo]   (t = ms epoch del celular)
 *   - Respuesta (texto claro): [u32 BE largo cabecera][JSON {s,h}][cuerpo]
 */

export const E2E_VERSION = 1;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const SALT = Buffer.from('automed-e2e-v1');
/** Tolerancia entre el reloj del celular y el del escritorio. */
export const MAX_SKEW_MS = 5 * 60_000;

export class E2eError extends Error {
  constructor(
    message: string,
    /** 'formato' | 'autenticacion' | 'reloj' | 'repetido' */
    readonly code: 'formato' | 'autenticacion' | 'reloj' | 'repetido',
  ) {
    super(message);
  }
}

export interface E2eKeys {
  c2d: Buffer;
  d2c: Buffer;
}

export interface E2eRequestHead {
  /** Método HTTP. */
  m: string;
  /** Ruta + query de la API, empieza por /api. */
  p: string;
  /** Cabeceras sensibles/necesarias (cookie, authorization, content-type, accept). */
  h: Record<string, string>;
  /** Marca de tiempo del celular (ms). */
  t: number;
}

export interface E2eResponseHead {
  s: number;
  h: Record<string, string | string[]>;
}

export function generateE2eKey(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidE2eKey(k: unknown): k is string {
  return typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k) && Buffer.from(k, 'base64url').length === 32;
}

export function deriveKeys(keyB64u: string): E2eKeys {
  if (!isValidE2eKey(keyB64u)) throw new E2eError('clave inválida', 'formato');
  const ikm = Buffer.from(keyB64u, 'base64url');
  return {
    c2d: Buffer.from(hkdfSync('sha256', ikm, SALT, 'c2d', 32)),
    d2c: Buffer.from(hkdfSync('sha256', ikm, SALT, 'd2c', 32)),
  };
}

const aadReq = (deviceId: string) => Buffer.from(`am-e2e1|req|${deviceId}`);
const aadRes = (deviceId: string, reqNonce: Buffer) => Buffer.concat([Buffer.from(`am-e2e1|res|${deviceId}|`), reqNonce]);

function seal(key: Buffer, aad: Buffer, plain: Buffer): { wire: Buffer; nonce: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { wire: Buffer.concat([Buffer.from([E2E_VERSION]), nonce, ct, c.getAuthTag()]), nonce };
}

function open(key: Buffer, aad: Buffer, wire: Buffer): { plain: Buffer; nonce: Buffer } {
  if (wire.length < 1 + NONCE_BYTES + TAG_BYTES) throw new E2eError('mensaje incompleto', 'formato');
  if (wire[0] !== E2E_VERSION) throw new E2eError('versión desconocida', 'formato');
  const nonce = wire.subarray(1, 1 + NONCE_BYTES);
  const tag = wire.subarray(wire.length - TAG_BYTES);
  const ct = wire.subarray(1 + NONCE_BYTES, wire.length - TAG_BYTES);
  try {
    const d = createDecipheriv('aes-256-gcm', key, nonce);
    d.setAAD(aad);
    d.setAuthTag(tag);
    return { plain: Buffer.concat([d.update(ct), d.final()]), nonce: Buffer.from(nonce) };
  } catch {
    throw new E2eError('no se pudo autenticar', 'autenticacion');
  }
}

function pack(head: unknown, body: Buffer): Buffer {
  const h = Buffer.from(JSON.stringify(head), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(h.length, 0);
  return Buffer.concat([len, h, body]);
}

function unpack(plain: Buffer): { head: unknown; body: Buffer } {
  if (plain.length < 4) throw new E2eError('contenido incompleto', 'formato');
  const n = plain.readUInt32BE(0);
  if (4 + n > plain.length) throw new E2eError('contenido incompleto', 'formato');
  try {
    return { head: JSON.parse(plain.subarray(4, 4 + n).toString('utf8')), body: plain.subarray(4 + n) };
  } catch {
    throw new E2eError('cabecera inválida', 'formato');
  }
}

/**
 * Anti-repetición de peticiones: nonces vistos dentro de la ventana de tiempo y una cota inferior
 * (arranque del escritorio) para que lo capturado antes de reiniciar no se acepte.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly notBefore: number = Date.now(),
    private readonly maxEntries = 50_000,
    private readonly skewMs = MAX_SKEW_MS,
  ) {}

  /** Lanza E2eError si la petición es vieja, futura o repetida; si no, la registra. */
  check(nonce: Buffer, t: number, now = Date.now()): void {
    if (!Number.isFinite(t) || Math.abs(now - t) > this.skewMs || t < this.notBefore) {
      throw new E2eError('marca de tiempo fuera de rango', 'reloj');
    }
    const key = nonce.toString('hex');
    if (this.seen.size >= this.maxEntries) this.sweep(now);
    if (this.seen.has(key)) throw new E2eError('petición repetida', 'repetido');
    if (this.seen.size >= this.maxEntries) throw new E2eError('demasiadas peticiones', 'repetido');
    // Se recuerda hasta que su marca de tiempo ya no pueda pasar la ventana.
    this.seen.set(key, t + this.skewMs);
  }

  private sweep(now: number) {
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
  }
}

export interface OpenedRequest {
  head: E2eRequestHead;
  body: Buffer;
  nonce: Buffer;
}

/** Abre una petición del celular: autentica, valida formato y marca de tiempo, y rechaza repeticiones. */
export function openRequest(keys: E2eKeys, deviceId: string, wire: Buffer, guard: ReplayGuard, now = Date.now()): OpenedRequest {
  const { plain, nonce } = open(keys.c2d, aadReq(deviceId), wire);
  const { head, body } = unpack(plain);
  const h = head as E2eRequestHead;
  if (
    !h ||
    typeof h.m !== 'string' ||
    typeof h.p !== 'string' ||
    typeof h.t !== 'number' ||
    typeof h.h !== 'object' ||
    h.h === null ||
    Object.values(h.h).some((v) => typeof v !== 'string')
  ) {
    throw new E2eError('cabecera inválida', 'formato');
  }
  guard.check(nonce, h.t, now);
  return { head: h, body, nonce };
}

/** Cifra la respuesta atándola al nonce de la petición. */
export function sealResponse(keys: E2eKeys, deviceId: string, reqNonce: Buffer, head: E2eResponseHead, body: Buffer): Buffer {
  return seal(keys.d2c, aadRes(deviceId, reqNonce), pack(head, body)).wire;
}

// --- Lado celular (solo para pruebas e interoperabilidad; el real vive en apps/web/src/lib/e2e.ts) ---

export function sealRequest(keys: E2eKeys, deviceId: string, head: E2eRequestHead, body: Buffer): { wire: Buffer; nonce: Buffer } {
  return seal(keys.c2d, aadReq(deviceId), pack(head, body));
}

export function openResponse(keys: E2eKeys, deviceId: string, reqNonce: Buffer, wire: Buffer): { head: E2eResponseHead; body: Buffer } {
  const { plain } = open(keys.d2c, aadRes(deviceId, reqNonce), wire);
  const { head, body } = unpack(plain);
  return { head: head as E2eResponseHead, body };
}
