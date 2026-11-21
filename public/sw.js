// Service worker da MidIAut: guarda o visual do app para abrir rápido e mostra uma tela amigável sem internet.
// Nunca guarda dados da conta: tudo em /api passa direto pela rede.
const VERSAO = 'midiaut-v5';
const BASICO = ['/offline.html', '/brand/midiaut/icone-192.png', '/brand/midiaut/favicon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') { // páginas: sempre da rede. Se o servidor estiver acordando (plano grátis), tenta de novo antes de desistir
    e.respondWith(paginaComRetentativa(req));
    return;
  }
  if (/\.(svg|png|jpg|jpeg|webp|woff2?)$/.test(url.pathname)) { // imagens: do cache na hora, atualizando em segundo plano
    e.respondWith(caches.open(VERSAO).then((ch) => ch.match(req).then((hit) => {
      const rede = fetch(req).then((r) => { if (r.ok) ch.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || rede;
    })));
    return;
  }
  if (/\.(css|js)$/.test(url.pathname)) { // arquivos estáticos: rede primeiro, cache de reserva
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSAO).then((ch) => ch.put(req, c)); } return r; }).catch(() => caches.match(req)));
  }
});

// Servidor que dormiu leva até ~1 minuto para voltar: falha de rede ou 502/503/504 não vira "sem internet" na primeira tentativa.
async function paginaComRetentativa(req) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(req);
      if (![502, 503, 504].includes(r.status)) return r;
    } catch (_) { /* tenta de novo */ }
    await espera(2500 + i * 500);
  }
  return caches.match('/offline.html');
}
