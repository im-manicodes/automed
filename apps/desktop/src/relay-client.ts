import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket } from 'ws';
import {
  CHUNK_SIZE,
  FrameType,
  MAX_FRAME_BYTES,
  ProtocolError,
  SendWindow,
  decodeFrame,
  encodeCredit,
  encodeFrame,
  encodeJson,
  parseCredit,
  parseReqHead,
  splitChunks,
} from './tunnel-protocol';
import { E2eError, ReplayGuard, deriveKeys, openRequest, sealResponse } from './e2e-crypto';
import type { E2eKeys, E2eRequestHead } from './e2e-crypto';
import type { FrontBundle } from './front-bundle';

export type RelayState = 'desconectado' | 'conectando' | 'conectado' | 'rechazado';

export interface RelayClientOptions {
  /** Dirección del relay, p. ej. https://relay.ejemplo.com (o http://127.0.0.1:puerto en pruebas). */
  relayUrl: string;
  deviceId: string;
  secret: string;
  /** Clave E2E (32 bytes, base64url) compartida con el celular por el QR. Nunca viaja al relay. */
  e2eKey: string;
  /** Token de registro del relay (RELAY_REGISTRATION_TOKEN) para dar de alta un deviceId nuevo. */
  registrationToken?: string;
  /**
   * Token compartido con la API local: junto a la IP real del celular (que ve el relay) permite que el
   * limitador de login de la API distinga celulares. Sin él no se reenvía la IP.
   */
  ipToken?: string;
  /** Front de apps/web que el celular pide por el canal cifrado (`/_front/*`); sin él esas rutas dan 404. */
  front?: FrontBundle;
  /** Puerto de la API local; null mientras arranca o está caída (se responde 503). */
  getPort: () => number | null;
  log?: (line: string) => void;
  /** Reconexión: espera mínima y máxima en ms (por defecto 1 s -> 60 s, con ruido). */
  backoff?: { minMs: number; maxMs: number };
}

/** Tope del sobre cifrado de una petición del celular (el front envía JSON pequeño). */
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
/** Tope de una respuesta de la API (PDF/Excel/imágenes); se cifra de una vez, así que se acota. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const INNER_TIMEOUT_MS = 55_000;
const INNER_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Cabeceras que se aceptan DENTRO del sobre (lo demás se descarta). */
const REQ_HEADERS = ['content-type', 'cookie', 'authorization', 'accept'];
/** Cabeceras de la API que se devuelven DENTRO del sobre. */
const RES_HEADERS = ['content-type', 'content-disposition', 'set-cookie', 'cache-control'];

interface ClientStream {
  chunks: Buffer[];
  size: number;
  ip?: string;
  local: ClientRequest | null;
  window: SendWindow;
  done: boolean;
  replied?: boolean;
}

