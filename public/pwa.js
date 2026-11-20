// MidIAut como app: registra o service worker, atualiza sozinho e cuida do botão "Baixar app" (qualquer elemento com data-instalar).
(() => {
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const emApp = /FBAN|FBAV|Instagram|Line\/|TikTok|MicroMessenger|; wv\)/i.test(ua); // navegadores embutidos de redes sociais
  let adiado = null;
  window.pwa = { instalado: () => standalone };

  // ---- Atualização automática: o app sempre abre a versão mais nova e recarrega uma vez quando o service worker novo assume ----
  if ('serviceWorker' in navigator) {
    const tinha = !!navigator.serviceWorker.controller; let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !recarregou) { recarregou = true; location.reload(); } });
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then((reg) => {
      const checar = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checar(); });
      setInterval(checar, 60 * 60 * 1000);
    }).catch(() => {}));
  }

  // ---- Botão "Baixar app" ----
  if (standalone) document.querySelectorAll('[data-instalar]').forEach((b) => { b.hidden = true; });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); adiado = e; });
  addEventListener('appinstalled', () => { adiado = null; document.querySelectorAll('[data-instalar]').forEach((b) => { b.hidden = true; }); });

  function guia() {
    if (document.getElementById('pwaGuia')) return;
    let titulo, passos;
    if (emApp) {
      titulo = 'Abra no navegador para instalar';
      passos = ['Toque nos três pontinhos (⋯ ou ⋮) deste navegador.', ios ? 'Escolha "Abrir no Safari".' : 'Escolha "Abrir no Chrome" (ou "Abrir no navegador").', 'Na nova janela, toque em "Baixar app" de novo.'];
    } else if (ios) {
      titulo = 'Instalar no iPhone ou iPad';
      passos = ['Toque no botão <b>Compartilhar</b> (o quadrado com uma seta para cima) na barra do navegador.', 'Role a lista e toque em <b>Adicionar à Tela de Início</b>.', 'Toque em <b>Adicionar</b>. O ícone da MidIAut aparece na sua tela inicial.'];
    } else if (android) {
      titulo = 'Instalar no Android';
      passos = ['Toque nos três pontinhos (⋮) do Chrome.', 'Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).', 'Confirme. O ícone da MidIAut aparece na sua tela inicial.'];
    } else {
      titulo = 'Instalar no computador';
      passos = ['No Chrome ou no Edge, clique no ícone de instalar (um monitor com seta) no fim da barra de endereço.', 'Ou abra o menu (⋮) e escolha <b>Instalar MidIAut</b>.', 'Confirme. O app abre em janela própria.'];
    }
    const d = document.createElement('div'); d.id = 'pwaGuia'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', titulo);
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:grid;place-items:center;padding:16px;font-family:Manrope,system-ui,sans-serif';
    d.innerHTML = `<div style="background:#1E2126;color:#F2F4F7;border:1px solid #3A3F47;border-radius:16px;max-width:420px;width:100%;padding:22px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><img src="/brand/midiaut/icone-192.png" alt="" width="48" height="48" style="border-radius:12px"><h2 style="margin:0;font-size:18px">${titulo}</h2></div>
      <ol style="margin:0 0 14px;padding-left:20px;line-height:1.55;color:#D5D9E0">${passos.map((p) => `<li style="margin-bottom:8px">${p}</li>`).join('')}</ol>
      <p style="margin:0 0 16px;font-size:13px;color:#9AA1AD">O app se atualiza sozinho: você sempre abre a versão mais nova, sem baixar nada de novo.</p>
      <button type="button" id="pwaOk" style="width:100%;background:#B6FF45;color:#17191D;border:0;border-radius:10px;padding:12px;font:800 15px Manrope,system-ui,sans-serif;cursor:pointer">Entendi</button></div>`;
    document.body.appendChild(d);
    const fechar = () => { d.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', esc);
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    d.querySelector('#pwaOk').addEventListener('click', fechar); d.querySelector('#pwaOk').focus();
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-instalar]'); if (!b) return;
    e.preventDefault();
    if (adiado) { adiado.prompt(); await adiado.userChoice.catch(() => {}); adiado = null; return; }
    guia();
  });
})();
