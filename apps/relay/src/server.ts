import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { DeviceRegistry } from './devices';
import { deviceManifest, matchDevicePath } from './http-util';
import { MAX_FRAME_BYTES, RateLimiter } from './protocol';
import { CODIGO_PC_APAGADA, Tunnel } from './tunnel';

export interface RelayOptions {
  /** Carpeta de datos (devices.json). Sin ella el registro vive solo en memoria. */
  dataDir?: string;
  /**
   * Carpeta del arranque (index.html, boot.js, sw.js, manifest.webmanifest, iconos). Es TODO el código que
   * sirve el relay; el front de apps/web lo entrega el escritorio por el canal cifrado (docs/relay-e2e.md).
   */
  bootstrapDir?: string;
  /** Añade Secure a las cookies (por defecto true; solo falso en pruebas sin HTTPS). */
  cookieSecure?: boolean;
  /** Detrás de un proxy (Dokku/nginx): la IP del cliente es el último valor de X-Forwarded-For. */
  trustProxy?: boolean;
  maxRequestBytes?: number;
  headTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Peticiones /d/*\/api por minuto y por IP. */
  httpRateLimit?: number;
  /** Intentos de conexión al túnel por minuto y por IP. */
  tunnelRateLimit?: number;
  maxDevices?: number;
  /** Si se define, registrar un deviceId NUEVO exige la cabecera X-Registration-Token con este valor. */
  registrationToken?: string;
  /** Solo metadatos mínimos; nunca rutas, cuerpos ni cabeceras. */
  log?: (line: string) => void;
}

export interface RelayServer {
  server: Server;
  registry: DeviceRegistry;
  tunnels: Map<string, Tunnel>;
  close(): Promise<void>;
}

