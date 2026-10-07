// auto-med: arranque verificado (v1). Archivo ESTABLE y pequeño: lo único de código que sirve el relay.
// Su hash se publica en docs/relay-e2e.md y lo comprueba un test. Sin dependencias ni build.
//
// Qué hace: pide el front de auto-med a TU computadora por el canal cifrado de extremo a extremo
// (clave K del #k= del QR, que nunca llega al relay), comprueba el manifiesto y el hash de cada archivo,
// los guarda en la caché del navegador y SOLO entonces los ejecuta (los sirve el service worker bajo
// <base>/_app/). Si algo no cuadra, no ejecuta nada y avisa. Formato del sobre: idéntico a
// apps/web/src/lib/e2e.ts y apps/desktop/src/e2e-crypto.ts (lo prueban los tests de interoperabilidad).

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = 'automed-e2e-v1';
const NONCE = 12;
const TAG = 16;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export class FrontError extends Error {
  /** code: sin_clave | navegador | apagada | red | reloj | autenticacion | manifiesto | archivo | version */
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export const MENSAJES = {
  sin_clave: ['Este celular no está vinculado', 'Escanea el código QR de tu computadora otra vez.'],
  navegador: ['Este navegador no puede abrir auto-med de forma segura', 'Prueba con Chrome o Safari actualizados.'],
  apagada: ['Tu computadora está apagada o sin internet', 'Enciéndela, abre auto-med y vuelve a intentar.'],
  red: ['No hay conexión', 'Revisa tu internet y vuelve a intentar.'],
  reloj: ['Revisa la fecha y hora de tu celular', 'Si están mal, la conexión segura no puede comprobarse.'],
  autenticacion: ['No se pudo comprobar que la app es la tuya', 'Por seguridad no se abrió. Escanea el código QR de tu computadora otra vez. Si sigue igual, no uses este enlace.'],
  manifiesto: ['No se pudo comprobar que la app es la tuya', 'Por seguridad no se abrió. Escanea el código QR de tu computadora otra vez. Si sigue igual, no uses este enlace.'],
  archivo: ['No se pudo comprobar que la app es la tuya', 'Por seguridad no se abrió. Escanea el código QR de tu computadora otra vez. Si sigue igual, no uses este enlace.'],
  version: ['La app que llegó es más antigua que la que ya tenías', 'Por seguridad no se abrió. Actualiza auto-med en tu computadora o escanea el código QR otra vez.'],
};

// ---------- cifrado (WebCrypto) ----------
const buf = (u) => u;
const concat = (...p) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) (out.set(x, o), (o += x.length));
  return out;
};

export function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export const isValidKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k);

export async function deriveKeys(keyB64u) {
  if (!isValidKey(keyB64u)) throw new FrontError('sin_clave');
  const ikm = await crypto.subtle.importKey('raw', buf(b64urlToBytes(keyB64u)), 'HKDF', false, ['deriveKey']);
  const derive = (info, usage) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) }, ikm, { name: 'AES-GCM', length: 256 }, false, [usage]);
  return { c2d: await derive('c2d', 'encrypt'), d2c: await derive('d2c', 'decrypt') };
}

export async function sealRequest(keys, deviceId, head, body = new Uint8Array(0)) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE));
  const h = enc.encode(JSON.stringify(head));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, h.length);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(`am-e2e1|req|${deviceId}`), tagLength: TAG * 8 }, keys.c2d, concat(len, h, body)),
  );
  return { wire: concat(new Uint8Array([1]), nonce, ct), nonce };
}

/** Abre la respuesta de SU petición; si no autentica (clave errónea, manipulada, de otra petición) lanza 'autenticacion'. */
export async function openResponse(keys, deviceId, reqNonce, wire) {
  if (wire.length < 1 + NONCE + TAG || wire[0] !== 1) throw new FrontError('autenticacion');
  let plain;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: wire.subarray(1, 1 + NONCE), additionalData: concat(enc.encode(`am-e2e1|res|${deviceId}|`), reqNonce), tagLength: TAG * 8 },
        keys.d2c,
        wire.subarray(1 + NONCE),
      ),
    );
  } catch {
    throw new FrontError('autenticacion');
  }
  if (plain.length < 4) throw new FrontError('autenticacion');
  const n = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
  if (4 + n > plain.length) throw new FrontError('autenticacion');
  let head;
  try {
    head = JSON.parse(dec.decode(plain.subarray(4, 4 + n)));
  } catch {
    throw new FrontError('autenticacion');
  }
  if (!head || !Number.isInteger(head.s)) throw new FrontError('autenticacion');
  return { status: head.s, headers: head.h || {}, body: plain.subarray(4 + n) };
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf(bytes)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- petición cifrada al escritorio ----------
/** ctx = { base:'/d/<id>', deviceId, keys, fetch, now() } */
export async function fetchSealed(ctx, path) {
  const { wire, nonce } = await sealRequest(ctx.keys, ctx.deviceId, { m: 'GET', p: path, h: {}, t: ctx.now() });
  let outer;
  try {
    outer = await ctx.fetch(`${ctx.base}/e`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: wire, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new FrontError('red');
  }
  if (!outer.ok) {
    if ([502, 503, 504].includes(outer.status)) throw new FrontError('apagada');
    if (outer.status === 409) throw new FrontError('reloj');
    if (outer.status === 400) throw new FrontError('autenticacion');
    throw new FrontError('red');
  }
  const opened = await openResponse(ctx.keys, ctx.deviceId, nonce, new Uint8Array(await outer.arrayBuffer()));
  return opened;
}

// ---------- verificación del manifiesto ----------
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9._\-/]{0,200}$/;
const TYPE_RE = /^[\w.+-]+\/[\w.+-]+(; charset=[\w-]+)?$/;
const isPath = (p) => typeof p === 'string' && PATH_RE.test(p) && !p.split('/').some((s) => s === '' || s === '.' || s === '..');

