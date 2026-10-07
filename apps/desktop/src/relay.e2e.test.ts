import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelayServer } from '../../relay/src/server';
import type { RelayServer } from '../../relay/src/server';
import { RelayClient } from './relay-client';
import { generateE2eKey } from './e2e-crypto';
import { RelayManager } from './relay-manager';
import * as web from '../../web/src/lib/e2e';
import { generateSecrets } from './secrets';

// e2e local: relay real + cliente del túnel real + "API" de prueba. Sin BD, sin RustFS, sin datos reales.

const BIG = randomBytes(5 * 1024 * 1024);
const BIG_SHA = createHash('sha256').update(BIG).digest('hex');

let tmp: string;
let api: Server;
let apiPort: number;
let relay: RelayServer;
let relayPort: number;
let relayUrl: string;

function fakeApi(): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/api/big') {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(BIG.length) });
        return res.end(BIG);
      }
      if (req.url === '/api/cookies') {
        res.writeHead(200, {
          'set-cookie': ['am_access=a; Path=/; HttpOnly; SameSite=Lax', 'am_refresh=r; Path=/api/auth; HttpOnly'],
          'content-type': 'application/json',
        });
        return res.end('{}');
      }
      const body = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          origin: req.headers.origin ?? null,
          host: req.headers.host,
          cookie: req.headers.cookie ?? null,
          ctype: req.headers['content-type'] ?? null,
          relayIp: req.headers['x-automed-relay-ip'] ?? null,
          relayToken: req.headers['x-automed-relay-token'] ?? null,
          xff: req.headers['x-forwarded-for'] ?? null,
          bodySha: createHash('sha256').update(body).digest('hex'),
          bodyLen: body.length,
        }),
      );
    });
  });
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function call(
  path: string,
  o: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: relayPort, path, method: o.method ?? 'GET', headers: o.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end(o.body);
  });
}

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const ID = 'e2eDevice0123456789abcd';
const SECRET = 'e2eSecret0123456789abcdefghijklmnopqrstu';
const KEY = generateE2eKey();
const REG = 'token-de-registro-de-prueba';
const IP_TOKEN = 'token-ip-de-prueba';

const newClient = (id: string, secret: string, port: number | null = apiPort, extra: Partial<ConstructorParameters<typeof RelayClient>[0]> = {}) =>
  new RelayClient({
    relayUrl,
    deviceId: id,
    secret,
    e2eKey: KEY,
    registrationToken: REG,
    ipToken: IP_TOKEN,
    getPort: () => port,
    backoff: { minMs: 50, maxMs: 200 },
    ...extra,
  });

interface Secure {
  outer: Reply;
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  wire: Uint8Array;
}

/** El "celular": sobre cifrado con la implementación WebCrypto del front, enviado a /d/<id>/e. */
async function secure(
  path: string,
  o: { method?: string; headers?: Record<string, string>; body?: Buffer; key?: string; t?: number; id?: string; wire?: Uint8Array; nonce?: Uint8Array } = {},
): Promise<Secure> {
  const id = o.id ?? ID;
  const keys = await web.deriveKeys(o.key ?? KEY);
  const sealed =
    o.wire && o.nonce
      ? { wire: o.wire, nonce: o.nonce }
      : await web.sealRequest(keys, ID, { m: o.method ?? 'GET', p: path, h: o.headers ?? {}, t: o.t ?? Date.now() }, new Uint8Array(o.body ?? []));
  const outer = await call(`/d/${id}/e`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(sealed.wire.length) },
    body: Buffer.from(sealed.wire),
  });
  if (outer.status !== 200) return { outer, status: 0, headers: {}, body: Buffer.alloc(0), wire: sealed.wire };
  const opened = await web.openResponse(keys, ID, sealed.nonce, new Uint8Array(outer.body));
  return { outer, status: opened.head.s, headers: opened.head.h, body: Buffer.from(opened.body), wire: sealed.wire };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'automed-relay-e2e-'));
  api = fakeApi();
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
  apiPort = (api.address() as AddressInfo).port;
  relay = createRelayServer({
    dataDir: join(tmp, 'relay-data'),
    cookieSecure: true,
    registrationToken: REG,
    maxRequestBytes: 64 * 1024,
    headTimeoutMs: 3000,
  });
  await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
  relayPort = (relay.server.address() as AddressInfo).port;
  relayUrl = `http://127.0.0.1:${relayPort}`;
});

