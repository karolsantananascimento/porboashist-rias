// Gestor de Tráfego (SaaS): tela do assinante. Tudo passa por /api/saas/*; chaves nunca voltam inteiras do servidor.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raiz = $('#raiz');

const S = { eu: null, aba: 'inicio', pub: null, chaves: null, campanhas: [], testes: {}, aberta: null, cliente: null };
// Cliente selecionado (planos com vários clientes): lembrado neste navegador e enviado em todas as chamadas
try { S.cliente = localStorage.getItem('pbh_cliente') || null; } catch { /* sem armazenamento: usa o principal */ }
const lembrarCliente = (id) => { S.midias = null; S.criativosIA = []; S.cliente = id ? String(id) : null; try { if (id) localStorage.setItem('pbh_cliente', String(id)); else localStorage.removeItem('pbh_cliente'); } catch { /* ok */ } };

async function api(caminho, opts = {}) {
  const r = await fetch(caminho, {
    method: opts.method || 'GET', headers: { ...(opts.corpo ? { 'content-type': 'application/json' } : {}), ...(S.cliente ? { 'x-cliente': S.cliente } : {}) },
    body: opts.corpo ? JSON.stringify(opts.corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && !opts.semSair) { S.eu = null; entrada(); throw Object.assign(new Error('Sessão expirada. Entre de novo.'), { tratado: true }); }
  if (!r.ok) throw Object.assign(new Error(dados.erro || `Erro ${r.status}`), { status: r.status, codigo: dados.codigo, dados });
  return dados;
}
let tt;
function aviso(msg, ruim = false) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.style.background = ruim ? 'var(--danger)' : '';
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ruim ? 6000 : 3000);
}
const falha = (e) => { if (!e.tratado) aviso(e.message, true); if (e.status === 402) carregarEu().then(() => render()).catch(() => {}); };
const dataBr = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------- Entrada: a página /cadastro (e /entrar) cuida de criar conta e entrar ----------------
function entrada(modo = 'criar') { location.replace(modo === 'entrar' ? '/entrar' : '/cadastro'); }

// ---------------- Estrutura do app ----------------
async function carregarEu() {
  try { S.eu = await api('/api/saas/eu'); }
  catch (e) { if (e.status !== 404 || !S.cliente) throw e; lembrarCliente(null); S.eu = await api('/api/saas/eu'); } // cliente lembrado não existe mais: volta ao principal
  lembrarCliente(S.eu.cliente_atual);
}
const trocarCliente = (id) => { lembrarCliente(id); S.chaves = null; S.campanhas = []; S.testes = {}; S.aberta = null; carregarEu().then(() => render()).catch(falha); };

async function iniciar() {
  try { S.pub = await api('/api/saas/publico', { semSair: true }); } catch { S.pub = {}; }
  const s = await fetch('/api/sessao').then((r) => r.json()).catch(() => ({}));
  if (!s.autenticado) return entrada();
  if (s.usuario.papel !== 'assinante' && s.usuario.papel !== 'admin') { location.href = '/'; return; }
  // Administradora só entra aqui em modo suporte (botão "Entrar na conta" em Assinantes); sem isso, volta ao sistema
  try { await carregarEu(); } catch (e) { if (s.usuario.papel === 'admin') { location.href = '/'; return; } throw e; }
  const q = new URLSearchParams(location.search).get('assinatura');
  S.aba = abaDoEndereco() || S.aba;
  const av = new URLSearchParams(location.search).get('avulsas');
  if (av) { history.replaceState(null, '', '/assinante'); aviso(av === 'ok' ? 'Pagamento recebido! As campanhas avulsas aparecem em instantes.' : 'Compra não concluída.', av !== 'ok'); }
  if (q) { history.replaceState(null, '', '/assinante#assinatura'); aviso(q === 'ok' ? 'Pagamento recebido! Sua assinatura será ativada em instantes.' : 'Assinatura não concluída. Você pode tentar de novo quando quiser.', q !== 'ok'); S.aba = 'assinatura'; }
  const quer = new URLSearchParams(location.search).get('assinar') === '1';
  if (quer) { history.replaceState(null, '', '/assinante#assinatura'); S.aba = 'assinatura'; }
  render();
  // Veio do botão "Assinar agora" da página de vendas: segue direto para o pagamento seguro, se a conta ainda não tem assinatura
  if (quer && S.eu.cobranca && !S.eu.conta.tem_assinatura && S.eu.conta.situacao.codigo !== 'cortesia' && S.eu.conta.situacao.codigo !== 'bloqueada' && S.eu.conta.plano !== 'gratis') assinar();
}

const ABAS_BASE = [['inicio', 'Início'], ['campanhas', 'Campanhas'], ['chaves', 'Chaves de API'], ['assinatura', 'Assinatura']];
// Quem tem plano com mais de um cliente ganha a aba Clientes
const abas = () => (S.eu?.conta.clientes_max > 1 ? [ABAS_BASE[0], ['clientes', 'Clientes'], ...ABAS_BASE.slice(1)] : ABAS_BASE);
// A aba fica no endereço (/assinante#chaves): recarregar, voltar e compartilhar o link mantêm o lugar
const abaDoEndereco = () => { const h = location.hash.slice(1); return abas().some(([k]) => k === h) ? h : null; };
function irPara(aba) { S.aba = aba; if (location.hash.slice(1) !== aba) history.pushState(null, '', '/assinante#' + aba); render(); window.scrollTo(0, 0); }
window.addEventListener('popstate', () => { if (S.eu) { S.aba = abaDoEndereco() || 'inicio'; render(); } });

function render() {
  const c = S.eu.conta; const sit = c.situacao;
  const pill = sit.codigo === 'trial' ? `<span class="pill warn">Teste: ${sit.dias_trial} dia${sit.dias_trial > 1 ? 's' : ''}</span>`
    : sit.ativa ? `<span class="pill ok">${esc(sit.texto)}</span>` : `<span class="pill ruim">${esc(sit.codigo === 'bloqueada' ? 'Bloqueada' : 'Sem assinatura ativa')}</span>`;
  const faixaSuporte = S.eu.suporte ? `<div class="sa-suporte" role="status"><span><b>Modo suporte.</b> Você (${esc(S.eu.suporte.admin)}) está na conta de ${esc(c.email)}. Ativar campanhas, cobrança e exclusão ficam bloqueados. O que você mudar fica registrado.</span><button class="btn small" id="sairSuporte">Sair do modo suporte</button></div>` : '';
  raiz.innerHTML = `${faixaSuporte}
    <header class="sa-top">
      <a class="sa-brand" href="/assinante#inicio" aria-label="MidIAut, início"><img src="/brand/midiaut/simbolo.svg" alt="" width="34" height="30"><span class="sa-wm">Mid<i>IA</i>ut</span></a>
      <nav class="sa-nav" aria-label="Seções">${abas().map(([k, n]) => `<button data-aba="${k}" class="${S.aba === k ? 'on' : ''}" ${S.aba === k ? 'aria-current="page"' : ''}>${n}</button>`).join('')}</nav>
      <div class="sa-me">${seletorCliente()}${pill}<span>${esc(c.nome || c.email)}</span>${S.eu.suporte ? '' : '<button class="btn ghost small" id="sair">Sair</button>'}</div>
    </header>
    <main class="sa-main" id="conteudo"></main>`;
  raiz.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));
  const sel = $('#selCliente'); if (sel) sel.addEventListener('change', () => trocarCliente(sel.value));
  const ss = $('#sairSuporte'); if (ss) ss.addEventListener('click', async () => { try { await api('/api/saas/suporte/sair', { method: 'POST' }); location.href = '/'; } catch (e) { falha(e); } });
  const sair = $('#sair'); if (sair) sair.addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); S.eu = null; entrada('entrar'); });
  document.title = `${(abas().find(([k]) => k === S.aba) || ABAS_BASE[0])[1]} · MidIAut`;
  const v = $('#conteudo');
  v.setAttribute('aria-busy', 'true');
  v.innerHTML = '<p class="sa-carregando" role="status">Carregando…</p>';
  if (sit.codigo === 'trial' && sit.dias_trial <= 3) {
    v.insertAdjacentHTML('beforeend', `<div class="sa-banner"><span>Seu teste termina em ${sit.dias_trial} dia${sit.dias_trial > 1 ? 's' : ''}. Assine para não perder o acesso às campanhas.</span><button class="btn primary small" id="bAssinarT">Assinar agora</button></div>`);
    $('#bAssinarT').addEventListener('click', assinar);
  }
  if (!sit.ativa) {
    v.insertAdjacentHTML('beforeend', `<div class="sa-banner ${sit.codigo === 'bloqueada' ? 'erro-b' : ''}"><span>${esc(sit.texto)}</span>${sit.codigo !== 'bloqueada' ? '<button class="btn primary small" id="bAssinar">Assinar agora</button>' : ''}</div>`);
    const b = $('#bAssinar'); if (b) b.addEventListener('click', assinar);
  }
  // Cada tela monta o conteúdo num bloco à parte; o "Carregando…" some quando ela termina
  const aba = S.aba;
  const tela = document.createElement('div'); tela.style.display = 'contents'; v.append(tela); // as telas usam $('#id') no documento, então o bloco já entra na página
  ({ inicio: viewInicio, clientes: viewClientes, campanhas: viewCampanhas, chaves: viewChaves, assinatura: viewAssinatura })[aba](tela)
    .catch((e) => { falha(e); tela.innerHTML = '<div class="card"><p class="muted">Não consegui carregar esta tela. Tente de novo em instantes.</p><button class="btn" data-recarregar>Tentar de novo</button></div>'; })
    .finally(() => {
      if (!v.isConnected) return;
      v.querySelector('.sa-carregando')?.remove(); v.removeAttribute('aria-busy');
      tela.querySelectorAll('[data-recarregar]').forEach((b) => b.addEventListener('click', render));
    });
}

const secao = (v, html) => v.insertAdjacentHTML('beforeend', html);