/**
 * Valida el manifiesto (ya autenticado por el cifrado) y lo compara con el piso de versión guardado
 * (`floor` = {builtAt, mh}): una versión más vieja, o la misma fecha con otro contenido, se rechaza.
 * Devuelve { manifest, mh } con mh = sha256 de los bytes exactos del manifiesto.
 */
export async function verifyManifest(raw, { deviceId, floor }) {
  let m;
  try {
    m = JSON.parse(dec.decode(raw));
  } catch {
    throw new FrontError('manifiesto');
  }
  const bad = () => new FrontError('manifiesto');
  if (!m || m.v !== 1 || m.d !== deviceId || typeof m.version !== 'string' || !Number.isSafeInteger(m.builtAt) || m.builtAt < 0) throw bad();
  if (!m.files || typeof m.files !== 'object' || !m.entry || !Array.isArray(m.entry.scripts) || !Array.isArray(m.entry.styles)) throw bad();
  const paths = Object.keys(m.files);
  if (paths.length === 0 || paths.length > MAX_FILES) throw bad();
  for (const p of paths) {
    const f = m.files[p];
    if (!isPath(p) || !f || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES || typeof f.type !== 'string' || !TYPE_RE.test(f.type)) throw bad();
  }
  if (m.entry.scripts.length === 0) throw bad();
  for (const p of [...m.entry.scripts, ...m.entry.styles]) if (!Object.hasOwn(m.files, p)) throw bad();
  const mh = await sha256Hex(raw);
  if (floor && (m.builtAt < floor.builtAt || (m.builtAt === floor.builtAt && mh !== floor.mh))) throw new FrontError('version');
  return { manifest: m, mh };
}

// ---------- sincronización: manifiesto -> archivos -> verificación -> almacén ----------
/**
 * store = { floor(), current() -> {mh, manifest}|null, read(path) -> bytes|null (del front actual), commit({manifest, mh, files:Map, reuse:[paths]}) }
 * Si no hay conexión con la computadora y ya hay un front verificado, se usa ese.
 */
export async function syncFront(ctx, store) {
  const cur = await store.current();
  let raw;
  try {
    raw = (await fetchSealed(ctx, '/_front/manifest')).body;
  } catch (e) {
    if (cur && e instanceof FrontError && (e.code === 'apagada' || e.code === 'red')) return { source: 'cache', manifest: cur.manifest };
    throw e;
  }
  const { manifest, mh } = await verifyManifest(raw, { deviceId: ctx.deviceId, floor: await store.floor() });
  if (cur && cur.mh === mh) return { source: 'cache', manifest: cur.manifest };
  const files = new Map();
  const reuse = [];
  for (const [path, meta] of Object.entries(manifest.files)) {
    const old = cur?.manifest.files[path];
    if (old && old.sha256 === meta.sha256 && old.size === meta.size && old.type === meta.type) {
      reuse.push(path);
      continue;
    }
    const r = await fetchSealed(ctx, `/_front/f/${path}`);
    if (r.status !== 200) throw new FrontError('archivo');
    if (r.body.length !== meta.size || (await sha256Hex(r.body)) !== meta.sha256) throw new FrontError('archivo');
    files.set(path, r.body);
  }
  await store.commit({ manifest, mh, files, reuse });
  return { source: 'red', manifest };
}

// ---------- almacén del navegador: Cache API + localStorage ----------
const PTR = 'am-front-ptr';
const metaUrl = (base) => `${base}/_meta/manifest`;

