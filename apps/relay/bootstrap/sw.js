// auto-med: service worker del arranque (v1). Fija el arranque y sirve el front YA VERIFICADO.
// Solo responde a: la página de arranque, /boot.js y <alcance>_app/*. Nada más: no toca POST /e ni
// ninguna otra petición, y NUNCA guarda respuestas de la API ni datos. Diseño: docs/relay-e2e.md.
const BOOT = 'am-boot-v1';
const PTR = 'am-front-ptr';
const scope = new URL(self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const [page, boot] = await Promise.all([fetch(scope, { cache: 'reload' }), fetch('/boot.js', { cache: 'reload' })]);
      if (!page.ok || !boot.ok) throw new Error('arranque no disponible');
      const c = await caches.open(BOOT);
      await c.put(scope, page);
      await c.put('/boot.js', boot);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('am-boot-') && k !== BOOT) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function front(url) {
  try {
    const ptr = await (await caches.open(PTR)).match(scope + 'ptr');
    const name = ptr && (await ptr.text());
    if (name) {
      const hit = await (await caches.open(name)).match(url, { ignoreSearch: true });
      if (hit) return hit;
    }
  } catch {
    /* sin front verificado */
  }
  return new Response('No disponible', { status: 404 });
}

async function pinned(key, request) {
  const hit = await (await caches.open(BOOT)).match(key);
  return hit || fetch(request);
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith(scope + '_app/')) return e.respondWith(front(u.href));
  if (u.pathname === '/boot.js') return e.respondWith(pinned('/boot.js', r));
  if (r.mode === 'navigate' && u.pathname.startsWith(scope)) {
    const rest = u.pathname.slice(scope.length);
    if (rest === 'sw.js' || rest === 'manifest.webmanifest' || rest.startsWith('api')) return;
    return e.respondWith(pinned(scope, r));
  }
});