// ---------------- Clientes (planos Agência e Escala) ----------------
function seletorCliente() {
  const cl = S.eu.clientes || [];
  if (cl.length < 2) return '';
  return `<label class="sa-cliente"><span class="sr-only">Cliente</span><select id="selCliente" aria-label="Cliente atual">${cl.map((k) => `<option value="${k.id}" ${k.id === S.eu.cliente_atual ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>`;
}
async function viewClientes(v) {
  const r = await api('/api/saas/clientes');
  const c = S.eu.conta;
  secao(v, `<div class="view-head"><div><h2>Clientes</h2><p>Cada cliente tem as próprias chaves de API e as próprias campanhas. Use o seletor no topo para trocar de cliente. Seu plano ${esc(c.plano_nome)} permite ${r.max} cliente${r.max > 1 ? 's' : ''} (${r.clientes.length} em uso).</p></div></div>
    <div class="card"><h3>Seus clientes</h3><ul class="sa-clientes">${r.clientes.map((k) => `<li>
      <div><b>${esc(k.nome)}</b> ${k.id === r.atual ? '<span class="pill ok">Em uso</span>' : ''} ${k.principal ? '<span class="pill">Principal</span>' : ''}</div>
      <div class="sa-acoes">${k.id === r.atual ? '' : `<button class="btn small" data-usar="${k.id}">Usar</button>`}<button class="btn small" data-renomear="${k.id}" data-nome="${esc(k.nome)}">Renomear</button>${k.principal ? '' : `<button class="btn small danger" data-excluir="${k.id}" data-nome="${esc(k.nome)}">Excluir</button>`}</div></li>`).join('')}</ul></div>
    <div class="card"><h3>Novo cliente</h3>${r.clientes.length >= r.max
      ? `<p class="muted">Você chegou ao limite do seu plano (${r.max}). Para gerenciar mais clientes, fale com o suporte e mude de plano.</p>`
      : `<form id="fCliente" class="sa-linha"><input id="nomeCliente" maxlength="120" placeholder="Nome do cliente, ex.: Clínica Bella" required aria-label="Nome do novo cliente"><button class="btn primary" type="submit">Adicionar cliente</button></form>
         <p class="muted">Depois de adicionar, troque para ele no seletor e cole as chaves dele em Chaves de API.</p>`}</div>`);
  v.querySelectorAll('[data-usar]').forEach((b) => b.addEventListener('click', () => trocarCliente(b.dataset.usar)));
  v.querySelectorAll('[data-renomear]').forEach((b) => b.addEventListener('click', async () => {
    const nome = prompt('Novo nome do cliente:', b.dataset.nome); if (!nome || !nome.trim()) return;
    try { await api(`/api/saas/clientes/${b.dataset.renomear}`, { method: 'PUT', corpo: { nome } }); await carregarEu(); aviso('Nome atualizado.'); render(); } catch (e) { falha(e); }
  }));
  v.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Excluir o cliente "${b.dataset.nome}", as chaves e as campanhas guardadas dele? Não dá para desfazer. Campanhas já criadas no Meta e no Google não são apagadas por lá.`)) return;
    try { await api(`/api/saas/clientes/${b.dataset.excluir}`, { method: 'DELETE' }); if (String(b.dataset.excluir) === String(S.eu.cliente_atual)) lembrarCliente(null); await carregarEu(); aviso('Cliente excluído.'); render(); } catch (e) { falha(e); }
  }));
  const f = $('#fCliente');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const x = await api('/api/saas/clientes', { method: 'POST', corpo: { nome: $('#nomeCliente').value } }); aviso('Cliente adicionado.'); trocarCliente(x.cliente.id); } catch (er) { falha(er); }
  });
}

// ---------------- Início ----------------
async function viewInicio(v) {
  await carregarChaves();
  const campos = S.chaves.grupos.flatMap((g) => g.campos);
  const tem = (k) => campos.find((c) => c.chave === k)?.definido;
  const metaOk = tem('META_ADS_TOKEN') && tem('META_AD_ACCOUNT_ID') && tem('META_PAGE_ID');
  const googleOk = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'].every(tem);
  const c = S.eu.conta;
  const passos = [
    [metaOk || googleOk, 'Cole as chaves do Meta e/ou do Google em <a class="link" data-ir="chaves">Chaves de API</a>'],
    [S.testes.meta?.ok || S.testes.google?.ok, 'Clique em "Testar conexão" para confirmar que as chaves funcionam'],
    [S.campanhas.length > 0 || false, 'Crie a sua primeira campanha em <a class="link" data-ir="campanhas">Campanhas</a>'],
    c.plano === 'gratis' ? [false, 'Precisa de mais campanhas por mês? Conheça os planos em <a class="link" data-ir="assinatura">Assinatura</a>']
      : [c.situacao.codigo === 'ativa' || c.situacao.codigo === 'cortesia', 'Assine em <a class="link" data-ir="assinatura">Assinatura</a> antes de o teste acabar'],
  ];
  secao(v, `<div class="view-head"><div><h2>Olá, ${esc((c.nome || '').split(' ')[0] || 'tudo bem')}</h2><p>Comece por aqui. Nada vai ao ar sem a sua confirmação.</p></div></div>
    <div class="sa-intro">
      <div class="card sa-video"><h3>Veja a MidIAut em ação</h3>
        <video controls playsinline preload="metadata" poster="/video/demo-midiaut-poster.jpg" aria-label="Vídeo demonstrativo da MidIAut"><source src="/video/demo-midiaut.mp4" type="video/mp4">Seu navegador não toca este vídeo.</video>
        <p class="muted">Cerca de 1 minuto: do pedido à campanha pronta para revisar. Os dados do vídeo são ilustrativos.</p></div>
      <div class="card" id="suporteBox"><h3>Ajuda para integrar</h3><p class="muted">Carregando…</p></div>
    </div>
    <div class="card"><h3>Primeiros passos</h3><ul class="sa-passos">${passos.map(([f, t]) => `<li class="${f ? 'feito' : ''}"><div class="bola">${f ? '✓' : ''}</div><span>${t}</span></li>`).join('')}</ul></div>
    <div class="sa-grid" id="desemp"></div>`);
  v.querySelectorAll('[data-ir]').forEach((a) => { a.setAttribute('role', 'link'); a.tabIndex = 0; const ir = () => irPara(a.dataset.ir); a.addEventListener('click', ir); a.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); }); });
  carregarCampanhas().then(() => { /* atualiza o passo 3 */ const li = v.querySelectorAll('.sa-passos li')[2]; if (S.campanhas.length && li) { li.classList.add('feito'); li.querySelector('.bola').textContent = '✓'; } }).catch(() => {});
  pintarSuporte();
  const d = $('#desemp');
  if (metaOk) api('/api/saas/meta/desempenho?nivel=campaign&periodo=last_7d').then((rows) => {
    const t = rows.reduce((a, r) => ({ gasto: a.gasto + Number(r.spend || 0), cliques: a.cliques + Number(r.clicks || 0), imp: a.imp + Number(r.impressions || 0) }), { gasto: 0, cliques: 0, imp: 0 });
    d.insertAdjacentHTML('beforeend', `<div class="card"><h3>Meta · últimos 7 dias</h3><p style="font-size:24px;margin:8px 0 2px">${brl(t.gasto)}</p><p class="muted">${t.cliques.toLocaleString('pt-BR')} cliques · ${t.imp.toLocaleString('pt-BR')} impressões</p></div>`);
  }).catch((e) => d.insertAdjacentHTML('beforeend', `<div class="card"><h3>Meta</h3><p class="muted">Não consegui ler o desempenho: ${esc(e.message)}</p></div>`));
  if (googleOk) api('/api/saas/google/campanhas?periodo=LAST_7_DAYS').then((rows) => {
    const t = rows.reduce((a, r) => ({ gasto: a.gasto + r.gasto_brl, cliques: a.cliques + r.cliques, conv: a.conv + r.conversoes }), { gasto: 0, cliques: 0, conv: 0 });
    d.insertAdjacentHTML('beforeend', `<div class="card"><h3>Google Ads · últimos 7 dias</h3><p style="font-size:24px;margin:8px 0 2px">${brl(t.gasto)}</p><p class="muted">${t.cliques.toLocaleString('pt-BR')} cliques · ${t.conv.toLocaleString('pt-BR')} conversões</p></div>`);
  }).catch((e) => d.insertAdjacentHTML('beforeend', `<div class="card"><h3>Google Ads</h3><p class="muted">Não consegui ler o desempenho: ${esc(e.message)}</p></div>`));
}

// ---------------- Chaves de API ----------------
async function carregarChaves() { S.chaves = await api('/api/saas/chaves'); }

async function viewChaves(v) {
  await carregarChaves();
  secao(v, `<div class="view-head"><div><h2>Chaves de API</h2><p>Clique no <b>?</b> de cada campo para ver o passo a passo de como gerar. As chaves ficam criptografadas e não aparecem inteiras depois de salvas.</p></div></div>`);
  for (const g of S.chaves.grupos) {
    const t = S.testes[g.id === 'meta' ? 'meta' : 'google'];
    secao(v, `<section class="card" data-grupo="${g.id}">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div><h3>${esc(g.titulo)}</h3><p class="muted" style="margin:2px 0 0">${esc(g.intro)}</p></div>
        <button class="btn" data-testar="${g.id === 'meta' ? 'meta' : 'google'}">Testar conexão</button></div>
      <div class="sa-res ${t ? (t.ok ? 'ok' : 'ruim') : 'hidden'}" id="res-${g.id}" style="margin-top:10px">${t ? esc(textoTeste(t)) : ''}</div>
      ${g.campos.map((c) => campoChave(c)).join('')}</section>`);
  }
  v.querySelectorAll('.sa-ajuda-btn').forEach((b) => b.addEventListener('click', () => {
    const p = $(`#aj-${b.dataset.k}`); const abre = p.classList.contains('hidden'); p.classList.toggle('hidden', !abre); b.setAttribute('aria-expanded', abre);
  }));
  v.querySelectorAll('[data-salvar]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.salvar; const inp = $(`#in-${k}`);
    try { await api('/api/saas/chaves', { method: 'PUT', corpo: { chave: k, valor: inp.value } }); aviso('Chave salva.'); S.testes = {}; render(); } catch (e) { falha(e); }
  }));
  v.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta chave do sistema?')) return;
    try { await api(`/api/saas/chaves/${b.dataset.remover}`, { method: 'DELETE' }); aviso('Chave removida.'); S.testes = {}; render(); } catch (e) { falha(e); }
  }));
  v.querySelectorAll('[data-testar]').forEach((b) => b.addEventListener('click', async () => {
    const qual = b.dataset.testar; b.disabled = true; b.textContent = 'Testando...';
    try { S.testes[qual] = await api(`/api/saas/testar/${qual}`, { method: 'POST' }); } catch (e) { S.testes[qual] = { ok: false, erro: e.message }; }
    render();
  }));
}

