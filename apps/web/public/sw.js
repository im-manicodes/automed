// Service worker mínimo: solo hace instalable la app. NO cachea nada ni toca /api
// (contenido sensible: siempre se pide a la red).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
