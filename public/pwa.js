// MidIAut: registra o service worker (página offline amigável e cache) e atualiza sozinho para a versão mais nova.
(() => {
  if (!('serviceWorker' in navigator)) return;
  const tinha = !!navigator.serviceWorker.controller; let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !recarregou) { recarregou = true; location.reload(); } });
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then((reg) => {
    const checar = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checar(); });
    setInterval(checar, 60 * 60 * 1000);
  }).catch(() => {}));
})();