function textoTeste(t) {
  if (!t.ok) return `Não conectou: ${t.erro}`;
  return ['Conectado', t.conta && `conta "${t.conta}"`, t.pagina && `página "${t.pagina}"`, t.moeda, t.aviso].filter(Boolean).join(' · ');
}

function campoChave(c) {
  const a = c.ajuda;
  return `<div class="sa-campo">
    <div class="sa-campo-top">
      <label for="in-${c.chave}">${esc(c.rotulo)}</label>
      ${c.obrigatorio ? '' : '<span class="muted" style="font-size:12px">opcional</span>'}
      <button class="sa-ajuda-btn" type="button" data-k="${c.chave}" aria-expanded="false" aria-controls="aj-${c.chave}" title="Como conseguir">?</button>
      ${c.definido ? '<span class="pill ok">salva</span>' : '<span class="pill">vazia</span>'}
    </div>
    <div class="sa-ajuda hidden" id="aj-${c.chave}">
      <h4>${esc(a.titulo)}</h4>
      <ol>${a.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
      ${a.links?.length ? `<div class="links">${a.links.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)} ↗</a>`).join('')}</div>` : ''}
      ${a.nota ? `<div class="sa-nota">${esc(a.nota)}</div>` : ''}
    </div>
    <div class="sa-linha">
      <input id="in-${c.chave}" type="${c.secreto ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${c.definido ? esc(c.previa) + ' (cole outra para trocar)' : esc(c.exemplo || 'Cole aqui')}">
      <button class="btn primary" data-salvar="${c.chave}">Salvar</button>
      ${c.definido ? `<button class="btn ghost danger" data-remover="${c.chave}">Remover</button>` : ''}
    </div></div>`;
}

// ---------------- Campanhas ----------------
async function carregarCampanhas() { S.campanhas = await api('/api/saas/campanhas'); }
const STATUS_ROT = { rascunho: ['Rascunho', ''], criando: ['Criando...', 'warn'], criada_pausada: ['Criada (pausada)', 'warn'], ativando: ['Ativando...', 'warn'], ativada: ['Ativa', 'ok'], erro: ['Com erro', 'ruim'] };
const OBJ_ROT = { OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_AWARENESS: 'Reconhecimento', OUTCOME_LEADS: 'Leads', OUTCOME_SALES: 'Vendas', OUTCOME_ENGAGEMENT: 'Engajamento' };
const DEST_ROT = { site: 'Site (link)', whatsapp: 'WhatsApp', post: 'Engajamento no anúncio', messenger: 'Mensagens no Messenger', instagram_direct: 'Mensagens no Instagram Direct', instagram_facebook: 'Mensagens no Instagram e Facebook' };
const CTAS = ['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD', 'APPLY_NOW', 'BOOK_TRAVEL'];
const CTA_ROT = { LEARN_MORE: 'Saiba mais', SIGN_UP: 'Cadastre-se', SHOP_NOW: 'Comprar', CONTACT_US: 'Fale conosco', GET_QUOTE: 'Pedir orçamento', SUBSCRIBE: 'Inscrever-se', DOWNLOAD: 'Baixar', APPLY_NOW: 'Candidate-se', BOOK_TRAVEL: 'Reservar' };

// Pedido de suporte para integração: abre um chamado no painel da administradora para agendar a configuração
async function pintarSuporte() {
  const box = $('#suporteBox'); if (!box) return;
  let lista = [];
  try { lista = (await api('/api/saas/chamados')).chamados; } catch (e) { box.innerHTML = `<h3>Ajuda para integrar</h3><p class="muted">${esc(e.message)}</p>`; return; }
  const at = lista.find((c) => ['aberto', 'agendado'].includes(c.status));
  const quando = (d) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
  const btnIntegrar = S.eu.suporte ? '' : '<button class="btn primary" id="bIntegrar" style="width:100%">Integrar para anunciar</button><p class="muted" style="margin:6px 0 0;font-size:12px">Conecte o Meta Ads e o Google Ads em poucos passos guiados.</p>';
  const ult = !at && lista[0] && lista[0].status === 'concluido' ? '<p class="muted" style="margin-top:8px">Seu último pedido foi concluído. Se precisar de novo, é só solicitar.</p>' : '';
  box.innerHTML = at
    ? `<h3>Conectar para anunciar <span class="pill ${at.status === 'agendado' ? 'ok' : ''}">${at.status === 'agendado' ? 'Suporte agendado' : 'Suporte pedido'}</span></h3>
       ${btnIntegrar}<p style="margin-top:12px">${at.status === 'agendado' ? `Sua configuração está marcada para <b>${esc(quando(at.agendado_para))}</b>.` : 'Recebemos o seu pedido. Vamos entrar em contato para marcar o horário.'}</p>
       <p class="muted">Integrar: ${at.plataformas.map((x) => (x === 'meta' ? 'Meta Ads' : 'Google Ads')).join(' e ')} · Contato: ${esc(at.contato)}</p>
       ${S.eu.suporte ? '' : '<button class="btn small" id="bCancSup">Cancelar pedido</button>'}`
    : `<h3>Conectar para anunciar</h3>${btnIntegrar}<p class="muted" style="margin-top:12px">Não quer colar as chaves sozinho? Nossa equipe agenda um horário e configura o Meta Ads e o Google Ads com você.</p>${ult}
       ${S.eu.suporte ? '' : '<div style="margin-top:10px"><button class="btn" id="bPedirSup" style="width:100%">Solicitar suporte para integração</button></div>'}`;
  const canc = $('#bCancSup'); if (canc) canc.addEventListener('click', async () => { if (!confirm('Cancelar o pedido de suporte?')) return; try { await api(`/api/saas/chamados/${at.id}/cancelar`, { method: 'POST' }); aviso('Pedido cancelado.'); pintarSuporte(); } catch (e) { falha(e); } });
  const ig = $('#bIntegrar'); if (ig) ig.addEventListener('click', () => abrirIntegrar());
  const ped = $('#bPedirSup'); if (ped) ped.addEventListener('click', () => abrirPedidoSuporte());
}
function abrirPedidoSuporte() {
  modal(`<div class="modal-head"><h3>Solicitar suporte para integração</h3><button class="btn ghost small" data-fechar>Fechar</button></div>
    <div class="modal-body">
      <p class="muted">Vamos marcar um horário e configurar tudo com você. Você continua dono das suas contas: nós só ajudamos a colar e testar as chaves.</p>
      <label>O que integrar</label>
      <div class="sa-checks"><label><input type="checkbox" name="plat" value="meta" checked> Meta Ads (Facebook e Instagram)</label><label><input type="checkbox" name="plat" value="google"> Google Ads</label></div>
      <label>WhatsApp ou telefone (com DDD)</label><input id="sp_contato" inputmode="tel" placeholder="(81) 99999-9999">
      <label>Quais dias e horários ficam bons para você?</label><textarea id="sp_janela" rows="2" placeholder="Ex.: terça e quinta à tarde, ou qualquer dia depois das 18h"></textarea>
      <label>Algo que devemos saber? (opcional)</label><textarea id="sp_obs" rows="2" placeholder="Ex.: já tenho a página do Facebook, falta a conta de anúncios"></textarea>
      <div id="sp_res"></div></div>
    <div class="modal-foot"><button class="btn primary" id="sp_enviar">Enviar pedido</button></div>`);
  $('#sp_enviar').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      await api('/api/saas/chamados', { method: 'POST', corpo: { plataformas: [...document.querySelectorAll('input[name=plat]:checked')].map((x) => x.value), contato: $('#sp_contato').value, janela: $('#sp_janela').value, obs: $('#sp_obs').value } });
      fechar(); aviso('Pedido enviado! Vamos entrar em contato para agendar.'); pintarSuporte();
    } catch (e) { $('#sp_res').innerHTML = `<div class="sa-res ruim" style="margin-top:10px">${esc(e.message)}</div>`; b.disabled = false; }
  });
}

// Limite mensal de campanhas do plano + compra de campanhas avulsas
function pintarCota() {
  const box = $('#cotaBox'); if (!box || !S.eu) return;
  const k = S.eu.conta.campanhas; const pct = Math.min(100, Math.round((k.usadas / k.limite) * 100)); const cheio = k.usadas >= k.limite;
  box.innerHTML = `<h3>Campanhas deste mês</h3>
    <div class="cota-barra"><i style="width:${pct}%" class="${cheio ? 'cheia' : ''}"></i></div>
    <p class="muted" style="margin:6px 0 0"><b>${k.usadas}/${k.limite}</b> campanhas do plano ${esc(S.eu.conta.plano_nome)} usadas${k.extras ? ` · <b>${k.extras}</b> avulsa${k.extras > 1 ? 's' : ''} disponível${k.extras > 1 ? 'is' : ''}` : ''}. O limite volta no início de cada mês.</p>
    ${cheio && !k.extras ? '<div class="sa-pend" style="margin-top:10px">Você usou todas as campanhas do mês. Para criar mais agora, compre campanhas avulsas.</div>' : ''}
    <div class="cota-compra"><label>Campanhas avulsas (${brl(k.preco_avulsa)} cada, não vencem)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input id="qAvulsa" type="number" min="1" max="50" value="${cheio ? 5 : 1}" style="width:90px"><span class="muted" id="totAvulsa"></span><button class="btn ${cheio ? 'primary' : ''}" id="bAvulsa">Comprar no cartão</button><button class="btn" id="bAvulsaPix">Pagar com Pix</button></div></div>`;
  const tot = () => { $('#totAvulsa').textContent = `Total: ${brl(Math.max(1, Number($('#qAvulsa').value) || 1) * k.preco_avulsa)}`; };
  $('#qAvulsa').addEventListener('input', tot); tot();
  $('#bAvulsaPix').addEventListener('click', () => abrirPix('avulsas', Math.min(50, Math.max(1, Math.floor(Number($('#qAvulsa').value)) || 1))));
  $('#bAvulsa').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await api('/api/saas/campanhas-avulsas', { method: 'POST', corpo: { quantidade: Number($('#qAvulsa').value) } }); location.href = r.url; }
    catch (e) { falha(e); b.disabled = false; }
  });
}
// Assistente "Integrar para anunciar": guia a colagem das chaves do Meta e/ou do Google e já testa a conexão
async function abrirIntegrar(plat = 'meta') {
  try { await carregarChaves(); } catch (e) { return falha(e); }
  const grupo = (id) => S.chaves.grupos.find((g) => g.id === id);
  const g = grupo(plat) || S.chaves.grupos[0]; const qual = g.id === 'meta' ? 'meta' : 'google';
  const tudo = g.campos.filter((c) => c.obrigatorio).every((c) => c.definido);
  const t = S.testes[qual];
  modal(`<div class="modal-head"><h3>Integrar para anunciar</h3><button class="btn ghost small" data-fechar>Fechar</button></div>
    <div class="modal-body">
      <div class="sa-abas-int">${S.chaves.grupos.map((x) => `<button type="button" class="${x.id === g.id ? 'on' : ''}" data-plat="${x.id}">${esc(x.titulo.split(' (')[0])} ${x.campos.filter((c) => c.obrigatorio).every((c) => c.definido) ? '✓' : ''}</button>`).join('')}</div>
      <p class="muted">${esc(g.intro)} Cole cada item abaixo (use o <b>?</b> para ver onde achar). Os dados ficam criptografados e só você os usa.</p>
      ${g.campos.map((c) => `<div class="sa-campo"><div class="sa-campo-top"><label for="ig-${c.chave}">${esc(c.rotulo)}</label>${c.obrigatorio ? '' : '<span class="muted" style="font-size:12px">opcional</span>'}
        <button class="sa-ajuda-btn" type="button" data-k="${c.chave}" aria-expanded="false" title="Como conseguir">?</button>${c.definido ? '<span class="pill ok">salvo</span>' : '<span class="pill">falta</span>'}</div>
        <div class="sa-ajuda hidden" id="ajig-${c.chave}"><h4>${esc(c.ajuda.titulo)}</h4><ol>${c.ajuda.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
          ${c.ajuda.links?.length ? `<div class="links">${c.ajuda.links.map(([tt, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(tt)} ↗</a>`).join('')}</div>` : ''}${c.ajuda.nota ? `<div class="sa-nota">${esc(c.ajuda.nota)}</div>` : ''}</div>
        <input id="ig-${c.chave}" type="${c.secreto ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${c.definido ? esc(c.previa) + ' (deixe vazio para manter)' : esc(c.exemplo || 'Cole aqui')}"></div>`).join('')}
      <div id="ig_res" class="sa-res ${t ? (t.ok ? 'ok' : 'ruim') : 'hidden'}" style="margin-top:10px">${t ? esc(textoTeste(t)) : ''}</div>
    </div>
    <div class="modal-foot"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="ig_salvar">Salvar e testar conexão</button>
      ${t?.ok ? '<button class="btn" id="ig_campanha">Criar minha primeira campanha</button>' : ''}</div>
      <button class="btn ghost small" id="ig_suporte">Prefiro ajuda da equipe</button></div>`);
  document.querySelectorAll('#modal [data-plat]').forEach((b) => b.addEventListener('click', () => abrirIntegrar(b.dataset.plat)));
  document.querySelectorAll('#modal .sa-ajuda-btn').forEach((b) => b.addEventListener('click', () => { const p = $(`#ajig-${b.dataset.k}`); const abre = p.classList.contains('hidden'); p.classList.toggle('hidden', !abre); b.setAttribute('aria-expanded', abre); }));
  $('#ig_suporte').addEventListener('click', () => { fechar(); abrirPedidoSuporte(); });
  const cm = $('#ig_campanha'); if (cm) cm.addEventListener('click', () => { fechar(); irPara('campanhas'); });
  $('#ig_salvar').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Salvando e testando...';
    try {
      for (const c of g.campos) { const v = $(`#ig-${c.chave}`).value.trim(); if (v) await api('/api/saas/chaves', { method: 'PUT', corpo: { chave: c.chave, valor: v } }); }
      await carregarChaves();
      const faltam = grupo(g.id).campos.filter((c) => c.obrigatorio && !c.definido);
      if (faltam.length) { S.testes[qual] = { ok: false, erro: `faltam: ${faltam.map((c) => c.rotulo).join(', ')}.` }; }
      else { try { S.testes[qual] = await api(`/api/saas/testar/${qual}`, { method: 'POST' }); } catch (e) { S.testes[qual] = { ok: false, erro: e.message }; } }
    } catch (e) { S.testes[qual] = { ok: false, erro: e.message }; }
    await abrirIntegrar(plat); if (S.aba === 'inicio') render();
  });
}