afterAll(async () => {
  await relay.close();
  api.close();
  api.closeAllConnections();
  rmSync(tmp, { recursive: true, force: true });
});


const json = (r: Secure) => JSON.parse(r.body.toString());

describe('relay + cliente del túnel (cifrado E2E)', () => {
  it('sin túnel responde 503 en español; el front se sirve igual; /api en claro no existe', async () => {
    const r = await secure('/api/hello');
    expect(r.outer.status).toBe(503);
    expect(JSON.parse(r.outer.body.toString()).message).toMatch(/apagada/);
    expect(JSON.parse(r.outer.body.toString()).code).toBe('pc_apagada');
    expect((await call(`/d/${ID}/api/hello`)).status).toBe(404);
    expect((await call(`/d/${ID}/e`)).status).toBe(405);
    const page = await call(`/d/${ID}/tickets`);
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain('src="/boot.js"');
    expect(page.headers['content-security-policy']).toContain("script-src 'self';");
    expect((await call(`/d/${ID}`)).status).toBe(301);
    // El relay ya no sirve código del front: ni /assets ni /d/<id>/_app.
    expect((await call('/assets/app.js')).status).toBe(404);
    expect((await call(`/d/${ID}/_app/assets/index.js`)).status).toBe(404);
    expect(JSON.parse((await call(`/d/${ID}/manifest.webmanifest`)).body.toString()).start_url).toBe(`/d/${ID}/tickets`);
    expect((await call('/boot.js')).status).toBe(200);
    expect((await call('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404);
  });

  it('reenvía cifrado, reescribe Origin/Host y la IP real solo viaja con el token', async () => {
    const c = newClient(ID, SECRET);
    c.start();
    try {
      await until(() => c.state === 'conectado');
      const body = Buffer.from(JSON.stringify({ email: 'paciente@ejemplo.com' }));
      const r = await secure('/api/echo?x=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'am_access=tok-secreto' },
        body,
      });
      expect(r.status).toBe(200);
      const j = json(r);
      expect(j).toMatchObject({ method: 'POST', url: '/api/echo?x=1', cookie: 'am_access=tok-secreto', bodyLen: body.length, ctype: 'application/json' });
      expect(j.origin).toBe(`http://localhost:${apiPort}`);
      expect(j.host).toBe(`localhost:${apiPort}`);
      expect(j.relayToken).toBe(IP_TOKEN);
      expect(['127.0.0.1', '::ffff:127.0.0.1']).toContain(j.relayIp);
      expect(j.xff).toBeNull();
      // Lo que ve el relay (cable): ni ruta, ni cookie, ni cuerpo.
      const wire = Buffer.from(r.wire).toString('latin1');
      for (const secret of ['tok-secreto', 'paciente', '/api/echo', 'am_access']) expect(wire).not.toContain(secret);
      expect(r.outer.body.toString('latin1')).not.toContain('"method"');
      // Cabeceras falsas del celular dentro del sobre no pasan (lista blanca).
      const spoof = await secure('/api/echo', { headers: { 'x-automed-relay-ip': '6.6.6.6', 'x-automed-relay-token': 'x', 'x-forwarded-for': '6.6.6.6' } });
      expect(json(spoof).relayIp).not.toBe('6.6.6.6');
      expect(json(spoof).xff).toBeNull();
    } finally {
      c.stop();
    }
  });

  it('sin token compartido con la API no se reenvía la IP', async () => {
    const c = newClient(ID, SECRET, apiPort, { ipToken: undefined });
    c.start();
    try {
      await until(() => c.state === 'conectado');
      const j = json(await secure('/api/echo'));
      expect(j.relayIp).toBeNull();
      expect(j.relayToken).toBeNull();
    } finally {
      c.stop();
    }
  });

  it('las cookies viajan DENTRO del sobre: el relay no ve Set-Cookie', async () => {
    const c = newClient(ID, SECRET);
    c.start();
    try {
      await until(() => c.state === 'conectado');
      const r = await secure('/api/cookies');
      expect(r.outer.headers['set-cookie']).toBeUndefined();
      expect(r.headers['set-cookie']).toEqual(['am_access=a; Path=/; HttpOnly; SameSite=Lax', 'am_refresh=r; Path=/api/auth; HttpOnly']);
    } finally {
      c.stop();
    }
  });

  it('descarga 5 MB íntegra y sube 60 KB; rechaza cuerpos enormes (413)', async () => {
    const c = newClient(ID, SECRET);
    c.start();
    try {
      await until(() => c.state === 'conectado');
      const r = await secure('/api/big');
      expect(r.status).toBe(200);
      expect(createHash('sha256').update(r.body).digest('hex')).toBe(BIG_SHA);

      const up = randomBytes(40 * 1024);
      const ok = await secure('/api/up', { method: 'POST', body: up });
      expect(json(ok)).toMatchObject({ bodyLen: up.length, bodySha: createHash('sha256').update(up).digest('hex') });

      const big = randomBytes(200 * 1024);
      const no = await secure('/api/up', { method: 'POST', body: big });
      expect(no.outer.status).toBe(413);
    } finally {
      c.stop();
    }
  });

  it('manipulado, repetido, clave errónea, reloj y rutas fuera de /api: se rechazan', async () => {
    const c = newClient(ID, SECRET);
    c.start();
    try {
      await until(() => c.state === 'conectado');
      const keys = await web.deriveKeys(KEY);

      // Manipulación de un bit: el escritorio no descifra.
      const sealed = await web.sealRequest(keys, ID, { m: 'GET', p: '/api/hello', h: {}, t: Date.now() }, new Uint8Array(0));
      const bad = new Uint8Array(sealed.wire);
      bad[bad.length - 1] ^= 1;
      expect((await secure('', { wire: bad, nonce: sealed.nonce })).outer.status).toBe(400);

      // Repetición del mismo sobre.
      const once = await web.sealRequest(keys, ID, { m: 'GET', p: '/api/hello', h: {}, t: Date.now() }, new Uint8Array(0));
      expect((await secure('', { wire: once.wire, nonce: once.nonce })).status).toBe(200);
      expect((await secure('', { wire: once.wire, nonce: once.nonce })).outer.status).toBe(409);

      // Clave errónea (otro celular sin vincular).
      expect((await secure('/api/hello', { key: generateE2eKey() })).outer.status).toBe(400);

      // Marca de tiempo fuera de la ventana.
      expect((await secure('/api/hello', { t: Date.now() - 10 * 60_000 })).outer.status).toBe(409);

      // Ruta o método fuera de la API: 403 (cifrado).
      const out = await secure('/healthz');
      expect(out.status).toBe(403);
      expect((await secure('/api/hello', { method: 'TRACE' })).status).toBe(403);
    } finally {
      c.stop();
    }
  });

  it('secreto incorrecto: rechazado y sin reintentos; desconexión -> 503', async () => {
    const good = newClient(ID, SECRET);
    good.start();
    await until(() => good.state === 'conectado');
    const bad = newClient(ID, 'x'.repeat(43));
    bad.start();
    await until(() => bad.state === 'rechazado');
    bad.stop();
    expect(relay.tunnels.get(ID)).toBeDefined();
    good.stop();
    await until(() => !relay.tunnels.has(ID));
    expect((await secure('/api/hello')).outer.status).toBe(503);
  });

  it('token de registro: sin él no se registra un deviceId nuevo; uno ya registrado reconecta sin él', async () => {
    const id2 = 'e2eDevice2xxxxxxxxxxxxx';
    const sin = newClient(id2, SECRET, apiPort, { registrationToken: undefined });
    sin.start();
    await until(() => sin.state === 'rechazado');
    sin.stop();
    expect(relay.registry.verify(id2, SECRET)).toBe('new');

    const mal = newClient(id2, SECRET, apiPort, { registrationToken: 'otro' });
    mal.start();
    await until(() => mal.state === 'rechazado');
    mal.stop();

    const con = newClient(id2, SECRET);
    con.start();
    await until(() => con.state === 'conectado');
    con.stop();
    await until(() => !relay.tunnels.has(id2));
    expect(relay.registry.verify(id2, SECRET)).toBe('ok');
    const sinDespues = newClient(id2, SECRET, apiPort, { registrationToken: undefined });
    sinDespues.start();
    await until(() => sinDespues.state === 'conectado');
    sinDespues.stop();
  });

  it('el cliente reconecta solo si el relay corta el túnel', async () => {
    const c = newClient(ID, SECRET);
    c.start();
    try {
      await until(() => c.state === 'conectado');
      relay.tunnels.get(ID)!.close(1011, 'prueba');
      await until(() => c.state !== 'conectado');
      await until(() => c.state === 'conectado');
      expect((await secure('/api/hello')).status).toBe(200);
    } finally {
      c.stop();
    }
  });

  it('API local caída: 503 desde el cliente', async () => {
    let port: number | null = null;
    const c = new RelayClient({ relayUrl, deviceId: ID, secret: SECRET, e2eKey: KEY, registrationToken: REG, getPort: () => port, backoff: { minMs: 50, maxMs: 200 } });
    c.start();
    try {
      await until(() => c.state === 'conectado');
      expect((await secure('/api/hello')).outer.status).toBe(503);
      port = apiPort;
      expect((await secure('/api/hello')).status).toBe(200);
    } finally {
      c.stop();
    }
  });

  it('manager: QR con clave en el #, desvincular rota todo y el QR viejo deja de servir', async () => {
    const secrets = generateSecrets();
    let saves = 0;
    const m = new RelayManager({ relayUrl, secrets, registrationToken: REG, persist: () => saves++, backoff: { minMs: 50, maxMs: 200 } });
    m.setPort(apiPort);
    expect(m.status()).toMatchObject({ configurado: true, activo: false });
    const st = m.enable();
    const first = { ...secrets.relay! };
    expect(st.url).toBe(`${relayUrl}/d/${first.deviceId}`);
    expect(st.urlQr).toBe(`${relayUrl}/d/${first.deviceId}#k=${first.e2eKey}`);
    expect(st.url).not.toContain(first.e2eKey);
    await until(() => m.status().estado === 'conectado');
    const keys = await web.deriveKeys(first.e2eKey);
    const ask = async (id: string, k: typeof keys) => {
      const s = await web.sealRequest(k, id, { m: 'GET', p: '/api/hello', h: {}, t: Date.now() }, new Uint8Array(0));
      return call(`/d/${id}/e`, { method: 'POST', headers: { 'content-length': String(s.wire.length) }, body: Buffer.from(s.wire) });
    };
    expect((await ask(first.deviceId, keys)).status).toBe(200);
    expect(relay.registry.verify(first.deviceId, first.secret)).toBe('ok');

    const after = await m.disable();
    expect(after).toMatchObject({ activo: false, estado: 'desconectado' });
    expect(secrets.relay).toBeUndefined();
    expect(saves).toBe(2);
    expect(relay.registry.verify(first.deviceId, first.secret)).toBe('bad'); // revocado: no se puede re-registrar
    expect((await ask(first.deviceId, keys)).status).toBe(503);

    // Reactivar: identidad y clave NUEVAS; el QR viejo no abre nada.
    m.enable();
    const second = secrets.relay!;
    expect(second.deviceId).not.toBe(first.deviceId);
    expect(second.e2eKey).not.toBe(first.e2eKey);
    expect(second.secret).not.toBe(first.secret);
    await until(() => m.status().estado === 'conectado');
    expect((await ask(second.deviceId, keys)).status).toBe(400); // clave vieja con deviceId nuevo
    expect((await ask(second.deviceId, await web.deriveKeys(second.e2eKey))).status).toBe(200);
    await m.disable();
  });

  it('manager: identidad sin clave E2E (fase 1) se reemplaza al reanudar', () => {
    const secrets = generateSecrets();
    secrets.relay = { deviceId: 'old'.padEnd(22, 'x'), secret: 's'.repeat(43), enabled: true } as never;
    const m = new RelayManager({ relayUrl, secrets, persist: () => {}, backoff: { minMs: 50, maxMs: 200 } });
    m.resume();
    expect(secrets.relay!.e2eKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.relay!.deviceId).not.toContain('oldxx');
    m.stop();
  });

  it('manager sin dirección de relay: no configurado y no activa', () => {
    const m = new RelayManager({ relayUrl: '', secrets: generateSecrets(), persist: () => {} });
    expect(m.status().configurado).toBe(false);
    expect(() => m.enable()).toThrow(/dirección/);
  });
});
