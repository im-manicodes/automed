import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RelayConfigError } from './relay-manager';
import type { RelayManager } from './relay-manager';

async function readJson(req: IncomingMessage): Promise<{ activo?: unknown } | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 1024) return null;
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { activo?: unknown };
  } catch {
    return null;
  }
}

export interface RelayControl {
  url: string;
  token: string;
  close(): Promise<void>;
}

/**
 * Control local del túnel para la API (que corre en otro proceso): HTTP en 127.0.0.1 con un
 * token aleatorio por arranque. Rutas: GET /status, POST /enable, POST /disable, POST /keep-awake {activo}.
 */
export async function startRelayControl(manager: RelayManager): Promise<RelayControl> {
  const token = randomBytes(24).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const got = Buffer.from(String(req.headers.authorization ?? ''));
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return json(401, { message: 'No autorizado' });
    const route = `${req.method} ${req.url}`;
    void (async () => {
      try {
        if (route === 'POST /keep-awake') {
          const body = await readJson(req);
          if (typeof body?.activo !== 'boolean') return json(400, { message: 'Dato inválido' });
          return json(200, manager.setKeepAwake(body.activo));
        }
        if (route === 'GET /status') return json(200, manager.status());
        if (route === 'POST /enable') return json(200, manager.enable());
        if (route === 'POST /disable') return json(200, await manager.disable());
        json(404, { message: 'No encontrado' });
      } catch (e) {
        if (e instanceof RelayConfigError) return json(400, { message: e.message });
        json(500, { message: 'Error interno' });
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () => new Promise<void>((r) => (server.close(() => r()), server.closeAllConnections())),
  };
}