// ---------------- Criativos: imagens e vídeos (tela de Campanhas e editor da campanha) ----------------
// Cada arquivo enviado vira o token "midia:ID". Aqui ficam o envio (com progresso), as miniaturas, a ordem e a biblioteca.
const TOKEN_MIDIA = /^midia:\d+$/;
const infoMidia = {}; // token -> { tipo: 'imagem' | 'video', nome, duracao }
const guardarInfo = (m) => { infoMidia[m.token] = { tipo: m.tipo, nome: m.nome, duracao: m.duracao }; };
const urlMidia = (t) => (TOKEN_MIDIA.test(t) ? `/api/saas/midias/${t.slice(6)}/arquivo${S.cliente ? `?cliente=${encodeURIComponent(S.cliente)}` : ''}` : t);
const tipoDe = (t) => (TOKEN_MIDIA.test(t) ? (infoMidia[t]?.tipo || 'imagem') : 'imagem');
const duracaoTxt = (seg) => (seg ? `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, '0')}` : '');
const mbTxt = (b) => `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;
async function biblioteca(recarregar = false) {
  if (!S.midias || recarregar) { S.midias = (await api('/api/saas/midias')).midias; S.midias.forEach(guardarInfo); }
  return S.midias;
}
async function garantirInfo(tokens) { if (tokens.some((t) => TOKEN_MIDIA.test(t) && !infoMidia[t])) { try { await biblioteca(true); } catch { /* sem a lista, trata como imagem */ } } }
// <img> ou <video> da miniatura (a rota aceita ?cliente= para funcionar direto no src; o vídeo mostra o primeiro quadro)
function miniatura(t) {
  const v = tipoDe(t) === 'video'; const el = document.createElement(v ? 'video' : 'img');
  if (v) { el.src = `${urlMidia(t)}#t=0.1`; el.preload = 'metadata'; el.muted = true; el.playsInline = true; }
  else { el.src = urlMidia(t); el.alt = ''; el.loading = 'lazy'; }
  el.addEventListener('error', () => el.replaceWith(Object.assign(document.createElement('div'), { className: 'ed-quebrada', textContent: 'Arquivo indisponível' })), { once: true });
  return el;
}
function enviarArquivo(f, tipo, progresso) {
  return new Promise((ok, falhar) => {
    const x = new XMLHttpRequest(); x.open('POST', '/api/saas/midias');
    x.setRequestHeader('content-type', tipo); x.setRequestHeader('x-nome-arquivo', encodeURIComponent(f.name)); if (S.cliente) x.setRequestHeader('x-cliente', S.cliente);
    x.upload.onprogress = (e) => { if (e.lengthComputable) progresso(e.loaded / e.total); };
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch { /* resposta sem JSON */ }
      if (x.status >= 200 && x.status < 300 && d.midia) return ok(d.midia);
      falhar(Object.assign(new Error(d.erro || (x.status === 413 ? 'Arquivo grande demais.' : `Erro ${x.status}`)), { status: x.status }));
    };
    x.onerror = () => falhar(new Error('A conexão caiu durante o envio. Tente de novo.'));
    x.send(f);
  });
}
function criarUploader(host, { itens = [], editavel = true, max = 10, links = true, onMudou = () => {} } = {}) {
  let lista = [...itens]; let seq = 0;
  host.innerHTML = `${editavel ? `<div class="ed-drop" tabindex="0" role="button" aria-label="Enviar imagens e vídeos"><b>Arraste imagens ou vídeos aqui</b> ou <u>escolha no computador</u><br><small>Imagem JPG ou PNG até 8 MB · Vídeo MP4 ou MOV até 60 MB · Ideal: 1080×1080 (quadrado) ou 1080×1350 / 1080×1920 (vertical)</small><input type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime,.mp4,.mov" multiple hidden></div><div class="ed-prog" hidden><span></span><i><b></b></i></div>` : ''}
    <div class="ed-bandeja"></div>
    ${editavel && links ? `<details class="ed-link"><summary>Ou usar a imagem de um link</summary><div class="ed-linha"><input class="up-link" placeholder="https://…/imagem.jpg"><button class="btn small up-add" type="button">Adicionar</button></div></details>` : ''}
    ${editavel ? `<details class="ed-link up-det"><summary>Escolher entre arquivos já enviados</summary><div class="ed-bib"><span class="dica">Carregando…</span></div></details>` : ''}`;
  const q = (sel) => host.querySelector(sel);
  const adicionar = (t) => {
    if (lista.includes(t)) return aviso('Esse arquivo já está no anúncio.', true);
    if (lista.length >= max) return aviso(`O anúncio aceita no máximo ${max} itens (carrossel).`, true);
    lista.push(t); return true;
  };
  const pintar = async () => {
    const eu = ++seq; await garantirInfo(lista); if (eu !== seq) return;
    const b = q('.ed-bandeja'); const nv = lista.filter((t) => tipoDe(t) === 'video').length;
    b.innerHTML = lista.map((t, k) => `<div class="ed-mini" data-k="${k}"><span class="ed-n">${k + 1}</span>${tipoDe(t) === 'video' ? `<span class="ed-play" title="Vídeo">▶</span>${infoMidia[t]?.duracao ? `<span class="ed-dur">${duracaoTxt(infoMidia[t].duracao)}</span>` : ''}` : ''}${editavel ? `<div class="ed-mini-acoes"><button type="button" data-mv="-1" title="Mover para trás" ${k === 0 ? 'disabled' : ''}>‹</button><button type="button" data-mv="1" title="Mover para frente" ${k === lista.length - 1 ? 'disabled' : ''}>›</button><button type="button" data-rm title="Remover do anúncio">×</button></div>` : ''}</div>`).join('')
      + (lista.length ? `<div class="ed-tipo">${lista.length === 1 ? (nv ? 'Anúncio com 1 vídeo' : 'Anúncio com 1 imagem') : `Carrossel de ${lista.length} ${nv ? 'itens' : 'imagens'}`}</div>` : '<div class="dica">Nenhum criativo ainda.</div>');
    b.querySelectorAll('.ed-mini').forEach((m) => {
      const k = Number(m.dataset.k); m.prepend(miniatura(lista[k]));
      m.querySelectorAll('[data-mv]').forEach((x) => x.addEventListener('click', () => { const d = Number(x.dataset.mv); [lista[k], lista[k + d]] = [lista[k + d], lista[k]]; pintar(); }));
      const rm = m.querySelector('[data-rm]'); if (rm) rm.addEventListener('click', () => { lista.splice(k, 1); pintar(); });
    });
    onMudou(lista);
  };
  const progresso = (txt, frac) => { const p = q('.ed-prog'); if (!p) return; p.hidden = txt === null; if (txt !== null) { p.firstElementChild.textContent = txt; p.querySelector('b').style.width = `${Math.round(frac * 100)}%`; } };
  const enviar = async (arquivos) => {
    const drop = q('.ed-drop'); drop.classList.add('enviando'); let mudou = false;
    for (const f of arquivos) {
      const tipo = f.type || (/\.mp4$/i.test(f.name) ? 'video/mp4' : /\.mov$/i.test(f.name) ? 'video/quicktime' : '');
      const video = /^video\/(mp4|quicktime)$/.test(tipo);
      if (!video && !/^image\/(jpeg|png)$/.test(tipo)) { aviso(`"${f.name}": envie imagem JPG/PNG ou vídeo MP4/MOV.`, true); continue; }
      if (f.size > (video ? 60 : 8) * 1048576) { aviso(`"${f.name}" passa de ${video ? 60 : 8} MB${video ? '. Comprima o vídeo (1080 px, H.264) e envie de novo.' : '.'}`, true); continue; }
      if (lista.length >= max) { aviso(`O anúncio aceita no máximo ${max} itens (carrossel).`, true); break; }
      try {
        const m = await enviarArquivo(f, tipo, (fr) => progresso(`Enviando "${f.name}" (${mbTxt(f.size)}) · ${Math.round(fr * 100)}%`, fr));
        S.midias = null; guardarInfo(m); adicionar(m.token); mudou = true;
      } catch (e) { if (e.status === 401) { falha(Object.assign(e, { tratado: false })); break; } aviso(`"${f.name}": ${e.message}`, true); if (e.status === 402) falha(e); }
    }
    progresso(null); drop.classList.remove('enviando'); if (mudou) await pintar();
  };
  if (editavel) {
    const drop = q('.ed-drop'); const arq = q('input[type=file]');
    drop.addEventListener('click', () => arq.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); arq.click(); } });
    arq.addEventListener('change', () => { enviar([...arq.files]); arq.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', (e) => enviar([...(e.dataTransfer?.files || [])]));
    const add = q('.up-add');
    if (add) add.addEventListener('click', () => { const i = q('.up-link'); const val = i.value.trim(); if (!/^https:\/\/\S+$/i.test(val)) return aviso('Cole um link que comece com https://', true); if (adicionar(val)) { i.value = ''; pintar(); } });
    const pintarBib = async () => {
      const bib = q('.ed-bib');
      try {
        const ms = await biblioteca(true);
        bib.innerHTML = ms.length ? ms.map((m) => `<div class="ed-bibi" data-t="${m.token}"><button type="button" class="ed-bibb" title="${esc(m.nome)}"><span class="ed-bibm"></span>${m.tipo === 'video' ? `<span class="ed-play">▶</span>` : ''}<small>${esc(m.nome)}</small></button><button type="button" class="ed-bibx" title="Excluir da biblioteca" aria-label="Excluir ${esc(m.nome)}">×</button></div>`).join('') : '<span class="dica">Você ainda não enviou arquivos.</span>';
        bib.querySelectorAll('.ed-bibi').forEach((x) => {
          const t = x.dataset.t; x.querySelector('.ed-bibm').appendChild(miniatura(t));
          x.querySelector('.ed-bibb').addEventListener('click', () => { if (adicionar(t)) pintar(); });
          x.querySelector('.ed-bibx').addEventListener('click', async () => {
            if (!confirm(`Excluir "${infoMidia[t]?.nome || 'este arquivo'}" da biblioteca? Ele sai de todos os lugares onde não está em rascunho.`)) return;
            try { await api(`/api/saas/midias/${t.slice(6)}`, { method: 'DELETE' }); lista = lista.filter((y) => y !== t); S.midias = null; await pintarBib(); pintar(); } catch (er) { falha(er); }
          });
        });
      } catch (er) { falha(er); }
    };
    q('.up-det').addEventListener('toggle', (e) => { if (e.target.open) pintarBib(); });
  }
  return { itens: () => [...lista], tokens: () => lista.filter((t) => TOKEN_MIDIA.test(t)), pintar };
}

async function viewCampanhas(v) {
  await carregarCampanhas();
  secao(v, `<div class="view-head"><div><h2>Campanhas</h2><p>Descreva o que quer anunciar e a IA monta o rascunho. Você revisa, cria pausada e só então ativa.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="bManual">Montar manualmente</button><button class="btn" id="bGoogle">Nova campanha no Google</button></div></div>
    <div class="card"><h3>Nova campanha com IA (Meta)</h3>
      <p class="muted" style="margin:4px 0 10px">Conte: o que anuncia, objetivo, quanto quer gastar por dia, cidades, público e para onde levar o clique. Usos neste mês: ${S.eu.conta.ia.usados}/${S.eu.conta.ia.limite}.</p>
      <textarea id="briefing" rows="4" placeholder="Ex.: Clínica de estética em Recife. Quero agendamentos de limpeza de pele. R$ 40 por dia, mulheres de 25 a 55 anos em Recife e Olinda, levar para https://minhaclinica.com.br/agendar"></textarea>
      <label style="display:block;margin-top:12px">Criativos do anúncio <span class="dica">(opcional) imagens e vídeos que vão no anúncio. 1 arquivo = anúncio simples; 2 a 10 = carrossel.</span></label>
      <div id="upIA"></div>
      <div style="margin-top:10px"><button class="btn primary" id="bIA">Gerar rascunho com IA</button></div></div>
    <div class="card" id="cotaBox"></div>
    <div class="sa-lista" id="lista"></div>
    <div class="card" id="googleBox"></div>`);
  pintarCota();
  $('#bManual').addEventListener('click', async () => { try { const r = await api('/api/saas/campanhas', { method: 'POST', corpo: { spec: {} } }); await carregarCampanhas(); abrirEditor(r.campanha.id); } catch (e) { falha(e); } });
  $('#bGoogle').addEventListener('click', abrirGoogle);
  const upIA = criarUploader($('#upIA'), { itens: S.criativosIA || [], links: false, max: 10, onMudou: (l) => { S.criativosIA = [...l]; } });
  upIA.pintar();
  $('#bIA').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Montando o rascunho...';
    try { const r = await api('/api/saas/campanhas/ia', { method: 'POST', corpo: { briefing: $('#briefing').value, midias: upIA.tokens() } }); S.criativosIA = []; await carregarEu(); await carregarCampanhas(); abrirEditor(r.campanha.id); }
    catch (er) { falha(er); b.disabled = false; b.textContent = 'Gerar rascunho com IA'; }
  });
  pintarLista();
  pintarGoogle();
}

function pintarLista() {
  const l = $('#lista'); if (!l) return;
  l.innerHTML = S.campanhas.length ? S.campanhas.map((c) => {
    const [rot, cls] = STATUS_ROT[c.status] || [c.status, ''];
    const s = c.spec || {}; const nome = s.nome || '(sem nome)';
    const info = c.plataforma === 'google' ? 'Google · Pesquisa' : `Meta · ${OBJ_ROT[s.objetivo] || 'objetivo a definir'}${s.orcamento_diario_brl ? ' · ' + brl(s.orcamento_diario_brl) + '/dia' : ''}`;
    return `<div class="sa-item" data-id="${c.id}" tabindex="0" role="button"><div><b>${esc(nome)}</b><small>${esc(info)} · ${dataBr(c.created_at)}</small></div><span class="pill ${cls}">${rot}</span></div>`;
  }).join('') : '<p class="muted">Nenhuma campanha ainda. Comece descrevendo a primeira acima.</p>';
  l.querySelectorAll('.sa-item').forEach((i) => {
    const abrir = () => { const c = S.campanhas.find((x) => x.id === Number(i.dataset.id)); if (c.plataforma === 'google') abrirGoogleDetalhe(c); else abrirEditor(c.id); };
    i.addEventListener('click', abrir); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
  });
}

// Editor da campanha do Meta
function abrirEditor(id) {
  const c = S.campanhas.find((x) => x.id === id); if (!c) return;
  const s = c.spec || {}; const editavel = ['rascunho', 'erro'].includes(c.status);
  const dis = editavel ? '' : 'disabled';
  const lst = (a) => (a || []).join('\n');
  const dt = (x) => (x ? String(x).slice(0, 16) : '');
  const opt = (obj, atual) => Object.entries(obj).map(([k, n]) => `<option value="${k}" ${atual === k ? 'selected' : ''}>${esc(n)}</option>`).join('');
  // imagens do anúncio: arquivos enviados ("midia:ID") e/ou links https; 1 = imagem única, 2 a 10 = carrossel
  let imgs = (s.imagens_urls || []).length ? [...s.imagens_urls] : (s.imagem_url ? [s.imagem_url] : []);
  const cont = (id, max, v) => `<span class="ed-cont" data-de="${id}" data-max="${max}">${String(v || '').length}/${max}</span>`;
  modal(`<div class="modal-head"><h3>${esc(s.nome || 'Nova campanha')}</h3><button class="btn ghost small" data-fechar>Fechar</button></div>
    <div class="modal-body">
      ${c.pendencias?.length ? `<div class="sa-pend"><b>Falta confirmar:</b><ul>${c.pendencias.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      ${c.erro ? `<div class="sa-res ruim">${esc(c.erro)}</div>` : ''}
      <section class="ed-sec"><h4><span>1</span> Campanha</h4>
        <div class="row"><div><label>Nome da campanha</label><input id="e_nome" placeholder="Ex.: Clínica · Avaliação gratuita · Recife" value="${esc(s.nome)}" ${dis}></div>
          <div><label>Objetivo</label><select id="e_obj" ${dis}><option value="">Escolha</option>${opt(OBJ_ROT, s.objetivo)}</select><div class="dica" id="dObj"></div></div>
          <div><label>Orçamento por dia (R$)</label><input id="e_orc" inputmode="decimal" placeholder="40" value="${esc(s.orcamento_diario_brl ?? '')}" ${dis}><div class="dica" id="dOrc"></div></div></div>
        <div class="row"><div><label>Para onde leva o clique</label><select id="e_dest" ${dis}><option value="">Automático</option>${opt(DEST_ROT, s.destino)}</select></div>
          <div id="boxUrl"><label>Link de destino (https)</label><input id="e_url" placeholder="https://seusite.com.br/agendar" value="${esc(s.url_destino)}" ${dis}></div></div>
      </section>
      <section class="ed-sec"><h4><span>2</span> Criativo</h4>
        <div class="ed-criativo">
          <div class="ed-cform">
            <label>Criativos do anúncio <span class="dica">Imagem JPG/PNG (até 8 MB) ou vídeo MP4/MOV (até 60 MB). 1 arquivo = anúncio simples; 2 a 10 = carrossel.</span></label>
            <div id="upHost"></div>
            <div class="row"><div><label>Texto principal ${cont('e_texto', 2000, s.texto_principal)}</label><textarea id="e_texto" rows="4" maxlength="2000" placeholder="O que a pessoa vai ler acima da imagem" ${dis}>${esc(s.texto_principal)}</textarea></div></div>
            <div class="row"><div><label>Título ${cont('e_tit', 60, s.titulo)}</label><input id="e_tit" maxlength="60" value="${esc(s.titulo)}" ${dis}></div>
              <div><label>Descrição ${cont('e_desc', 60, s.descricao)}</label><input id="e_desc" maxlength="60" value="${esc(s.descricao)}" ${dis}></div>
              <div><label>Botão</label><select id="e_cta" ${dis}><option value="">Padrão (Saiba mais)</option>${opt(Object.fromEntries(CTAS.map((k) => [k, CTA_ROT[k]])), s.cta)}</select></div></div>
          </div>
          <aside class="ed-prev" aria-label="Prévia do anúncio"><div class="ed-prev-t">Prévia</div><div class="ed-ad"><div class="ed-ad-top"><i></i><b>Sua página</b><small>Patrocinado</small></div>
            <p id="pvTexto"></p><div class="ed-ad-img" id="pvImg"></div><div class="ed-ad-base"><div><small id="pvDesc"></small><b id="pvTit"></b></div><span id="pvCta"></span></div></div></aside>
        </div>
      </section>
      <section class="ed-sec"><h4><span>3</span> Público</h4>
        <div class="row"><div><label>Cidades ou estados (um por linha)</label><textarea id="e_loc" rows="3" placeholder="Recife&#10;João Pessoa, Paraíba" ${dis}>${esc(lst(s.localizacoes))}</textarea><div class="dica">Cidades usam o raio abaixo; estados valem inteiros.</div></div>
          <div><label>Interesses (um por linha)</label><textarea id="e_int" rows="3" placeholder="Estética facial&#10;Skincare" ${dis}>${esc(lst(s.interesses))}</textarea></div></div>
        <div class="row"><div><label>Raio das cidades (km, 17 a 80)</label><input id="e_raio" inputmode="numeric" value="${esc(s.raio_km ?? '')}" ${dis}></div>
          <div><label>Idade mínima</label><input id="e_imin" inputmode="numeric" value="${esc(s.idade_min ?? '')}" ${dis}></div>
          <div><label>Idade máxima</label><input id="e_imax" inputmode="numeric" value="${esc(s.idade_max ?? '')}" ${dis}></div>
          <div><label>Gênero</label><select id="e_gen" ${dis}><option value="">Todos</option><option value="feminino" ${s.genero === 'feminino' ? 'selected' : ''}>Feminino</option><option value="masculino" ${s.genero === 'masculino' ? 'selected' : ''}>Masculino</option></select></div></div>
      </section>
      <section class="ed-sec"><h4><span>4</span> Agenda <small>(opcional)</small></h4>
        <div class="row"><div><label>Início</label><input id="e_ini" type="datetime-local" value="${esc(dt(s.inicio))}" ${dis}></div>
          <div><label>Término</label><input id="e_fim" type="datetime-local" value="${esc(dt(s.termina_em))}" ${dis}></div></div>
      </section>
      <div id="resConferir"></div>
      ${c.ids?.campanha_id ? `<p class="muted">Criada no Meta: campanha ${esc(c.ids.campanha_id)}. Confira também no Gerenciador de Anúncios.</p>` : ''}
    </div>
    <div class="modal-foot"><div style="display:flex;gap:8px;flex-wrap:wrap">
      ${editavel ? '<button class="btn" id="bSalvar">Salvar</button><button class="btn" id="bConferir">Conferir no Meta</button><button class="btn primary" id="bSubir">Criar pausada no Meta</button>' : ''}
      ${c.status === 'criada_pausada' ? '<button class="btn primary" id="bAtivar">Ativar (começa a gastar)</button>' : ''}
      ${c.status === 'ativada' ? '<button class="btn" id="bPausar">Pausar</button>' : ''}</div>
      ${editavel ? '<button class="btn ghost danger" id="bExcluir">Excluir rascunho</button>' : ''}</div>`);
  $('.sa-modal-box').classList.add('largo');

  // ----- criativos: imagens e vídeos (envio, miniaturas, ordem) -----
  const up = criarUploader($('#upHost'), { itens: imgs, editavel, max: 10, onMudou: () => pintarPrevia() });

  // ----- prévia, contadores e dicas -----
  function pintarPrevia() {
    const v = (id) => ($(id) ? $(id).value : '');
    $('#pvTexto').textContent = v('#e_texto') || 'O texto do anúncio aparece aqui.';
    $('#pvTit').textContent = v('#e_tit') || ''; $('#pvDesc').textContent = v('#e_desc') || '';
    $('#pvCta').textContent = CTA_ROT[v('#e_cta')] || (v('#e_dest') && v('#e_dest') !== 'site' ? 'Enviar mensagem' : 'Saiba mais');
    const pi = $('#pvImg'); pi.innerHTML = '';
    const it = up.itens();
    if (!it.length) { pi.textContent = 'Sem criativo'; return; }
    pi.appendChild(miniatura(it[0]));
    if (tipoDe(it[0]) === 'video') { const pl = document.createElement('span'); pl.className = 'ed-play grande'; pl.textContent = '▶'; pi.appendChild(pl); }
    if (it.length > 1) { const t = document.createElement('span'); t.className = 'ed-ad-car'; t.textContent = `1/${it.length}`; pi.appendChild(t); }
  }
  const dicas = () => {
    const ob = $('#e_obj').value, ds = $('#e_dest').value, orc = Number(String($('#e_orc').value).replace(',', '.'));
    $('#dObj').textContent = { OUTCOME_TRAFFIC: 'Leva pessoas ao seu site ou WhatsApp.', OUTCOME_LEADS: 'Gera contatos (formulário, site com pixel ou WhatsApp).', OUTCOME_SALES: 'Vendas no site: exige o pixel do Meta.', OUTCOME_ENGAGEMENT: 'Curtidas, comentários ou conversas.', OUTCOME_AWARENESS: 'Alcance e lembrança de marca.' }[ob] || '';
    $('#dOrc').textContent = orc > 0 ? `≈ ${brl(orc * 30)} por mês` : '';
    const site = (ds === 'site') || (!ds && ob !== 'OUTCOME_ENGAGEMENT');
    $('#boxUrl').style.display = site ? '' : 'none';
  };
  const contar = () => document.querySelectorAll('.ed-cont').forEach((el) => { const i = $('#' + el.dataset.de); const t = i.value.length; el.textContent = `${t}/${el.dataset.max}`; el.classList.toggle('alerta', t >= Number(el.dataset.max) * 0.95); });
  ['#e_texto', '#e_tit', '#e_desc', '#e_cta', '#e_dest', '#e_obj', '#e_orc'].forEach((sel) => $(sel).addEventListener('input', () => { contar(); dicas(); pintarPrevia(); }));
  dicas(); contar(); up.pintar();
  const n = (x) => (x === '' ? undefined : Number(String(x).replace(',', '.')));
  const linhas = (x) => x.split('\n').map((t) => t.trim()).filter(Boolean);
  const coletar = () => ({
    nome: $('#e_nome').value, objetivo: $('#e_obj').value, orcamento_diario_brl: n($('#e_orc').value), texto_principal: $('#e_texto').value,
    titulo: $('#e_tit').value, descricao: $('#e_desc').value, cta: $('#e_cta').value, destino: $('#e_dest').value, url_destino: $('#e_url').value,
    imagem_url: up.itens().length === 1 ? up.itens()[0] : '', imagens_urls: up.itens().length > 1 ? up.itens() : [], localizacoes: linhas($('#e_loc').value), interesses: linhas($('#e_int').value),
    raio_km: n($('#e_raio').value), idade_min: n($('#e_imin').value), idade_max: n($('#e_imax').value), genero: $('#e_gen').value,
    inicio: $('#e_ini').value ? new Date($('#e_ini').value).toISOString() : '', termina_em: $('#e_fim').value ? new Date($('#e_fim').value).toISOString() : '',
  });
  const salvar = async () => { const r = await api(`/api/saas/campanhas/${id}`, { method: 'PUT', corpo: { spec: coletar() } }); const i = S.campanhas.findIndex((x) => x.id === id); S.campanhas[i] = r.campanha; return r.campanha; };
  const ligar = (sel, fn) => { const b = $(sel); if (b) b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (e) { falha(e); } b.disabled = false; }); };
  ligar('#bSalvar', async () => { await salvar(); aviso('Rascunho salvo.'); abrirEditor(id); });
  ligar('#bConferir', async () => {
    await salvar(); const r = await api(`/api/saas/campanhas/${id}/conferir`, { method: 'POST' });
    $('#resConferir').innerHTML = r.ok ? `<div class="sa-res ok"><b>Tudo certo para criar.</b><br>${esc(r.resumo)}<ul>${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : `<div class="sa-res ruim">${esc(r.erro)}</div>`;
  });
  ligar('#bSubir', async () => {
    const sp = await salvar();
    if (!confirm(`Criar no Meta, PAUSADA (não gasta nada ainda)?\n\n${sp.spec.nome || ''}\nOrçamento: ${brl(sp.spec.orcamento_diario_brl)} por dia`)) return;
    try { const r = await api(`/api/saas/campanhas/${id}/subir`, { method: 'POST', corpo: { confirmado: true } }); upd(r.campanha); aviso('Campanha criada pausada no Meta.'); carregarEu().then(pintarCota).catch(() => {}); abrirEditor(id); }
    catch (e) { if (e.dados?.campanha) upd(e.dados.campanha); falha(e); abrirEditor(id); }
  });
  ligar('#bAtivar', async () => {
    if (!confirm(`ATIVAR agora? A campanha começa a gastar ${brl(s.orcamento_diario_brl)} por dia na sua conta de anúncios.`)) return;
    try { const r = await api(`/api/saas/campanhas/${id}/ativar`, { method: 'POST', corpo: { confirmado: true } }); upd(r.campanha); aviso('Campanha ativada.'); abrirEditor(id); }
    catch (e) { if (e.dados?.campanha) upd(e.dados.campanha); falha(e); abrirEditor(id); }
  });
  ligar('#bPausar', async () => { const r = await api(`/api/saas/campanhas/${id}/pausar`, { method: 'POST' }); upd(r.campanha); aviso('Campanha pausada.'); abrirEditor(id); });
  ligar('#bExcluir', async () => { if (!confirm('Excluir este rascunho?')) return; await api(`/api/saas/campanhas/${id}`, { method: 'DELETE' }); fechar(); await carregarCampanhas(); pintarLista(); });
  function upd(nc) { const i = S.campanhas.findIndex((x) => x.id === nc.id); if (i >= 0) S.campanhas[i] = nc; }
}

// Google Ads
async function pintarGoogle() {
  const box = $('#googleBox'); if (!box) return;
  box.innerHTML = '<h3>Google Ads · campanhas da sua conta</h3><p class="muted">Carregando...</p>';
  try {
    const rows = await api('/api/saas/google/campanhas?periodo=LAST_7_DAYS');
    box.innerHTML = `<h3>Google Ads · campanhas da sua conta (7 dias)</h3>` + (rows.length ? `<div class="sa-tabela"><table><thead><tr><th>Campanha</th><th>Status</th><th>Orçamento/dia</th><th>Gasto</th><th>Cliques</th><th>Conv.</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr>
      <td>${esc(r.nome)}</td><td><span class="pill ${r.status === 'ENABLED' ? 'ok' : ''}">${r.status === 'ENABLED' ? 'Ativa' : r.status === 'PAUSED' ? 'Pausada' : esc(r.status)}</span></td>
      <td>${brl(r.orcamento_dia_brl)}</td><td>${brl(r.gasto_brl)}</td><td>${r.cliques}</td><td>${r.conversoes}</td>
      <td style="white-space:nowrap">${r.status === 'ENABLED' ? `<button class="btn small" data-g="PAUSED" data-id="${esc(r.id)}">Pausar</button>` : `<button class="btn small" data-g="ENABLED" data-id="${esc(r.id)}">Ativar</button>`}
        <button class="btn small ghost" data-orc="${esc(r.id)}" data-atual="${r.orcamento_dia_brl}">Orçamento</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma campanha encontrada nesta conta.</p>');
    box.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
      const ativar = b.dataset.g === 'ENABLED';
      if (ativar && !confirm('ATIVAR esta campanha? Ela começa a gastar na sua conta do Google Ads.')) return;
      try { await api(`/api/saas/google/campanhas/${b.dataset.id}/status`, { method: 'POST', corpo: { status: b.dataset.g, confirmado: true } }); aviso(ativar ? 'Campanha ativada.' : 'Campanha pausada.'); pintarGoogle(); } catch (e) { falha(e); }
    }));
    box.querySelectorAll('[data-orc]').forEach((b) => b.addEventListener('click', async () => {
      const v = prompt(`Novo orçamento diário em R$ (atual: ${brl(b.dataset.atual)}). Aumentos de até 20% por vez.`); if (!v) return;
      try { await api(`/api/saas/google/campanhas/${b.dataset.orc}/orcamento`, { method: 'POST', corpo: { valor: v.replace(',', '.'), confirmado: true } }); aviso('Orçamento atualizado.'); pintarGoogle(); } catch (e) { falha(e); }
    }));
  } catch (e) { box.innerHTML = `<h3>Google Ads</h3><p class="muted">${esc(e.message)}</p>`; }
}

