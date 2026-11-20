// MidIAut como app: registra o service worker e cuida do botão "Instalar app" (qualquer elemento com data-instalar).
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let adiado = null;
  window.pwa = { instalado: () => standalone };
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); adiado = e; });
  addEventListener('appinstalled', () => { adiado = null; document.querySelectorAll('[data-instalar]').forEach((b) => b.remove()); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-instalar]'); if (!b) return;
    if (adiado) { adiado.prompt(); await adiado.userChoice.catch(() => {}); adiado = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(ios
      ? 'No iPhone ou iPad: toque no botão Compartilhar do Safari e escolha "Adicionar à Tela de Início".'
      : 'Para instalar: abra o menu do navegador (⋮) e escolha "Instalar app" ou "Adicionar à tela inicial". Se a opção não aparecer, abra este endereço no Chrome ou no Edge.');
  });
})();