export function browserStore(base, deviceId, env = globalThis) {
  const ls = (fn) => {
    try {
      return fn(env.localStorage);
    } catch {
      return null;
    }
  };
  const floorKey = `am_front_floor_${deviceId}`;
  const ptrUrl = `${base}/ptr`;
  const currentName = async () => {
    const r = await (await env.caches.open(PTR)).match(ptrUrl);
    return r ? r.text() : null;
  };
  return {
    floor: () => {
      const v = ls((s) => s.getItem(floorKey));
      try {
        const f = v && JSON.parse(v);
        return f && Number.isSafeInteger(f.builtAt) && typeof f.mh === 'string' ? f : null;
      } catch {
        return null;
      }
    },
    async current() {
      const name = await currentName();
      if (!name) return null;
      const meta = await (await env.caches.open(name)).match(metaUrl(base));
      if (!meta) return null;
      try {
        const { manifest, mh } = JSON.parse(await meta.text());
        return { manifest, mh };
      } catch {
        return null;
      }
    },
    async commit({ manifest, mh, files, reuse }) {
      const name = `am-front-${deviceId}-${mh.slice(0, 16)}`;
      const old = await currentName();
      const oldCache = old ? await env.caches.open(old) : null;
      const next = await env.caches.open(name);
      const put = (path, bytes) => next.put(`${base}/_app/${path}`, new Response(bytes, { headers: { 'Content-Type': manifest.files[path].type } }));
      for (const [p, b] of files) await put(p, b);
      for (const p of reuse) {
        const hit = oldCache && (await oldCache.match(`${base}/_app/${p}`));
        if (!hit) throw new FrontError('archivo');
        await put(p, new Uint8Array(await hit.arrayBuffer()));
      }
      await next.put(metaUrl(base), new Response(JSON.stringify({ manifest, mh })));
      // Cambio de versión: primero el puntero, luego el piso y por último se borra lo viejo.
      await (await env.caches.open(PTR)).put(ptrUrl, new Response(name));
      ls((s) => s.setItem(floorKey, JSON.stringify({ builtAt: manifest.builtAt, mh })));
      for (const k of await env.caches.keys()) if (k.startsWith(`am-front-${deviceId}-`) && k !== name) await env.caches.delete(k);
    },
    /** Una clave nueva (otro QR) invalida lo anterior, incluido el piso de versión. */
    async reset() {
      ls((s) => s.removeItem(floorKey));
      for (const k of await env.caches.keys()) if (k.startsWith(`am-front-${deviceId}-`)) await env.caches.delete(k);
      await (await env.caches.open(PTR)).delete(ptrUrl);
    },
  };
}

// ---------- navegador ----------
export function detectBase(pathname) {
  const m = /^\/d\/([A-Za-z0-9_-]{1,64})\//.exec(pathname);
  return m ? `/d/${m[1]}` : '';
}

function show(root, code, onRetry) {
  const [title, text] = MENSAJES[code] || MENSAJES.red;
  root.textContent = '';
  const box = document.createElement('div');
  box.className = 'am-boot';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = title;
  h.style.fontSize = '1.25rem';
  const p = document.createElement('p');
  p.textContent = text;
  box.append(h, p);
  if (onRetry) {
    const b = document.createElement('button');
    b.textContent = 'Reintentar';
    b.onclick = onRetry;
    box.append(b);
  }
  root.append(box);
}

async function controlled(timeoutMs = 5000) {
  const sw = navigator.serviceWorker;
  await sw.ready;
  if (sw.controller) return;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new FrontError('navegador')), timeoutMs);
    sw.addEventListener('controllerchange', () => (clearTimeout(t), resolve()), { once: true });
  });
}

export async function run(env = globalThis) {
  const root = document.getElementById('root');
  const base = detectBase(location.pathname);
  const retry = () => location.reload();
  try {
    if (!base) throw new FrontError('sin_clave');
    const deviceId = base.slice(3);
    if (!env.crypto?.subtle || !env.caches || !('serviceWorker' in navigator)) throw new FrontError('navegador');
    const store = browserStore(base, deviceId, env);
    const keyName = `am_e2e_${deviceId}`;
    // La clave llega en el # del QR (nunca al relay): se guarda y se quita de la barra.
    const hit = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
    if (hit) {
      let previous = null;
      try {
        previous = localStorage.getItem(keyName);
        localStorage.setItem(keyName, hit[1]);
      } catch {
        /* sin almacenamiento: no se puede vincular */
      }
      if (previous !== hit[1]) await store.reset();
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    let key = null;
    try {
      key = localStorage.getItem(keyName);
    } catch {
      /* nada */
    }
    const keys = await deriveKeys(key);
    await navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` });
    await controlled();
    const ctx = { base, deviceId, keys, fetch: env.fetch.bind(env), now: () => Date.now() };
    const { manifest } = await syncFront(ctx, store);
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.append(el);
      return el;
    };
    add('link', { rel: 'manifest', href: `${base}/manifest.webmanifest` });
    for (const p of manifest.entry.styles) add('link', { rel: 'stylesheet', href: `${base}/_app/${p}` });
    root.textContent = '';
    for (const p of manifest.entry.scripts) add('script', { type: 'module', src: `${base}/_app/${p}` });
  } catch (e) {
    const code = e instanceof FrontError ? e.code : 'red';
    show(root, code, ['apagada', 'red', 'reloj'].includes(code) ? retry : undefined);
  }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined' && !globalThis.__AUTOMED_NO_AUTORUN__) void run();