function abrirGoogleDetalhe(c) {
  const s = c.spec || {};
  modal(`<div class="modal-head"><h3>${esc(s.nome)}</h3><button class="btn ghost small" data-fechar>Fechar</button></div><div class="modal-body">
    <p>Campanha de Pesquisa criada no Google Ads (ID ${esc(c.ids?.campanha_id || '')}). Ative ou pause na tabela "Google Ads" desta página.</p>
    <p class="muted">Orçamento: ${brl(s.orcamento_diario_brl)} por dia · ${esc(s.estrategia === 'MAXIMIZE_CLICKS' ? 'Maximizar cliques' : 'Maximizar conversões')}</p></div>`);
}

function abrirGoogle() {
  modal(`<div class="modal-head"><h3>Nova campanha de Pesquisa no Google</h3><button class="btn ghost small" data-fechar>Fechar</button></div>
    <div class="modal-body">
      <p class="muted">A campanha, o grupo de anúncios, as palavras-chave e o anúncio são criados <b>pausados</b>. Você ativa depois na tabela do Google Ads.</p>
      <div class="row"><div><label>Nome da campanha</label><input id="g_nome"></div><div><label>Orçamento por dia (R$)</label><input id="g_orc" inputmode="decimal"></div>
        <div><label>Estratégia de lance</label><select id="g_est"><option value="MAXIMIZE_CONVERSIONS">Maximizar conversões</option><option value="MAXIMIZE_CLICKS">Maximizar cliques</option></select></div></div>
      <div><label>Página de destino (https)</label><input id="g_url" placeholder="https://"></div>
      <div class="row"><div><label>Palavras-chave exatas (uma por linha)</label><textarea id="g_exa" rows="4"></textarea></div><div><label>Palavras-chave em frase (uma por linha)</label><textarea id="g_fra" rows="4"></textarea></div></div>
      <div class="row"><div><label>Títulos: 3 a 15, até 30 caracteres cada (um por linha)</label><textarea id="g_tit" rows="5"></textarea></div><div><label>Descrições: 2 a 4, até 90 caracteres cada (uma por linha)</label><textarea id="g_des" rows="5"></textarea></div></div>
      <div id="g_res"></div></div>
    <div class="modal-foot"><span></span><button class="btn primary" id="g_criar">Criar pausada no Google</button></div>`);
  $('#g_criar').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const spec = { nome: $('#g_nome').value, orcamento_diario_brl: $('#g_orc').value.replace(',', '.'), estrategia: $('#g_est').value, url_final: $('#g_url').value, palavras_exatas: $('#g_exa').value, palavras_frase: $('#g_fra').value, titulos: $('#g_tit').value, descricoes: $('#g_des').value };
    if (!confirm(`Criar no Google Ads, PAUSADA?\n\n${spec.nome}\nOrçamento: ${brl(spec.orcamento_diario_brl)} por dia`)) return;
    b.disabled = true; b.textContent = 'Criando...';
    try { await api('/api/saas/google/campanhas', { method: 'POST', corpo: { spec, confirmado: true } }); fechar(); aviso('Campanha criada pausada no Google.'); render(); }
    catch (er) { $('#g_res').innerHTML = `<div class="sa-res ruim">${esc(er.message)}</div>`; b.disabled = false; b.textContent = 'Criar pausada no Google'; }
  });
}

