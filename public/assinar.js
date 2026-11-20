// Página pública de cadastro e acesso do Agente de Tráfego (SaaS).
// Fala só com /api/saas/publico, /api/saas/cadastro, /api/login e /api/sessao. Depois de entrar, vai para /assinante.
const $ = (s) => document.querySelector(s);
const DESTINO = '/assinante';

function modo(m, foco = true) {
  const criar = m !== 'entrar';
  $('#fCadastro').classList.toggle('hidden', !criar);
  $('#fLogin').classList.toggle('hidden', criar);
  $('#abaCriar').setAttribute('aria-selected', String(criar));
  $('#abaEntrar').setAttribute('aria-selected', String(!criar));
  $('#abaCriar').tabIndex = criar ? 0 : -1;
  $('#abaEntrar').tabIndex = criar ? -1 : 0;
  history.replaceState(null, '', criar ? '/assinar' : '/assinar?modo=entrar');
  if (foco) ($(criar ? '#cNome' : '#lEmail')).focus();
}

async function chamar(caminho, corpo) {
  const r = await fetch(caminho, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.erro || `Erro ${r.status}. Tente de novo.`), { status: r.status });
  return d;
}

function ocupado(form, sim) {
  const b = form.querySelector('.botao');
  b.disabled = sim;
  b.firstElementChild.dataset.t ??= b.firstElementChild.textContent;
  b.firstElementChild.textContent = sim ? 'Aguarde…' : b.firstElementChild.dataset.t;
}

function marcarInvalidos(form, ids) {
  form.querySelectorAll('input').forEach((i) => i.removeAttribute('aria-invalid'));
  ids.forEach((id) => $('#' + id)?.setAttribute('aria-invalid', 'true'));
}

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

$('#abaCriar').addEventListener('click', () => modo('criar'));
$('#abaEntrar').addEventListener('click', () => modo('entrar'));
document.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => modo(b.dataset.ir)));
document.querySelector('.abas').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const entrar = $('#abaCriar').getAttribute('aria-selected') === 'true'; modo(entrar ? 'entrar' : 'criar'); }
});
document.querySelectorAll('.olho').forEach((b) => b.addEventListener('click', () => {
  const i = $('#' + b.dataset.alvo); const mostrar = i.type === 'password';
  i.type = mostrar ? 'text' : 'password';
  b.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  b.setAttribute('aria-pressed', String(mostrar));
  b.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
}));

$('#fCadastro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget; const erro = $('#cErro'); erro.textContent = '';
  const nome = $('#cNome').value.trim(); const email = $('#cEmail').value.trim(); const senha = $('#cSenha').value;
  const ruins = [];
  if (!nome) ruins.push('cNome');
  if (!emailOk(email)) ruins.push('cEmail');
  if (senha.length < 8) ruins.push('cSenha');
  marcarInvalidos(f, ruins);
  if (ruins.length) {
    erro.textContent = ruins[0] === 'cNome' ? 'Informe o seu nome.' : ruins[0] === 'cEmail' ? 'Confira o e-mail.' : 'A senha precisa ter pelo menos 8 caracteres.';
    $('#' + ruins[0]).focus(); return;
  }
  if (!$('#cAceite').checked) { erro.textContent = 'Para criar a conta é preciso aceitar os termos de uso.'; $('#cAceite').focus(); return; }
  ocupado(f, true);
  try {
    await chamar('/api/saas/cadastro', { nome, empresa: $('#cEmpresa').value.trim(), email, senha, aceite: true });
    location.href = DESTINO;
  } catch (er) {
    erro.textContent = er.message; ocupado(f, false);
    if (er.status === 409) { $('#lEmail').value = email; }
  }
});

$('#fLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget; const erro = $('#lErro'); erro.textContent = '';
  const email = $('#lEmail').value.trim(); const senha = $('#lSenha').value;
  if (!emailOk(email) || !senha) { erro.textContent = 'Informe o e-mail e a senha.'; marcarInvalidos(f, [!emailOk(email) ? 'lEmail' : 'lSenha']); return; }
  marcarInvalidos(f, []);
  ocupado(f, true);
  try {
    const r = await chamar('/api/login', { email, senha });
    location.href = r.usuario.papel === 'assinante' ? DESTINO : '/';
  } catch (er) { erro.textContent = er.message; ocupado(f, false); }
});

(async () => {
  modo(new URLSearchParams(location.search).get('modo') === 'entrar' ? 'entrar' : 'criar', false);
  // Preço, dias de teste e termos vêm do servidor (variáveis SAAS_PRECO_TEXTO, SAAS_TRIAL_DIAS, SAAS_TERMOS_URL)
  try {
    const p = await fetch('/api/saas/publico').then((r) => r.json());
    if (p.preco) { $('#preco').textContent = p.preco; $('#preco').classList.remove('hidden'); }
    if (p.trial_dias) { $('#teste').textContent = `${p.trial_dias} dias para testar, sem cartão`; $('#teste').classList.remove('hidden'); }
    if (p.termos_url) $('#termos').href = p.termos_url; else $('#termos').replaceWith(document.createTextNode('termos de uso'));
  } catch { $('#termos').replaceWith(document.createTextNode('termos de uso')); }
  // Quem já está logado vai direto para a área certa
  try {
    const s = await fetch('/api/sessao').then((r) => r.json());
    if (s.autenticado && s.usuario.papel === 'assinante') location.replace(DESTINO);
  } catch { /* segue na página */ }
})();
