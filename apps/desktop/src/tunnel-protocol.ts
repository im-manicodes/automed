/**
 * Protocolo de frames del túnel (módulo PURO, sin I/O). Una conexión WSS lleva muchas
 * peticiones HTTP a la vez ("streams"). Cada mensaje WebSocket es binario:
 *
 *   [1 byte tipo][4 bytes streamId (uint32 BE)][carga]
 *
 * ATENCIÓN: este archivo se copia tal cual en `apps/desktop/src/tunnel-protocol.ts`
 * (un test del escritorio comprueba que sean idénticos). Si cambias uno, copia al otro.
 */

export enum FrameType {
  /** relay -> escritorio. Carga JSON {method, path, headers}. */
  ReqHead = 1,
  /** relay -> escritorio. Carga: bytes del cuerpo. */
  ReqBody = 2,
  ReqEnd = 3,
  /** escritorio -> relay. Carga JSON {status, headers}. */
  ResHead = 4,
  ResBody = 5,
  ResEnd = 6,
  /** Cualquier sentido: cancela el stream. Carga JSON {message?, status?} (opcional). */
  Abort = 7,
  /** Cualquier sentido: el receptor ya consumió N bytes del cuerpo (carga uint32 BE). */
  Credit = 8,
  /** escritorio -> relay (streamId 0): olvida este dispositivo (desvincular). */
  Unregister = 9,
}

export const HEADER_SIZE = 5;
/** Tamaño máximo de un trozo de cuerpo en un frame. */
export const CHUNK_SIZE = 32 * 1024;
/** Bytes de cuerpo que un emisor puede tener sin confirmar (por stream y sentido). */
export const WINDOW_SIZE = 256 * 1024;
/** Tope de un mensaje WebSocket (cabeceras JSON incluidas). */
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_STREAMS_PER_DEVICE = 64;

export interface Frame {
  type: FrameType;
  streamId: number;
  payload: Buffer;
}

export interface ReqHeadPayload {
  method: string;
  /** Ruta + query (empieza por "/"), ya sin el prefijo /d/<deviceId>. */
  path: string;
  headers: Record<string, string | string[]>;
  /** IP real del celular, vista por el relay (solo para el límite de intentos de login de la API). */
  ip?: string;
}

export interface ResHeadPayload {
  status: number;
  headers: Record<string, string | string[]>;
}

export interface AbortPayload {
  message?: string;
}

export class ProtocolError extends Error {}

export function encodeFrame(type: FrameType, streamId: number, payload?: Buffer | Uint8Array): Buffer {
  const body = payload ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength) : Buffer.alloc(0);
  if (HEADER_SIZE + body.length > MAX_FRAME_BYTES) throw new ProtocolError('frame demasiado grande');
  const out = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  out.writeUInt8(type, 0);
  out.writeUInt32BE(streamId >>> 0, 1);
  body.copy(out, HEADER_SIZE);
  return out;
}

export function encodeJson(type: FrameType, streamId: number, value: unknown): Buffer {
  return encodeFrame(type, streamId, Buffer.from(JSON.stringify(value), 'utf8'));
}

export function encodeCredit(streamId: number, bytes: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(bytes >>> 0, 0);
  return encodeFrame(FrameType.Credit, streamId, b);
}

const VALID_TYPES = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export function decodeFrame(data: Buffer): Frame {
  if (data.length < HEADER_SIZE) throw new ProtocolError('frame incompleto');
  if (data.length > MAX_FRAME_BYTES) throw new ProtocolError('frame demasiado grande');
  const type = data.readUInt8(0);
  if (!VALID_TYPES.has(type)) throw new ProtocolError('tipo de frame desconocido');
  return { type, streamId: data.readUInt32BE(1), payload: data.subarray(HEADER_SIZE) };
}

export function parseJson<T>(payload: Buffer): T {
  try {
    return JSON.parse(payload.toString('utf8')) as T;
  } catch {
    throw new ProtocolError('JSON inválido');
  }
}

export function parseCredit(payload: Buffer): number {
  if (payload.length !== 4) throw new ProtocolError('crédito inválido');
  return payload.readUInt32BE(0);
}

export function parseReqHead(payload: Buffer): ReqHeadPayload {
  const h = parseJson<ReqHeadPayload>(payload);
  if (
    !h ||
    typeof h.method !== 'string' ||
    typeof h.path !== 'string' ||
    !h.path.startsWith('/') ||
    typeof h.headers !== 'object' ||
    h.headers === null ||
    (h.ip !== undefined && (typeof h.ip !== 'string' || h.ip.length > 64))
  ) {
    throw new ProtocolError('cabecera de petición inválida');
  }
  return h;
}

export function parseResHead(payload: Buffer): ResHeadPayload {
  const h = parseJson<ResHeadPayload>(payload);
  if (
    !h ||
    !Number.isInteger(h.status) ||
    h.status < 200 ||
    h.status > 599 ||
    typeof h.headers !== 'object' ||
    h.headers === null
  ) {
    throw new ProtocolError('cabecera de respuesta inválida');
  }
  return h;
}

/** Parte un cuerpo en trozos de a lo sumo `CHUNK_SIZE` bytes. */
export function* splitChunks(data: Buffer, size = CHUNK_SIZE): Generator<Buffer> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

// --- Cabeceras HTTP ---

/** Cabeceras que describen la conexión y nunca deben cruzar el túnel. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

/** Quita cabeceras de salto (y las listadas en `Connection`); claves en minúsculas. */
export function filterHeaders(
  headers: Record<string, string | string[] | undefined>,
  drop: string[] = [],
): Record<string, string | string[]> {
  const extra = new Set(drop.map((d) => d.toLowerCase()));
  const conn = Object.entries(headers).find(([k]) => k.toLowerCase() === 'connection')?.[1];
  for (const t of (Array.isArray(conn) ? conn.join(',') : (conn ?? '')).split(',')) {
    const n = t.trim().toLowerCase();
    if (n) extra.add(n);
  }
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (v === undefined || HOP_BY_HOP.has(key) || extra.has(key)) continue;
    out[key] = v;
  }
  return out;
}

// --- Control de flujo (backpressure) ---

/**
 * Ventana de crédito del EMISOR de un cuerpo: `take(n)` espera hasta que haya crédito;
 * el receptor devuelve crédito con frames `Credit` cuando ya escribió los bytes en su destino.
 */
export class SendWindow {
  private available: number;
  private waiters: Array<{ n: number; resolve: () => void; reject: (e: Error) => void }> = [];
  private closed: Error | null = null;

  constructor(size = WINDOW_SIZE) {
    this.available = size;
  }

  take(n: number): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.waiters.length === 0 && this.available >= n) {
      this.available -= n;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
    });
  }

  grant(n: number): void {
    this.available += n;
    while (this.waiters.length && this.available >= this.waiters[0].n) {
      const w = this.waiters.shift()!;
      this.available -= w.n;
      w.resolve();
    }
  }

  /** Cancela a quien espere (stream cerrado). */
  close(err = new Error('stream cerrado')): void {
    this.closed = err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }
}

// --- Límite de peticiones por IP ---

/** Ventana fija en memoria: `limit` eventos por `windowMs` y clave. Pura (reloj inyectable). */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = permitido. */
  hit(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) this.sweep(t);
    const h = this.hits.get(key);
    if (!h || t >= h.reset) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }

  private sweep(t: number) {
    for (const [k, h] of this.hits) if (t >= h.reset) this.hits.delete(k);
  }
}