// ---------------- Pagamento por Pix (QR Code + copia e cola) ----------------
const cnpjTxt = (d) => String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
async function abrirPix(tipo, qtd = 1, plano = '') {
  let p; try { p = await api(`/api/saas/pix?tipo=${tipo}&qtd=${qtd}${plano ? `&plano=${plano}` : ''}`); } catch (e) { return falha(e); }
  modal(`<div class="modal-head"><h3>Pagar com Pix</h3><button class="btn ghost small" data-fechar>Fechar</button></div>
    <div class="modal-body pix-box">
      <div class="pix-qr"><img src="${p.qr}" alt="QR Code do Pix" width="240" height="240"></div>
      <div class="pix-info">
        <p class="pix-valor">${brl(p.valor)}</p>
        <p class="muted">${tipo === 'mensalidade' ? `Mensalidade do plano ${esc((S.eu.planos || []).find((x) => x.id === p.plano)?.nome || S.eu.conta.plano_nome)}${S.eu.conta.bi ? ' + BI' : ''}` : `${p.qtd} campanha${p.qtd > 1 ? 's' : ''} avulsa${p.qtd > 1 ? 's' : ''}`}</p>
        <label>Pix copia e cola</label>
        <textarea id="pixCola" rows="4" readonly>${esc(p.payload)}</textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn primary" id="pixCopiar">Copiar código</button></div>
        <p class="muted" style="margin-top:10px">Chave Pix (CNPJ): <b>${cnpjTxt(p.chave)}</b></p>
      </div>
      <ol class="pix-passos"><li>No app do seu banco, escolha <b>Pix</b> e leia o QR Code ou cole o código.</li><li>Confira o valor de <b>${brl(p.valor)}</b> e pague.</li><li>Volte aqui e clique em <b>Já paguei</b>. A liberação é manual: assim que o pagamento for conferido no banco, ${tipo === 'mensalidade' ? 'sua assinatura é ativada por 30 dias' : 'as campanhas avulsas entram na sua conta'}.</li></ol>
    </div>
    <div class="modal-foot"><button class="btn primary" id="pixPaguei">Já paguei</button></div>`);
  $('.sa-modal-box').classList.add('pix');
  $('#pixCopiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText(p.payload); } catch { $('#pixCola').select(); document.execCommand('copy'); } aviso('Código Pix copiado.'); });
  $('#pixPaguei').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { await api('/api/saas/pix/informar', { method: 'POST', corpo: { tipo, qtd, plano: p.plano } }); fechar(); aviso('Aviso enviado! Vamos conferir o pagamento e liberar.'); if (S.aba === 'assinatura') render(); }
    catch (e) { falha(e); b.disabled = false; }
  });
}

