// Service worker HADIRIN: aset statis berversi (libs, ikon, CDN dengan versi terkunci) diambil dari cache = buka app lebih cepat.
// Halaman, JS/CSS aplikasi: jaringan dulu (selalu versi terbaru), cache hanya cadangan saat offline. /api dan /config.js tidak pernah di-cache.
const V = 'hadirin-v4', STATIC = /^\/assets\/(libs|images)\//, CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^/@]+@\d/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname === '/config.js') return;
  const stat = (u.origin === location.origin && STATIC.test(u.pathname)) || CDN.test(r.url);
  if (!stat && u.origin !== location.origin) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(r);
    if (stat && hit) return hit;
    try { const n = await fetch(r, stat ? undefined : { cache: 'no-cache' }); if (n.ok && (stat || n.type === 'basic')) c.put(r, n.clone()); return n; }
    catch (err) { if (hit) return hit; throw err; }
  }));
});