/** Carpeta `bootstrap` de apps/relay (hermana de `src` y de `dist`). */
export const DEFAULT_BOOTSTRAP_DIR = resolve(__dirname, '..', 'bootstrap');
const ICONS = new Set(['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);

const SECURITY: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};
// Sin 'blob:' ni 'unsafe-inline' en script-src: el front verificado lo sirve el service worker bajo /d/<id>/_app/.
const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";

const digest = (s: string) => createHash('sha256').update(s).digest();
const tokenMatches = (got: string, expected: string) => timingSafeEqual(digest(got), digest(expected));

export function createRelayServer(o: RelayOptions = {}): RelayServer {
  const registry = new DeviceRegistry(o.dataDir ? join(o.dataDir, 'devices.json') : undefined, o.maxDevices);
  const tunnels = new Map<string, Tunnel>();
  const cookieSecure = o.cookieSecure ?? true;
  const log = o.log ?? (() => {});
  const httpLimit = new RateLimiter(o.httpRateLimit ?? 600, 60_000);
  const tunnelLimit = new RateLimiter(o.tunnelRateLimit ?? 30, 60_000);
  const dir = o.bootstrapDir ?? DEFAULT_BOOTSTRAP_DIR;
  // Se leen UNA vez al arrancar: los mismos bytes para todos los dispositivos (su hash está publicado).
  const load = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : null);
  const files = { index: load('index.html'), boot: load('boot.js'), sw: load('sw.js'), manifest: load('manifest.webmanifest') };
  const icons = new Map([...ICONS].map((i) => [i, load(i.slice(1))] as const));

  const ipOf = (req: IncomingMessage): string => {
    if (o.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',');
      const last = xff[xff.length - 1]?.trim();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? 'desconocida';
  };

  const send = (res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  };
  const jsonErr = (res: ServerResponse, status: number, message: string, code?: string) =>
    send(res, status, JSON.stringify(code ? { statusCode: status, code, message } : { statusCode: status, message }), 'application/json; charset=utf-8');

  const sendBytes = (req: IncomingMessage, res: ServerResponse, body: Buffer | null, type: string, extra: Record<string, string> = {}) => {
    if (!body) return jsonErr(res, 404, 'No se encontró lo que buscabas.');
    res.writeHead(200, { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': String(body.length), ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const serveBootstrap = (req: IncomingMessage, res: ServerResponse, deviceId: string, rest: string) => {
    const base = `/d/${deviceId}`;
    if (rest === '/manifest.webmanifest') {
      if (!files.manifest) return jsonErr(res, 404, 'No se encontró lo que buscabas.');
      return send(res, 200, deviceManifest(files.manifest.toString('utf8'), base), 'application/manifest+json; charset=utf-8', { 'Cache-Control': 'no-cache' });
    }
    if (rest === '/sw.js') return sendBytes(req, res, files.sw, 'text/javascript; charset=utf-8');
    // El relay NUNCA sirve código del front: eso lo entrega el escritorio por el canal cifrado.
    if (rest.startsWith('/_app/') || rest === '/_app') return jsonErr(res, 404, 'No se encontró lo que buscabas.');
    sendBytes(req, res, files.index, 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP });
  };

  if (!files.index || !files.boot || !files.sw) throw new Error(`Falta el arranque en ${dir} (index.html, boot.js, sw.js)`);
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    const path = url.split('?')[0];
    if (path === '/healthz') return send(res, 200, '{"ok":true}', 'application/json');

    const dev = matchDevicePath(url);
    if (dev) {
      // Única ruta hacia el escritorio: POST /d/<id>/e con un sobre cifrado de extremo a extremo
      // (método, ruta, cookies y cuerpo van DENTRO; el relay solo ve el tamaño). Nunca /api en claro.
      if (dev.rest === '/e') {
        if (req.method !== 'POST') return jsonErr(res, 405, 'Método no permitido.');
        const ip = ipOf(req);
        if (!httpLimit.hit(ip)) return jsonErr(res, 429, 'Hubo demasiados intentos. Espera un minuto y vuelve a intentar.');
        const t = tunnels.get(dev.deviceId);
        if (!t || !t.alive) {
          return jsonErr(res, 503, 'Tu computadora está apagada o sin conexión. Enciéndela y abre auto-med.', CODIGO_PC_APAGADA);
        }
        return t.proxy(req, res, '/e', ip);
      }
      if (dev.rest === '/api' || dev.rest.startsWith('/api/')) return jsonErr(res, 404, 'No se encontró lo que buscabas.');
      if (req.method !== 'GET' && req.method !== 'HEAD') return jsonErr(res, 405, 'Método no permitido.');
      // /d/<id> sin barra: el service worker solo controla /d/<id>/..., así que se redirige (el # se conserva).
      if (path === `/d/${dev.deviceId}`) {
        res.writeHead(301, { ...SECURITY, Location: `/d/${dev.deviceId}/${url.includes('?') ? url.slice(url.indexOf('?')) : ''}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      return serveBootstrap(req, res, dev.deviceId, dev.rest);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path === '/boot.js') return sendBytes(req, res, files.boot, 'text/javascript; charset=utf-8');
      if (ICONS.has(path)) return sendBytes(req, res, icons.get(path) ?? null, 'image/png', { 'Cache-Control': 'public, max-age=86400' });
    }
    if (path === '/') return send(res, 200, 'auto-med relay', 'text/plain; charset=utf-8');
    return jsonErr(res, 404, 'No se encontró lo que buscabas.');
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 0; // las descargas pueden tardar; el control lo llevan los temporizadores del túnel

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });

  const reject = (socket: Duplex, status: number, text: string) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/tunnel') return reject(socket, 404, 'Not Found');
    if (!tunnelLimit.hit(ipOf(req))) return reject(socket, 429, 'Too Many Requests');
    const deviceId = String(req.headers['x-device-id'] ?? '');
    const auth = String(req.headers['authorization'] ?? '');
    const secret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const v = registry.verify(deviceId, secret);
    if (v === 'bad') return reject(socket, 401, 'Unauthorized');
    if (v === 'new' && o.registrationToken && !tokenMatches(String(req.headers['x-registration-token'] ?? ''), o.registrationToken)) {
      return reject(socket, 401, 'Unauthorized');
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      if (v === 'new') registry.register(deviceId, secret);
      const previous = tunnels.get(deviceId);
      const tunnel = new Tunnel(deviceId, ws, `/d/${deviceId}`, {
        maxRequestBytes: o.maxRequestBytes ?? 1024 * 1024,
        headTimeoutMs: o.headTimeoutMs ?? 60_000,
        idleTimeoutMs: o.idleTimeoutMs ?? 120_000,
        cookieSecure,
        onUnregister: () => {
          registry.remove(deviceId);
          log(`dispositivo ${deviceId.slice(0, 6)} desvinculado`);
        },
      });
      tunnels.set(deviceId, tunnel);
      previous?.close(4000, 'reemplazado');
      log(`túnel conectado ${deviceId.slice(0, 6)}`);
      // Latido: un túnel que no contesta al ping se da por perdido (cambio de red, PC dormido).
      let pong = true;
      ws.on('pong', () => (pong = true));
      const beat = setInterval(() => {
        if (!pong) return ws.terminate();
        pong = false;
        ws.ping();
      }, 30_000);
      beat.unref();
      ws.on('close', () => {
        clearInterval(beat);
        if (tunnels.get(deviceId) === tunnel) tunnels.delete(deviceId);
        log(`túnel cerrado ${deviceId.slice(0, 6)}`);
      });
    });
  });

  return {
    server,
    registry,
    tunnels,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of tunnels.values()) t.close(1001, 'cierre del relay');
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