// ---------------- Assinatura ----------------
async function assinar(plano) {
  try { const r = await api('/api/saas/assinar', { method: 'POST', corpo: typeof plano === 'string' ? { plano } : undefined }); location.href = r.url; } catch (e) { falha(e); }
}

async function viewAssinatura(v) {
  await carregarEu();
  const c = S.eu.conta; const sit = c.situacao;
  const pagaCartao = c.status === 'ativa' && c.tem_assinatura;
  const gratis = c.plano === 'gratis'; const podeTrocar = !pagaCartao && sit.codigo !== 'cortesia' && sit.codigo !== 'bloqueada';
  const planos = S.eu.planos || []; const precoAtual = (planos.find((x) => x.id === c.plano)?.preco || 0) + (c.bi ? S.eu.bi_preco || 0 : 0);
  let pixPend = []; try { pixPend = (await api('/api/saas/pix/pedidos')).pedidos.filter((x) => x.status === 'informado'); } catch { /* sem a lista, só não mostra o aviso */ }
  secao(v, `<div class="view-head"><div><h2>Assinatura</h2><p>${esc(sit.texto)}</p></div></div>
    <div class="card"><h3>Mensalidade</h3>
      <p style="font-size:24px;margin:8px 0">${c.plano === 'gratis' ? 'Grátis<small class="muted" style="font-size:14px"> · R$ 0 por mês, sempre ativo</small>' : (esc(S.eu.preco || '') || `${brl(precoAtual)}<small class="muted" style="font-size:14px"> / mês · plano ${esc(c.plano_nome)}${c.bi ? ' + BI' : ''}</small>`)}</p>
      ${sit.codigo === 'trial' ? `<p class="muted">Seu período de teste vai até ${dataBr(c.trial_ate)}.</p>` : ''}
      ${c.periodo_fim && c.tem_assinatura ? `<p class="muted">Período atual até ${dataBr(c.periodo_fim)}.</p>` : ''}
      <p class="muted">No cartão, os dados são digitados na página segura do Stripe e este sistema não os guarda. No Pix, você paga por QR Code e a liberação é conferida manualmente.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${S.eu.cobranca && !gratis && !(c.status === 'ativa' && c.tem_assinatura) && sit.codigo !== 'cortesia' && sit.codigo !== 'bloqueada' ? '<button class="btn primary" id="bAssinar2">Assinar e cadastrar cartão</button>' : ''}
        ${!pagaCartao && !gratis && sit.codigo !== 'cortesia' && sit.codigo !== 'bloqueada' ? '<button class="btn primary" id="bPix">Pagar com Pix</button>' : ''}
        ${S.eu.cobranca && c.tem_assinatura ? '<button class="btn" id="bPortal">Gerenciar pagamento (cartão, faturas, cancelar)</button>' : ''}
        ${gratis ? '<span class="muted">Você está no plano Grátis. Para ter mais campanhas por mês, escolha um plano abaixo.</span>' : (!S.eu.cobranca ? '<span class="muted">Cartão ainda não disponível. Use o Pix.</span>' : '')}</div>
      ${pixPend.length ? `<div class="sa-pend" style="margin-top:12px">Pagamento por Pix em conferência: ${pixPend.map((x) => `${x.tipo === 'mensalidade' ? 'mensalidade' : `${x.qtd} campanha${x.qtd > 1 ? 's' : ''} avulsa${x.qtd > 1 ? 's' : ''}`} (${brl(x.valor)})`).join(' · ')}. Assim que for conferido no banco, é liberado.</div>` : ''}</div>
    <div class="card"><h3>Planos</h3>
      <p class="muted" style="margin:4px 0 12px">Assinatura mensal, sem fidelidade. O plano muda conforme o número de clientes que você atende. Para trocar de plano, fale com o suporte.</p>
      <div class="planos-app">${planos.map((p) => `<article class="plano-app ${p.id === c.plano ? 'atual' : ''}">
        ${p.id === c.plano ? '<span class="plano-tag">Seu plano</span>' : ''}
        <h4>${esc(p.nome)}</h4><p class="plano-valor">${p.preco ? brl(p.preco) : 'R$ 0'}<small>/mês</small></p>
        <p class="muted">${p.clientes === 1 ? '1 cliente' : `Até ${p.clientes} clientes`} · ${p.campanhas === 1 ? '1 campanha nova por mês' : `${p.campanhas} campanhas novas por mês`}</p>
        <ul>${p.acoes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        ${podeTrocar && p.id !== c.plano && p.preco > 0 ? `<div class="plano-acoes">${S.eu.cobranca ? `<button class="btn primary small" data-assinar="${p.id}">Assinar no cartão</button>` : ''}<button class="btn small" data-pixplano="${p.id}">Pagar com Pix</button></div>` : ''}</article>`).join('')}</div>
      <div class="plano-extras">
        <div><b>Pacote BI + relatórios</b> <span class="muted">+ ${brl(S.eu.bi_preco || 0)}/mês</span><br><span class="muted">Adicional que pode ser incluído em qualquer plano${c.bi ? ' (já incluído no seu)' : ''}.</span></div>
        <div><b>Campanha avulsa</b> <span class="muted">${brl(S.eu.preco_avulsa || 0)} cada</span><br><span class="muted">Para criar além do limite do mês. Não vence e pode ser paga no cartão ou no Pix.</span></div></div></div>
    <div class="card"><h3>Seus dados</h3>
      <div class="sa-linha" style="margin-top:8px"><input id="empresa" value="${esc(c.empresa || '')}" placeholder="Empresa ou marca"><button class="btn" id="bEmpresa">Salvar</button></div>
      <p class="muted" style="margin-top:12px">E-mail: ${esc(c.email)}</p></div>
    <div class="card"><h3>Excluir minha conta</h3><p class="muted">Apaga a sua conta, as campanhas guardadas aqui e todas as chaves de API. As campanhas que já existem no Meta e no Google não são apagadas por lá.</p>
      <div class="sa-linha" style="margin-top:8px"><input id="senhaExc" type="password" placeholder="Digite a sua senha para confirmar" autocomplete="current-password"><button class="btn danger" id="bExcluirConta">Excluir conta</button></div></div>`);
  const b = $('#bAssinar2'); if (b) b.addEventListener('click', assinar);
  const bx = $('#bPix'); if (bx) bx.addEventListener('click', () => abrirPix('mensalidade'));
  v.querySelectorAll('[data-assinar]').forEach((b) => b.addEventListener('click', () => assinar(b.dataset.assinar)));
  v.querySelectorAll('[data-pixplano]').forEach((b) => b.addEventListener('click', () => abrirPix('mensalidade', 1, b.dataset.pixplano)));
  const p = $('#bPortal'); if (p) p.addEventListener('click', async () => { try { const r = await api('/api/saas/portal', { method: 'POST' }); location.href = r.url; } catch (e) { falha(e); } });
  $('#bEmpresa').addEventListener('click', async () => { try { await api('/api/saas/conta', { method: 'PUT', corpo: { empresa: $('#empresa').value } }); aviso('Salvo.'); } catch (e) { falha(e); } });
  $('#bExcluirConta').addEventListener('click', async () => {
    if (!confirm('Excluir a conta e todas as chaves? Isso não pode ser desfeito.')) return;
    try { await api('/api/saas/conta/excluir', { method: 'POST', corpo: { senha: $('#senhaExc').value } }); S.eu = null; aviso('Conta excluída.'); entrada('entrar'); } catch (e) { falha(e); }
  });
}

// ---------------- Modal ----------------
function modal(html) {
  const m = $('#modal'); m.innerHTML = `<div class="sa-modal-box">${html}</div>`; m.classList.remove('hidden');
  m.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
}
function fechar() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; if (S.eu && S.aba === 'campanhas') pintarLista(); }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') fechar(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) fechar(); });

iniciar().catch((e) => { raiz.innerHTML = `<div class="sa-main"><p class="erro">${esc(e.message)}</p></div>`; });
