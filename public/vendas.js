// Site de vendas do Agente de Tráfego (/assinar e /gestoragent). Os botões são links para /cadastro e /entrar; aqui ficam só o preço, os termos e o vídeo.
const $ = (s) => document.querySelector(s);

(async () => {
  try {
    const p = await fetch('/api/saas/publico').then((r) => r.json());
    if (p.preco && $('#preco')) { $('#preco').textContent = p.preco; $('#preco').classList.remove('hidden'); $('#planoValor').textContent = p.preco; $('#planoValor').classList.remove('hidden'); }
    if (p.trial_dias && $('#teste')) { $('#teste').textContent = `${p.trial_dias} dias para testar, sem cartão`; $('#teste').classList.remove('hidden'); }
    if (p.termos_url && $('#rodTermos')) { const t = $('#rodTermos'); t.href = p.termos_url; t.classList.remove('hidden'); }
  } catch { /* a página funciona sem essas informações */ }
})();

const v = $('#demo');
const bs = [...document.querySelectorAll('.capitulos button')];
const ts = bs.map((b) => Number(b.dataset.t));
bs.forEach((b) => b.addEventListener('click', () => { v.currentTime = Number(b.dataset.t); v.play().catch(() => {}); }));
v.addEventListener('timeupdate', () => { let a = -1; ts.forEach((t, i) => { if (v.currentTime >= t) a = i; }); bs.forEach((b, i) => b.classList.toggle('on', i === a)); });
