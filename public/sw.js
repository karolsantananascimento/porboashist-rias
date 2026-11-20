// Service worker da MidIAut: guarda o visual do app para abrir rápido e mostra uma tela amigável sem internet.
// Nunca guarda dados da conta: tudo em /api passa direto pela rede.
const VERSAO = 'midiaut-v2';
const BASICO = ['/offline.html', '/brand/midiaut/icone-192.png', '/brand/midiaut/favicon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') { // páginas: sempre da rede; sem internet, tela de aviso
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (/\.(css|js|svg|png|jpg|jpeg|webp|woff2?)$/.test(url.pathname)) { // arquivos estáticos: rede primeiro, cache de reserva
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSAO).then((ch) => ch.put(req, c)); } return r; }).catch(() => caches.match(req)));
  }
});