export function tunnelUrl(relayUrl: string): string {
  const u = new URL('/tunnel', relayUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/**
 * Cliente del túnel: conexión WSS SALIENTE al relay con reconexión; reenvía cada petición del
 * celular a la API en 127.0.0.1 reescribiendo Origin/Referer/Host al origen interno, así la
 * validación de Origin de la API no cambia. Nunca registra rutas ni contenido.
 */
export class RelayClient extends EventEmitter {
  state: RelayState = 'desconectado';
  private ws: WebSocket | null = null;
  private streams = new Map<number, ClientStream>();
  private timer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private running = false;
  private openedAt = 0;
  private readonly keys: E2eKeys;
  private readonly guard = new ReplayGuard();

  constructor(private readonly o: RelayClientOptions) {
    super();
    this.keys = deriveKeys(o.e2eKey);
  }

  private log(l: string) {
    this.o.log?.(`relay: ${l}`);
  }

  private setState(s: RelayState) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.removeAllListeners();
    this.ws?.on('error', () => {});
    this.ws?.close(1000, 'cerrado');
    this.ws = null;
    this.closeStreams();
    this.setState('desconectado');
  }

  /** Pide al relay olvidar este dispositivo (si hay conexión) y se detiene. */
  async unregister(): Promise<void> {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 3000);
        ws.once('close', () => {
          clearTimeout(t);
          resolve();
        });
        ws.send(encodeFrame(FrameType.Unregister, 0), (err) => {
          if (err) resolve();
        });
      });
    }
    this.stop();
  }

  private connect() {
    if (!this.running) return;
    this.setState('conectando');
    let ws: WebSocket;
    try {
      ws = new WebSocket(tunnelUrl(this.o.relayUrl), {
        headers: {
          'x-device-id': this.o.deviceId,
          authorization: `Bearer ${this.o.secret}`,
          ...(this.o.registrationToken ? { 'x-registration-token': this.o.registrationToken } : {}),
        },
        maxPayload: MAX_FRAME_BYTES,
        handshakeTimeout: 15_000,
        perMessageDeflate: false,
      });
    } catch {
      this.log('dirección del relay inválida');
      this.setState('rechazado');
      this.running = false;
      return;
    }
    this.ws = ws;
    let lastSeen = Date.now();
    const alive = setInterval(() => {
      // El relay manda ping cada 30 s: sin señales en 75 s la conexión está muerta.
      if (Date.now() - lastSeen > 75_000) ws.terminate();
    }, 15_000);
    alive.unref();

    ws.on('open', () => {
      this.openedAt = Date.now();
      lastSeen = Date.now();
      this.setState('conectado');
      this.log('conectado');
    });
    ws.on('ping', () => (lastSeen = Date.now()));
    ws.on('message', (data, isBinary) => {
      lastSeen = Date.now();
      if (!isBinary) return ws.close(1003, 'solo binario');
      try {
        this.onFrame(decodeFrame(data as Buffer));
      } catch (e) {
        if (e instanceof ProtocolError) ws.close(1002, 'protocolo');
        else this.log('error al procesar un frame');
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      if (res.statusCode === 401) {
        // Secreto no aceptado: reintentar no sirve. El usuario debe desvincular y volver a activar.
        this.log('el relay rechazó el dispositivo');
        this.running = false;
        this.setState('rechazado');
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearInterval(alive);
      if (this.ws === ws) this.ws = null;
      this.closeStreams();
      if (!this.running) return;
      if (this.state !== 'rechazado') this.setState('desconectado');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (!this.running || this.timer) return;
    if (this.openedAt && Date.now() - this.openedAt > 10_000) this.attempts = 0;
    this.openedAt = 0;
    const { minMs, maxMs } = this.o.backoff ?? { minMs: 1000, maxMs: 60_000 };
    const base = Math.min(maxMs, minMs * 2 ** this.attempts++);
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.log(`reintento en ${Math.round(delay / 1000)} s`);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private send(frame: Buffer, cb?: (err?: Error) => void) {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame, cb);
    else cb?.(new Error('sin conexión'));
  }

  private closeStreams() {
    for (const [id, s] of this.streams) {
      s.done = true;
      s.window.close();
      s.local?.destroy();
      this.streams.delete(id);
    }
  }

  private replyError(id: number, status: number, message: string) {
    const body = Buffer.from(JSON.stringify({ statusCode: status, message }));
    this.send(
      encodeJson(FrameType.ResHead, id, {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length) },
      }),
    );
    this.send(encodeFrame(FrameType.ResBody, id, body));
    this.send(encodeFrame(FrameType.ResEnd, id));
    this.streams.delete(id);
  }

  private onFrame(f: ReturnType<typeof decodeFrame>) {
    switch (f.type) {
      case FrameType.ReqHead:
        return this.onRequest(f.streamId, f.payload);
      case FrameType.ReqBody: {
        const s = this.streams.get(f.streamId);
        if (!s || s.done) return;
        s.size += f.payload.length;
        if (s.size > MAX_ENVELOPE_BYTES) {
          this.dropStream(f.streamId);
          this.send(encodeJson(FrameType.Abort, f.streamId, { message: 'La petición es demasiado grande.' }));
          return;
        }
        s.chunks.push(Buffer.from(f.payload));
        this.send(encodeCredit(f.streamId, f.payload.length));
        return;
      }
      case FrameType.ReqEnd: {
        const s = this.streams.get(f.streamId);
        if (s && !s.done) void this.handleEnvelope(f.streamId, s);
        return;
      }
      case FrameType.Credit:
        this.streams.get(f.streamId)?.window.grant(parseCredit(f.payload));
        return;
      case FrameType.Abort:
        this.dropStream(f.streamId);
        return;
      default:
        throw new ProtocolError('frame inesperado');
    }
  }

  private dropStream(id: number) {
    const s = this.streams.get(id);
    if (!s) return;
    s.done = true;
    s.window.close();
    s.local?.destroy();
    this.streams.delete(id);
  }

  private onRequest(id: number, payload: Buffer) {
    const head = parseReqHead(payload);
    if (this.o.getPort() === null) return this.replyError(id, 503, 'La aplicación de tu computadora está iniciando. Intenta en un momento.');
    // Única entrada: el sobre cifrado. Nada en claro llega a la API por el túnel.
    if (head.method !== 'POST' || head.path !== '/e') return this.replyError(id, 403, 'Ruta no permitida.');
    const ip = head.ip && isIP(head.ip) ? head.ip : undefined;
    this.streams.set(id, { chunks: [], size: 0, ip, local: null, window: new SendWindow(), done: false, replied: false });
  }

  /** Sobre completo: abrir (autenticar) -> pedir a la API local -> cifrar la respuesta. */
  private async handleEnvelope(id: number, s: ClientStream) {
    const port = this.o.getPort();
    if (port === null) return this.replyError(id, 503, 'La aplicación de tu computadora está iniciando. Intenta en un momento.');
    let opened: ReturnType<typeof openRequest>;
    try {
      opened = openRequest(this.keys, this.o.deviceId, Buffer.concat(s.chunks), this.guard);
    } catch (e) {
      // Lo que no descifra o no valida se descarta; sin detalles (ni contenido) en el mensaje ni en el log.
      this.log('sobre rechazado');
      const code = e instanceof E2eError ? e.code : 'formato';
      if (code === 'reloj' || code === 'repetido') {
        return this.replyError(id, 409, 'No se pudo verificar la petición. Revisa la fecha y hora de tu celular.');
      }
      return this.replyError(id, 400, 'No se pudo abrir la conexión segura.');
    }
    s.chunks = [];
    const { head, body, nonce } = opened;
    const reply = (status: number, headers: Record<string, string | string[]>, payload: Buffer) => {
      if (s.done || s.replied) return;
      s.replied = true;
      void this.sendSealed(id, s, sealResponse(this.keys, this.o.deviceId, nonce, { s: status, h: headers }, payload));
    };
    const fail = (status: number, message: string) =>
      reply(status, { 'content-type': 'application/json; charset=utf-8' }, Buffer.from(JSON.stringify({ statusCode: status, message })));

    if (head.p.startsWith('/_front/')) return this.serveFront(head, reply, fail);

    if (!INNER_METHODS.has(head.m) || (head.p !== '/api' && !head.p.startsWith('/api/') && !head.p.startsWith('/api?'))) {
      return fail(403, 'Ruta no permitida.');
    }
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method: head.m,
      path: head.p,
      headers: this.localHeaders(head, port, body.length, s.ip),
      timeout: INNER_TIMEOUT_MS,
    });
    s.local = req;
    req.on('timeout', () => req.destroy());
    req.on('error', () => fail(502, 'La aplicación de tu computadora no pudo responder.'));
    req.on('response', (res) => {
      const parts: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX_RESPONSE_BYTES) {
          res.destroy();
          fail(502, 'La respuesta es demasiado grande.');
        } else parts.push(c);
      });
      res.on('end', () => {
        if (total > MAX_RESPONSE_BYTES) return;
        const headers: Record<string, string | string[]> = {};
        for (const k of RES_HEADERS) {
          const v = res.headers[k];
          if (v !== undefined) headers[k] = v;
        }
        reply(res.statusCode ?? 502, headers, Buffer.concat(parts));
      });
      res.on('error', () => fail(502, 'Se interrumpió la respuesta.'));
    });
    req.end(body);
  }

  /** `/_front/manifest` y `/_front/f/<ruta>`: el front verificable que ejecuta el arranque del celular. */
  private serveFront(
    head: E2eRequestHead,
    reply: (status: number, headers: Record<string, string | string[]>, payload: Buffer) => void,
    fail: (status: number, message: string) => void,
  ) {
    const front = this.o.front;
    if (head.m !== 'GET' || !front) return fail(404, 'No se encontró lo que buscabas.');
    try {
      if (head.p === '/_front/manifest') return reply(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, front.manifest(this.o.deviceId));
      if (head.p.startsWith('/_front/f/')) {
        const f = front.file(head.p.slice('/_front/f/'.length));
        if (f) return reply(200, { 'content-type': f.type, 'cache-control': 'no-store' }, f.bytes);
      }
    } catch {
      return fail(500, 'No se pudo preparar la aplicación.');
    }
    return fail(404, 'No se encontró lo que buscabas.');
  }

  private localHeaders(head: E2eRequestHead, port: number, bodyLen: number, ip?: string): Record<string, string> {
    const local = `http://localhost:${port}`;
    const out: Record<string, string> = {};
    for (const k of REQ_HEADERS) {
      const v = head.h[k] ?? head.h[k.toLowerCase()];
      if (typeof v === 'string') out[k] = v;
    }
    // Mismo origen interno: la validación de Origin/cookies de la API no cambia.
    out.host = `localhost:${port}`;
    out.origin = local;
    out.referer = `${local}/`;
    if (bodyLen > 0 || head.m === 'POST' || head.m === 'PUT' || head.m === 'PATCH') out['content-length'] = String(bodyLen);
    if (ip && this.o.ipToken) {
      out['x-automed-relay-ip'] = ip;
      out['x-automed-relay-token'] = this.o.ipToken;
    }
    return out;
  }

  private async sendSealed(id: number, s: ClientStream, wire: Buffer) {
    try {
      this.send(
        encodeJson(FrameType.ResHead, id, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(wire.length) },
        }),
      );
      for (const part of splitChunks(wire, CHUNK_SIZE)) {
        await s.window.take(part.length);
        if (s.done) return;
        this.send(encodeFrame(FrameType.ResBody, id, part));
      }
      if (s.done) return;
      s.done = true;
      s.window.close();
      this.streams.delete(id);
      this.send(encodeFrame(FrameType.ResEnd, id));
    } catch {
      this.dropStream(id);
      this.send(encodeJson(FrameType.Abort, id, { message: 'Se interrumpió la respuesta.' }));
    }
  }
}
