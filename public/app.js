// Por Boas Histórias — interface de gestão
const STATUS = ['pauta', 'conteudo', 'design', 'revisao', 'aprovacao', 'agendado', 'publicado'];
const STATUS_LABEL = {
  pauta: 'Pauta', conteudo: 'Conteúdo / copy', design: 'Design / edição', revisao: 'Revisão interna',
  aprovacao: 'Aprovação do cliente', agendado: 'Agendado', publicado: 'Publicado',
};
const STATUS_COLOR = {
  pauta: '#c9bfb4', conteudo: '#e0a37f', design: '#c97b54', revisao: '#a98bd6',
  aprovacao: '#e0a84a', agendado: '#63a8cc', publicado: '#3f7d5a',
};
const TIPO_LABEL = { post: 'Feed', story: 'Stories', blog: 'Blog SEO', captacao: 'Captação', outro: 'Outro' };
const FORMATOS = ['estático', 'carrossel', 'reels', 'story', 'artigo', 'captação', 'outro'];
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const hoje = new Date();
const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

const VIEWS_TAREFAS = ['calendario', 'quadro', 'lista'];
const VIEWS_VALIDAS = ['painel', ...VIEWS_TAREFAS, 'captacao', 'programacao', 'area', 'materiais', 'clientes', 'usuarios'];
const viewSalva = localStorageGet('pbh_view');
const tarefasSalva = localStorageGet('pbh_view_tarefas');

const S = {
  view: VIEWS_VALIDAS.includes(viewSalva) ? viewSalva : 'painel',
  viewTarefas: VIEWS_TAREFAS.includes(tarefasSalva) ? tarefasSalva : 'calendario',
  clients: [],
  cliente: localStorageGet('pbh_cliente') || '',
  mes: hojeISO.slice(0, 7),
  tasks: [],
  quadroTipo: 'post',
  listaFiltro: { tipo: '', status: '', busca: '' },
  matBusca: '',
  me: null,
  users: [],
};

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } }

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (r.status === 401 && path !== '/api/login') { mostrarLogin(); throw new Error('Sessão expirada'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || 'Erro na requisição');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

const mesLabel = (mes) => { const s = new Date(mes + '-15T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };
const diasNoMes = (mes) => { const [y, m] = mes.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const fmtData = (d) => (d ? d.split('-').reverse().slice(0, 2).join('/') : 'Sem data');
const dowDe = (d) => DOW[new Date(d + 'T12:00').getDay()];
const clienteNome = (id) => (S.clients.find((c) => c.id === id) || {}).nome || '';
const tituloTarefa = (t) => t.tema || (t.tipo === 'story' ? 'Stories do dia' : `${TIPO_LABEL[t.tipo]} sem tema`);
const clientesAtivos = () => (S.cliente ? S.clients.filter((c) => String(c.id) === String(S.cliente)) : S.clients);

// ---------------- Inicialização ----------------
async function iniciar() {
  const convite = new URLSearchParams(location.search).get('convite');
  if (convite) return mostrarConvite(convite);
  const s = await api('/api/sessao');
  if (!s.autenticado) return mostrarLogin();
  S.me = s.usuario;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  mostrarEu();
  await Promise.all([carregarClientes(), carregarUsuarios()]);
  render();
  if (S.me.trocar_senha) abrirMinhaConta(true);
}

function mostrarEu() {
  $('#meNome').textContent = S.me.nome || S.me.email.split('@')[0];
  $('#meEmail').textContent = S.me.email;
  $('#navUsuarios').classList.toggle('hidden', S.me.papel !== 'admin');
  $('#secAdmin').classList.toggle('hidden', S.me.papel !== 'admin');
  if (S.view === 'usuarios' && S.me.papel !== 'admin') S.view = 'painel';
}

async function carregarUsuarios() {
  S.users = await api('/api/users');
}

async function mostrarConvite(token) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginForm').classList.add('hidden');
  $('#conviteForm').classList.remove('hidden');
  try {
    const r = await fetch('/api/convite/' + encodeURIComponent(token)).then(async (x) => {
      const d = await x.json(); if (!x.ok) throw new Error(d.erro); return d;
    });
    $('#conviteEmail').textContent = `Acesso de ${r.email}`;
    $('#conviteNome').value = r.nome || '';
    $('#conviteSenha').focus();
  } catch (err) {
    $('#conviteEmail').textContent = '';
    $('#conviteErro').textContent = err.message;
    $$('#conviteForm input, #conviteForm button').forEach((el) => el.classList.add('hidden'));
    $('#conviteForm').insertAdjacentHTML('beforeend', '<a class="btn" href="/">Ir para o login</a>');
    return;
  }
  $('#conviteForm').onsubmit = async (e) => {
    e.preventDefault();
    const senha = $('#conviteSenha').value;
    if (senha.length < 8) return ($('#conviteErro').textContent = 'A senha precisa ter pelo menos 8 caracteres');
    if (senha !== $('#conviteSenha2').value) return ($('#conviteErro').textContent = 'As senhas não conferem');
    try {
      await api('/api/convite', { method: 'POST', body: { token, senha, nome: $('#conviteNome').value } });
      history.replaceState(null, '', '/');
      $('#conviteForm').classList.add('hidden');
      $('#loginForm').classList.remove('hidden');
      iniciar();
    } catch (err) { $('#conviteErro').textContent = err.message; }
  };
}

function mostrarLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#conviteForm').classList.add('hidden');
  $('#loginForm').classList.remove('hidden');
  $('#modal').open && $('#modal').close();
  ($('#email').value ? $('#senha') : $('#email')).focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { email: $('#email').value, senha: $('#senha').value } });
    $('#loginErro').textContent = '';
    $('#senha').value = '';
    iniciar();
  } catch (err) { $('#loginErro').textContent = err.message; }
});

$('#sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); S.me = null; mostrarLogin(); });
$('#minhaConta').addEventListener('click', () => abrirMinhaConta(false));

async function carregarClientes() {
  S.clients = await api('/api/clients');
  if (S.cliente && !S.clients.some((c) => String(c.id) === String(S.cliente))) S.cliente = '';
  if (!S.cliente && S.clients.length === 1) S.cliente = String(S.clients[0].id);
  $('#fCliente').innerHTML = `<option value="">Todos os clientes</option>` +
    S.clients.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  $('#fCliente').value = S.cliente;
}

$('#fCliente').addEventListener('change', (e) => { S.cliente = e.target.value; localStorageSet('pbh_cliente', S.cliente); render(); });
$('#mesPrev').addEventListener('click', () => mudarMes(-1));
$('#mesNext').addEventListener('click', () => mudarMes(1));
$('#novaTarefa').addEventListener('click', () => abrirTarefa(null, {}));
$$('#nav a').forEach((a) => a.addEventListener('click', () => {
  S.view = a.dataset.grupo === 'tarefas' ? S.viewTarefas : a.dataset.view;
  render();
}));

// Seletor Calendário / Quadro / Lista: três jeitos de ver as mesmas tarefas
const ROTULO_TAREFAS = { calendario: 'Calendário', quadro: 'Quadro', lista: 'Lista' };
function seletorTarefas() {
  return `<div class="seg" role="tablist" aria-label="Forma de ver as tarefas">${VIEWS_TAREFAS.map((k) =>
    `<button role="tab" aria-selected="${S.view === k}" data-vt="${k}" class="${S.view === k ? 'on' : ''}">${ROTULO_TAREFAS[k]}</button>`).join('')}</div>`;
}
function ligarSeletorTarefas(el) {
  $$('[data-vt]', el).forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.vt; render(); }));
}

function mudarMes(delta) {
  const [y, m] = S.mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  S.mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  render();
}

async function carregarTarefas() {
  const q = new URLSearchParams({ mes: S.mes });
  if (S.cliente) q.set('client_id', S.cliente);
  S.tasks = await api('/api/tasks?' + q);
}

async function render() {
  if (VIEWS_TAREFAS.includes(S.view)) { S.viewTarefas = S.view; localStorageSet('pbh_view_tarefas', S.view); }
  localStorageSet('pbh_view', S.view);
  $$('#nav a').forEach((a) => {
    const ativo = a.dataset.grupo === 'tarefas' ? VIEWS_TAREFAS.includes(S.view) : a.dataset.view === S.view;
    a.classList.toggle('active', ativo);
    if (ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#mesLabel').textContent = mesLabel(S.mes);
  const semMes = ['materiais', 'clientes', 'usuarios', 'programacao', 'area'].includes(S.view);
  $('.mes').style.display = semMes ? 'none' : '';
  // "Nova tarefa" só aparece onde faz sentido criar tarefa
  $('#novaTarefa').style.display = ['materiais', 'clientes', 'usuarios', 'programacao'].includes(S.view) ? 'none' : '';
  // filtro de cliente não se aplica à gestão de usuários
  $('#fCliente').style.display = S.view === 'usuarios' ? 'none' : '';
  window.scrollTo({ top: 0 });
  const v = $('#view');
  try {
    if (!['materiais', 'clientes', 'usuarios', 'programacao', 'area'].includes(S.view)) await carregarTarefas();
    ({ painel: viewPainel, calendario: viewCalendario, quadro: viewQuadro, lista: viewLista,
      captacao: viewCaptacao, materiais: viewMateriais, clientes: viewClientes, usuarios: viewUsuarios, programacao: viewProgramacao, area: viewArea })[S.view](v);
  } catch (e) {
    v.innerHTML = `<div class="empty">Não foi possível carregar: ${esc(e.message)}</div>`;
  }
}

// ---------------- Painel ----------------
function viewPainel(v) {
  const doMes = S.tasks.filter((t) => t.data && t.data.startsWith(S.mes));
  const cls = clientesAtivos();
  const metaPosts = cls.reduce((s, c) => s + c.meta_posts, 0);
  const metaBlog = cls.reduce((s, c) => s + c.meta_blog, 0);
  const posts = doMes.filter((t) => t.tipo === 'post');
  const blogs = doMes.filter((t) => t.tipo === 'blog');
  const stories = doMes.filter((t) => t.tipo === 'story');
  const dias = diasNoMes(S.mes);
  const diasComStory = new Set(stories.filter((t) => t.status === 'publicado').map((t) => t.data)).size;
  const metaDiasStory = cls.some((c) => c.meta_stories_dia > 0) ? dias : 0;
  const pub = (arr) => arr.filter((t) => t.status === 'publicado').length;

  const barra = (arr) => {
    const total = arr.length || 1;
    const partes = STATUS.map((s) => [s, arr.filter((t) => t.status === s).length]).filter(([, n]) => n);
    return `<div class="bar">${partes.map(([s, n]) => `<i title="${STATUS_LABEL[s]}: ${n}" style="width:${(n / total) * 100}%;background:${STATUS_COLOR[s]}"></i>`).join('')}</div>
      <div class="legend">${partes.map(([s, n]) => `<span><b style="background:${STATUS_COLOR[s]}"></b>${STATUS_LABEL[s]} ${n}</span>`).join('')}</div>`;
  };

  const alertas = [];
  if (metaPosts && posts.length > metaPosts) alertas.push(['', `Há <b>${posts.length} posts</b> no calendário do mês para uma meta de <b>${metaPosts}</b>. Confira se o excedente é intencional.`]);
  if (metaPosts && posts.length < metaPosts) alertas.push(['', `Faltam <b>${metaPosts - posts.length} posts</b> no calendário para fechar a meta de ${metaPosts}.`]);
  const semTema = posts.filter((t) => !t.tema);
  if (semTema.length) alertas.push(['', `<b>${semTema.length} posts</b> ainda sem tema. O próximo é em ${fmtData(semTema[0].data)}.`]);
  if (metaBlog && blogs.length < metaBlog) alertas.push(['', `Faltam <b>${metaBlog - blogs.length} artigos</b> de blog no mês (meta ${metaBlog}).`]);
  const atrasadas = doMes.filter((t) => t.tipo !== 'story' && t.data < hojeISO && t.status !== 'publicado');
  if (atrasadas.length) alertas.push(['danger', `<b>${atrasadas.length} entregas</b> com data passada ainda não publicadas.`]);
  const capt = S.tasks.filter((t) => t.tipo === 'captacao' && t.status !== 'publicado');
  if (capt.length) alertas.push(['', `<b>${capt.length} captações prioritárias</b> em aberto. <a href="#" data-go="captacao">Ver captação</a>`]);
  if (!alertas.length) alertas.push(['ok', 'Tudo em dia para este mês.']);

  const proximas = doMes
    .filter((t) => t.tipo !== 'story' && t.status !== 'publicado' && t.data >= hojeISO)
    .slice(0, 10);

  v.innerHTML = `
    <div class="view-head"><div><h2>Painel · ${esc(mesLabel(S.mes))}</h2>
      <p>${cls.length === 1 ? esc(cls[0].nome) : 'Todos os clientes'} · pautas e andamento das entregas</p></div></div>
    <div id="pautas"></div>
    <h3 class="secao-h">Metas do mês</h3>
    <div class="grid cols-3">
      <div class="card meta-card"><div class="label"><span class="dot" style="background:var(--post)"></span>Posts no feed</div>
        <div class="big">${pub(posts)}<small> / ${metaPosts} publicados</small></div>
        <div class="muted">${posts.length} no calendário</div>${barra(posts)}</div>
      <div class="card meta-card"><div class="label"><span class="dot" style="background:var(--story)"></span>Stories diários</div>
        <div class="big">${diasComStory}<small> / ${metaDiasStory} dias</small></div>
        <div class="muted">${stories.length} tarefas de stories no mês</div>${barra(stories)}</div>
      <div class="card meta-card"><div class="label"><span class="dot" style="background:var(--blog)"></span>Blog com SEO</div>
        <div class="big">${pub(blogs)}<small> / ${metaBlog} publicados</small></div>
        <div class="muted">${blogs.length} artigos planejados</div>${barra(blogs)}</div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3 style="margin-bottom:8px">Próximas entregas</h3>
        ${proximas.length ? proximas.map(linhaTarefa).join('') : '<div class="empty">Nenhuma entrega pendente a partir de hoje.</div>'}</div>
      <div class="card"><h3 style="margin-bottom:12px">Atenção</h3>
        ${alertas.map(([c, t]) => `<div class="alerta ${c}">${t}</div>`).join('')}</div>
    </div>`;
  ligarLinhas(v);
  $$('[data-go]', v).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); S.view = a.dataset.go; render(); }));
  carregarPautas();
}

// ---------------- Quadros da home: A fazer / Em andamento / Finalizado ----------------
const COLUNAS_PAUTA = [['fazer', 'A fazer'], ['andamento', 'Em andamento'], ['finalizado', 'Finalizado']];
S.pautas = [];

async function carregarPautas() {
  const box = $('#pautas');
  if (!box) return;
  try {
    S.pautas = await api('/api/pautas' + (S.cliente ? '?client_id=' + S.cliente : ''));
    desenharPautas();
  } catch (e) {
    box.innerHTML = `<div class="empty">Não foi possível carregar as pautas: ${esc(e.message)}</div>`;
  }
}

function cardPauta(p) {
  const i = COLUNAS_PAUTA.findIndex(([k]) => k === p.coluna);
  return `<article class="pcard" draggable="true" data-p="${p.id}">
    <div class="pcard-top"><strong class="pcard-nome">${esc(p.nome)}</strong>
      <span class="pcard-mv">${i > 0 ? `<button type="button" data-mv="${p.id}" data-to="${COLUNAS_PAUTA[i - 1][0]}" title="Mover para ${COLUNAS_PAUTA[i - 1][1]}" aria-label="Mover para ${COLUNAS_PAUTA[i - 1][1]}">‹</button>` : ''}${i < COLUNAS_PAUTA.length - 1 ? `<button type="button" data-mv="${p.id}" data-to="${COLUNAS_PAUTA[i + 1][0]}" title="Mover para ${COLUNAS_PAUTA[i + 1][1]}" aria-label="Mover para ${COLUNAS_PAUTA[i + 1][1]}">›</button>` : ''}</span></div>
    ${S.cliente ? '' : `<div class="pcard-cli">${esc(clienteNome(p.client_id))}</div>`}
    ${p.descricao ? `<p class="pcard-desc">${esc(p.descricao)}</p>` : ''}
    <div class="pcard-links">
      ${p.link_pauta ? `<a class="chip-link" href="${esc(p.link_pauta)}" target="_blank" rel="noopener">Pauta ↗</a>` : '<span class="chip-link vazio">Sem link da pauta</span>'}
      ${p.link_imagens ? `<a class="chip-link" href="${esc(p.link_imagens)}" target="_blank" rel="noopener">Imagens ↗</a>` : '<span class="chip-link vazio">Sem imagens</span>'}
    </div>
    <button type="button" class="pcard-edit" data-edit-p="${p.id}">Editar</button>
  </article>`;
}

function desenharPautas() {
  const box = $('#pautas');
  if (!box) return;
  box.innerHTML = `<div class="pboard">${COLUNAS_PAUTA.map(([k, rot]) => {
    const cards = S.pautas.filter((p) => p.coluna === k);
    return `<section class="pcol" data-col="${k}" aria-label="${rot}">
      <header><h4>${rot} <span class="n">${cards.length}</span></h4>
        <button type="button" class="btn small" data-add-p="${k}">+ Adicionar</button></header>
      <div class="pcol-body">${cards.map(cardPauta).join('') || '<div class="pvazio">Nenhuma pauta aqui.</div>'}</div>
    </section>`;
  }).join('')}</div>`;

  $$('[data-add-p]', box).forEach((b) => b.addEventListener('click', () => abrirPauta(null, b.dataset.addP)));
  $$('[data-edit-p]', box).forEach((b) => b.addEventListener('click', () => abrirPauta(S.pautas.find((p) => p.id === Number(b.dataset.editP)))));
  $$('[data-mv]', box).forEach((b) => b.addEventListener('click', () => moverPauta(Number(b.dataset.mv), b.dataset.to)));
  $$('.pcard', box).forEach((c) => c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'p' + c.dataset.p); c.classList.add('arrastando'); }));
  $$('.pcard', box).forEach((c) => c.addEventListener('dragend', () => c.classList.remove('arrastando')));
  $$('.pcol', box).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const raw = e.dataTransfer.getData('text/plain');
      if (raw.startsWith('p')) moverPauta(Number(raw.slice(1)), col.dataset.col);
    });
  });
}

async function moverPauta(id, coluna) {
  const p = S.pautas.find((x) => x.id === id);
  if (!p || p.coluna === coluna) return;
  const antes = p.coluna;
  p.coluna = coluna; desenharPautas();
  try {
    await api('/api/pautas/' + id, { method: 'PUT', body: { coluna } });
    toast(`Movida para ${COLUNAS_PAUTA.find(([k]) => k === coluna)[1]}`);
  } catch (e) { p.coluna = antes; desenharPautas(); toast(e.message); }
}

function abrirPauta(p, colunaPadrao = 'fazer') {
  const novo = !p;
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${novo ? 'Nova pauta' : 'Editar pauta'}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <div class="row">
        <div><label>Cliente</label><select id="pCliente">${S.clients.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
        <div><label>Coluna</label><select id="pColuna">${COLUNAS_PAUTA.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      </div>
      <div><label>Nome da pauta</label><input id="pNome" value="${esc(p?.nome || '')}" placeholder="Ex.: Passeio de buggy em Muro Alto" required></div>
      <div><label>Link da pauta</label><input id="pLink" type="url" value="${esc(p?.link_pauta || '')}" placeholder="https://docs.google.com/…"></div>
      <div><label>Link de imagens da pauta</label><input id="pImg" type="url" value="${esc(p?.link_imagens || '')}" placeholder="https://drive.google.com/…"></div>
      <div><label>Descrição</label><textarea id="pDesc" rows="5" placeholder="O que precisa ser feito, referências, observações…">${esc(p?.descricao || '')}</textarea></div>
    </div>
    <div class="modal-foot"><div>${novo ? '' : '<button type="button" class="btn danger" id="pDel">Excluir</button>'}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="pSalvar">Salvar</button></div></div>
  </form>`;
  $('#pCliente').value = p?.client_id || Number(S.cliente) || S.clients[0]?.id;
  $('#pColuna').value = p?.coluna || colunaPadrao;
  d.showModal();
  $('#pNome').focus();
  $('#pSalvar').addEventListener('click', async () => {
    const body = {
      client_id: Number($('#pCliente').value), coluna: $('#pColuna').value, nome: $('#pNome').value.trim(),
      link_pauta: $('#pLink').value.trim(), link_imagens: $('#pImg').value.trim(), descricao: $('#pDesc').value,
    };
    if (!body.nome) { toast('Informe o nome da pauta'); return $('#pNome').focus(); }
    try {
      if (novo) await api('/api/pautas', { method: 'POST', body });
      else await api('/api/pautas/' + p.id, { method: 'PUT', body });
      d.close(); toast('Pauta salva'); carregarPautas();
    } catch (e) { toast(e.message); }
  });
  $('#pDel')?.addEventListener('click', async () => {
    if (!confirm('Excluir esta pauta?')) return;
    await api('/api/pautas/' + p.id, { method: 'DELETE' }); d.close(); toast('Pauta excluída'); carregarPautas();
  });
}

function linhaTarefa(t) {
  return `<div class="item-row" data-id="${t.id}">
    <div class="data">${t.data ? dowDe(t.data) : ''}<strong>${t.data ? t.data.slice(8) : '—'}</strong></div>
    <div class="grow"><div class="titulo">${esc(tituloTarefa(t))}</div>
      <div class="sub">${S.cliente ? '' : esc(clienteNome(t.client_id)) + ' · '}${esc(t.formato || TIPO_LABEL[t.tipo])}${t.responsavel ? ' · ' + esc(t.responsavel) : ''}</div></div>
    <span class="st ${t.status}">${STATUS_LABEL[t.status]}</span></div>`;
}
function ligarLinhas(el) {
  $$('[data-id]', el).forEach((r) => r.addEventListener('click', () => abrirTarefa(S.tasks.find((t) => t.id === Number(r.dataset.id)))));
}

// ---------------- Calendário ----------------
function viewCalendario(v) {
  const [y, m] = S.mes.split('-').map(Number);
  const primeiro = new Date(y, m - 1, 1).getDay();
  const dias = diasNoMes(S.mes);
  const celulas = Math.ceil((primeiro + dias) / 7) * 7;
  let html = DOW.map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < celulas; i++) {
    const d = i - primeiro + 1;
    if (d < 1 || d > dias) { html += '<div class="day out"></div>'; continue; }
    const iso = `${S.mes}-${String(d).padStart(2, '0')}`;
    const doDia = S.tasks.filter((t) => t.data === iso);
    const st = doDia.filter((t) => t.tipo === 'story');
    const outros = doDia.filter((t) => t.tipo !== 'story');
    html += `<div class="day ${iso === hojeISO ? 'today' : ''}">
      <div class="day-head"><span class="n">${d}</span><button class="add" data-nova="${iso}" title="Nova tarefa">+</button></div>
      ${outros.map((t) => `<div class="chip ${t.tipo} ${t.status === 'publicado' ? 'done' : ''} ${t.tema ? '' : 'vazio'}" data-id="${t.id}" title="${esc(tituloTarefa(t))} · ${STATUS_LABEL[t.status]}">
        ${t.tipo === 'blog' ? 'Blog · ' : t.formato ? esc(t.formato) + ' · ' : ''}${esc((t.tema || 'definir tema').replace(/^Artigo de blog \(SEO\) — /, ''))}</div>`).join('')}
      ${st.map((t) => `<div class="story-dot" data-id="${t.id}" title="${esc(t.editorial || 'Stories')} · ${STATUS_LABEL[t.status]}">
        <span class="dot" style="background:${t.status === 'publicado' ? 'var(--ok)' : 'var(--story)'};width:7px;height:7px"></span>
        Stories${t.status === 'publicado' ? ' ✓' : ''}</div>`).join('')}
    </div>`;
  }
  v.innerHTML = `
    <div class="view-head"><div><h2>Tarefas</h2><p>Clique em um item para editar ou no + para criar no dia.</p></div>${seletorTarefas()}</div>
    <div class="cal">${html}</div>
    <div class="cal-legend">
      <span><span class="dot" style="background:var(--post)"></span> Post no feed</span>
      <span><span class="dot" style="background:var(--blog)"></span> Blog SEO</span>
      <span><span class="dot" style="background:var(--story)"></span> Stories</span>
      <span>Itens riscados já foram publicados</span>
    </div>`;
  ligarLinhas(v);
  ligarSeletorTarefas(v);
  $$('[data-nova]', v).forEach((b) => b.addEventListener('click', () => abrirTarefa(null, { data: b.dataset.nova })));
}

// ---------------- Quadro ----------------
function viewQuadro(v) {
  const filtros = { post: 'Feed', story: 'Stories', blog: 'Blog SEO', captacao: 'Captação', '': 'Todos' };
  const lista = S.tasks.filter((t) => !S.quadroTipo || t.tipo === S.quadroTipo);
  v.innerHTML = `
    <div class="view-head"><div><h2>Tarefas</h2><p>Arraste os cartões para mudar a etapa.</p></div>${seletorTarefas()}</div>
    <div class="subbar"><span class="muted">Mostrar:</span>
      <div class="seg">${Object.entries(filtros).map(([k, l]) => `<button data-tipo="${k}" class="${S.quadroTipo === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="board">${STATUS.map((s) => {
    const cards = lista.filter((t) => t.status === s);
    return `<div class="col" data-status="${s}"><h4>${STATUS_LABEL[s]}<span>${cards.length}</span></h4>
        ${cards.map((t) => `<div class="kcard" draggable="true" data-id="${t.id}">
          <div class="meta"><span class="tag ${t.tipo}">${TIPO_LABEL[t.tipo]}</span>${t.prioridade === 'alta' ? '<span class="tag alta">Prioridade</span>' : ''}
            <span>${t.data ? fmtData(t.data) + ' ' + dowDe(t.data) : ''}</span></div>
          <div class="t">${esc(tituloTarefa(t))}</div>
          <div class="meta">${t.formato ? esc(t.formato) : ''}${t.responsavel ? ' · ' + esc(t.responsavel) : ''}${S.cliente ? '' : ' · ' + esc(clienteNome(t.client_id))}</div>
        </div>`).join('')}</div>`;
  }).join('')}</div>`;
  ligarSeletorTarefas(v);
  $$('[data-tipo]', v).forEach((b) => b.addEventListener('click', () => { S.quadroTipo = b.dataset.tipo; viewQuadro(v); }));
  $$('.kcard', v).forEach((c) => {
    c.addEventListener('click', () => abrirTarefa(S.tasks.find((t) => t.id === Number(c.dataset.id))));
    c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.dataset.id));
  });
  $$('.col', v).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const t = S.tasks.find((x) => x.id === id);
      if (!t || t.status === col.dataset.status) return;
      t.status = col.dataset.status;
      viewQuadro(v);
      try { await api('/api/tasks/' + id, { method: 'PUT', body: { status: t.status } }); toast(`Movido para ${STATUS_LABEL[t.status]}`); }
      catch (err) { toast(err.message); render(); }
    });
  });
}

// ---------------- Lista ----------------
function viewLista(v) {
  const f = S.listaFiltro;
  const b = f.busca.toLowerCase();
  const lista = S.tasks.filter((t) => (!f.tipo || t.tipo === f.tipo) && (!f.status || t.status === f.status) &&
    (!b || [t.tema, t.legenda, t.editorial, t.responsavel, t.briefing].some((x) => (x || '').toLowerCase().includes(b))));
  v.innerHTML = `
    <div class="view-head"><div><h2>Tarefas</h2><p>${lista.length} itens em ${esc(mesLabel(S.mes))} (inclui tarefas sem data)</p></div>${seletorTarefas()}</div>
    <div class="subbar">
      <div class="toolbar">
        <input id="lBusca" placeholder="Buscar tema, legenda, responsável…" value="${esc(f.busca)}" style="width:240px">
        <select id="lTipo" style="width:auto"><option value="">Todos os tipos</option>${Object.entries(TIPO_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select id="lStatus" style="width:auto"><option value="">Todas as etapas</option>${STATUS.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select>
      </div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Tipo</th><th>Tema</th><th>Formato</th><th>Editorial</th><th>Responsável</th><th>Etapa</th></tr></thead>
      <tbody>${lista.map((t) => `<tr data-id="${t.id}">
        <td>${t.data ? fmtData(t.data) + ' <span class="muted">' + dowDe(t.data) + '</span>' : '<span class="muted">—</span>'}</td>
        <td><span class="tag ${t.tipo}">${TIPO_LABEL[t.tipo]}</span></td>
        <td>${esc(tituloTarefa(t))}${S.cliente ? '' : '<div class="muted">' + esc(clienteNome(t.client_id)) + '</div>'}</td>
        <td>${esc(t.formato || '')}</td><td>${esc(t.editorial || '')}</td><td>${esc(t.responsavel || '')}</td>
        <td><span class="st ${t.status}">${STATUS_LABEL[t.status]}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nada encontrado.</td></tr>'}</tbody>
    </table></div>`;
  $('#lTipo').value = f.tipo; $('#lStatus').value = f.status;
  $('#lTipo').addEventListener('change', (e) => { f.tipo = e.target.value; viewLista(v); });
  $('#lStatus').addEventListener('change', (e) => { f.status = e.target.value; viewLista(v); });
  $('#lBusca').addEventListener('input', (e) => {
    f.busca = e.target.value; clearTimeout(viewLista._t);
    viewLista._t = setTimeout(() => { viewLista(v); const i = $('#lBusca'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  });
  ligarLinhas(v);
  ligarSeletorTarefas(v);
}

// ---------------- Captação ----------------
function viewCaptacao(v) {
  const lista = S.tasks.filter((t) => t.tipo === 'captacao')
    .sort((a, b) => (a.status === 'publicado') - (b.status === 'publicado') || (b.prioridade === 'alta') - (a.prioridade === 'alta'));
  v.innerHTML = `
    <div class="view-head"><div><h2>Captação de fotos e vídeos</h2><p>Pautas de produção de material. Marque cada item conforme for captado.</p></div>
      <button class="btn" id="novaCapt">+ Nova captação</button></div>
    <div class="grid cols-3">${lista.map((t) => {
    const feitos = t.checklist.filter((c) => c.feito).length;
    return `<div class="card">
        <div class="meta" style="display:flex;gap:6px;margin-bottom:8px">${t.prioridade === 'alta' ? '<span class="tag alta">Prioridade</span>' : ''}<span class="st ${t.status}">${STATUS_LABEL[t.status]}</span></div>
        <h3 style="margin-bottom:6px">${esc(t.tema || 'Captação')}</h3>
        <div class="progress-txt">${feitos} de ${t.checklist.length} itens captados${S.cliente ? '' : ' · ' + esc(clienteNome(t.client_id))}</div>
        <div class="bar"><i style="width:${t.checklist.length ? (feitos / t.checklist.length) * 100 : 0}%;background:var(--captacao)"></i></div>
        <div class="checklist" style="margin:10px 0">${t.checklist.map((c, i) => `<label class="check ${c.feito ? 'feito' : ''}" style="text-transform:none;font-weight:400;font-size:14px;color:var(--ink)">
          <input type="checkbox" data-t="${t.id}" data-i="${i}" ${c.feito ? 'checked' : ''}><span>${esc(c.texto)}</span></label>`).join('')}</div>
        <button class="btn small" data-id="${t.id}">Abrir detalhes</button></div>`;
  }).join('') || '<div class="empty">Nenhuma captação cadastrada.</div>'}</div>`;
  ligarLinhas(v);
  $('#novaCapt').addEventListener('click', () => abrirTarefa(null, { tipo: 'captacao', formato: 'captação', prioridade: 'alta', data: '' }));
  $$('input[data-t]', v).forEach((cb) => cb.addEventListener('change', async () => {
    const t = S.tasks.find((x) => x.id === Number(cb.dataset.t));
    t.checklist[Number(cb.dataset.i)].feito = cb.checked;
    const todos = t.checklist.every((c) => c.feito);
    const body = { checklist: t.checklist };
    if (todos && t.status !== 'publicado') body.status = 'publicado';
    await api('/api/tasks/' + t.id, { method: 'PUT', body });
    if (todos) toast('Captação concluída');
    render();
  }));
}

// ---------------- Materiais ----------------
// Botões de materiais (pastas e arquivos do Drive), agrupados por categoria
function tipoMaterial(m) {
  if (/\/file\//.test(m.url)) return ['FOTO', '#b4532a', 'Arquivo do Drive'];
  if (/v[ií]deo/i.test(`${m.descricao} ${m.categoria}`)) return ['▶', '#7b5ea7', 'Pasta de vídeos'];
  return ['▤', '#188038', 'Pasta do Drive'];
}

function materiaisHTML(mats, busca = '') {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const b = norm(busca.trim());
  const filtrados = mats.filter((m) => !b || norm(`${m.categoria} ${m.descricao}`).includes(b));
  const grupos = {};
  filtrados.forEach((m) => { (grupos[m.categoria || 'Sem categoria'] ||= []).push(m); });
  if (!filtrados.length) return `<div class="empty" style="padding:20px">${mats.length ? 'Nada encontrado para essa busca.' : 'Nenhum material cadastrado.'}</div>`;
  return Object.entries(grupos).map(([cat, arr]) => `<details class="mat-cat" open>
    <summary>${esc(cat)} <span class="tag">${arr.length}</span></summary>
    <div class="atalhos">${arr.map((m) => { const [ic, cor, tipo] = tipoMaterial(m); return `
      <a class="atalho ${m.evitar ? 'evitar' : ''}" href="${esc(m.url)}" target="_blank" rel="noopener" title="Abrir no Drive">
        <span class="ic" style="background:${cor};${ic.length > 2 ? 'font-size:9px' : ''}">${ic}</span>
        <span class="tx"><strong>${esc(m.descricao || 'Material')}</strong><span>${m.evitar ? 'Evitar / usar com cuidado' : tipo}</span></span>
        <span class="acoes"><button type="button" data-copy="${esc(m.url)}" title="Copiar link">⧉</button><button type="button" data-edit="${m.id}" title="Editar">✎</button></span>
      </a>`; }).join('')}</div></details>`).join('');
}

function ligarMateriais(el, mats) {
  $$('[data-copy]', el).forEach((bt) => bt.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(bt.dataset.copy); toast('Link copiado');
  }));
  $$('[data-edit]', el).forEach((bt) => bt.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); abrirMaterial(mats.find((m) => m.id === Number(bt.dataset.edit)), mats);
  }));
}

async function viewMateriais(v) {
  const q = S.cliente ? '?client_id=' + S.cliente : '';
  const mats = await api('/api/materials' + q);
  v.innerHTML = `
    <div class="view-head"><div><h2>Materiais</h2><p>${mats.length} pastas e arquivos no Drive${S.cliente ? '' : ' de todos os clientes'}. Clique no botão para abrir.</p></div>
      <div class="toolbar"><input id="mBusca" placeholder="Buscar: piscina, café, casal…" value="${esc(S.matBusca)}" style="width:240px">
      <button class="btn primary" id="novoMat">+ Adicionar material</button></div></div>
    <div id="mLista">${materiaisHTML(mats, S.matBusca)}</div>`;
  const lista = $('#mLista');
  ligarMateriais(lista, mats);
  $('#mBusca').addEventListener('input', (e) => {
    S.matBusca = e.target.value; lista.innerHTML = materiaisHTML(mats, S.matBusca); ligarMateriais(lista, mats);
  });
  $('#novoMat').addEventListener('click', () => abrirMaterial(null, mats));
}

function abrirMaterial(m, todos) {
  const cats = [...new Set(todos.map((x) => x.categoria).filter(Boolean))];
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${m ? 'Editar material' : 'Novo material'}</h3><button class="icon" value="x">×</button></div>
    <div class="modal-body">
      ${m ? '' : `<div><label>Cliente</label><select id="mmCliente">${S.clients.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>`}
      <div><label>Link do Drive</label><input id="mmUrl" required value="${esc(m?.url || '')}" placeholder="https://drive.google.com/…"></div>
      <div class="row"><div><label>Categoria</label><input id="mmCat" list="mmCats" value="${esc(m?.categoria || '')}"><datalist id="mmCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div><label>Nome do botão (do que se trata)</label><input id="mmDesc" value="${esc(m?.descricao || '')}" placeholder="Ex.: Casal na praia ao entardecer"></div></div>
      <label class="check" style="text-transform:none;font-weight:400;font-size:14px;color:var(--ink)"><input type="checkbox" id="mmEvitar" ${m?.evitar ? 'checked' : ''}><span>Evitar / usar com cuidado</span></label>
    </div>
    <div class="modal-foot"><div>${m ? '<button type="button" class="btn danger" id="mmDel">Excluir</button>' : ''}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="mmSalvar">Salvar</button></div></div>
  </form>`;
  if (!m && S.cliente) $('#mmCliente').value = S.cliente;
  d.showModal();
  $('#mmSalvar').addEventListener('click', async () => {
    const body = { url: $('#mmUrl').value.trim(), categoria: $('#mmCat').value.trim(), descricao: $('#mmDesc').value.trim(), evitar: $('#mmEvitar').checked };
    if (!body.url) return toast('Informe o link');
    try {
      if (m) await api('/api/materials/' + m.id, { method: 'PUT', body });
      else await api('/api/materials', { method: 'POST', body: { ...body, client_id: Number($('#mmCliente').value) } });
      d.close(); toast('Material salvo'); render();
    } catch (e) { toast(e.message); }
  });
  $('#mmDel')?.addEventListener('click', async () => {
    if (!confirm('Excluir este material?')) return;
    await api('/api/materials/' + m.id, { method: 'DELETE' }); d.close(); toast('Material excluído'); render();
  });
}

// ---------------- Clientes ----------------
function viewClientes(v) {
  v.innerHTML = `
    <div class="view-head"><div><h2>Clientes e contratos</h2><p>Metas mensais, marcas e dados de contato usados nas peças.</p></div>
      <button class="btn primary" id="novoCliente">+ Novo cliente</button></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
    ${S.clients.map((c) => `<div class="card" data-c="${c.id}">
      <h3 style="margin-bottom:12px">${esc(c.nome)}</h3>
      <div style="display:grid;gap:10px">
        <div><label>Nome</label><input data-f="nome" value="${esc(c.nome)}"></div>
        <div><label>Marcas / empreendimentos (separe por vírgula)</label><input data-f="marcas" value="${esc((c.marcas || []).join(', '))}"></div>
        <div class="row"><div><label>Site</label><input data-f="site" value="${esc(c.site || '')}"></div>
          <div><label>WhatsApp</label><input data-f="whatsapp" value="${esc(c.whatsapp || '')}"></div></div>
        <div><label>Instagram</label><input data-f="instagram" value="${esc(c.instagram || '')}" placeholder="@perfil"></div>
        <div><label>Planilha de programação (Google Sheets)</label><input data-f="planilha_url" value="${esc(c.planilha_url || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></div>
        <div class="row"><div><label>Posts / mês</label><input type="number" min="0" data-f="meta_posts" value="${c.meta_posts}"></div>
          <div><label>Stories / dia</label><input type="number" min="0" data-f="meta_stories_dia" value="${c.meta_stories_dia}"></div>
          <div><label>Blog / mês</label><input type="number" min="0" data-f="meta_blog" value="${c.meta_blog}"></div></div>
        <div><label>Observações / rodapé padrão</label><textarea data-f="observacoes">${esc(c.observacoes || '')}</textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary small" data-salvar>Salvar</button>
          <button class="btn small" data-gerar>Gerar estrutura de ${esc(mesLabel(S.mes))}</button>
          <button class="btn small primary" data-semana>Gerar semana</button>
          <button class="btn small" data-contexto>Contexto do agente</button>
          <button class="btn small" data-pautas>Sugerir pautas de ${esc(mesLabel(S.mes))}</button>
        </div>
      </div></div>`).join('')}
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Backup dos dados</h3>
      <p class="muted" style="margin:6px 0 12px">Baixe uma cópia de todos os dados com frequência. Se algo der errado, restaure o arquivo aqui.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="/api/backup" download>Baixar backup (.json)</a>
        <label class="btn ${S.me.papel === 'admin' ? '' : 'hidden'}" style="margin:0;text-transform:none;font-size:14px;color:var(--ink);letter-spacing:0">Restaurar backup<input type="file" id="restaurar" accept="application/json" hidden></label>
      </div>
    </div>`;

  $$('[data-c]', v).forEach((card) => {
    const id = Number(card.dataset.c);
    const dados = () => {
      const o = {};
      $$('[data-f]', card).forEach((i) => {
        const f = i.dataset.f;
        o[f] = f === 'marcas' ? i.value.split(',').map((s) => s.trim()).filter(Boolean)
          : i.type === 'number' ? Number(i.value) : i.value;
      });
      return o;
    };
    $('[data-salvar]', card).addEventListener('click', async () => {
      try { await api('/api/clients/' + id, { method: 'PUT', body: dados() }); await carregarClientes(); toast('Cliente salvo'); viewClientes(v); }
      catch (e) { toast(e.message); }
    });
    $('[data-semana]', card).addEventListener('click', () => abrirSemanaAgente(id));
    $('[data-contexto]', card).addEventListener('click', () => abrirContextoAgente(id));
    $('[data-pautas]', card).addEventListener('click', () => abrirPautasAgente(id));
    $('[data-gerar]', card).addEventListener('click', async () => {
      const r = await api(`/api/clients/${id}/gerar-mes`, { method: 'POST', body: { mes: S.mes } });
      const c = r.criados;
      const total = c.post + c.story + c.blog;
      toast(total ? `Criados: ${c.post} posts, ${c.story} stories, ${c.blog} artigos` : 'Este mês já tinha estrutura criada');
    });
  });
  $('#novoCliente').addEventListener('click', async () => {
    const nome = prompt('Nome do cliente');
    if (!nome) return;
    await api('/api/clients', { method: 'POST', body: { nome } });
    await carregarClientes(); viewClientes(v); toast('Cliente criado');
  });
  $('#restaurar').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!confirm('Restaurar substitui TODOS os dados atuais pelos do arquivo. Continuar?')) return;
    try {
      const r = await api('/api/restaurar', { method: 'POST', body: JSON.parse(await f.text()) });
      await carregarClientes(); toast(`Restaurado: ${r.clientes} clientes, ${r.tarefas} tarefas`); viewClientes(v);
    } catch (err) { toast(err.message); }
  });
}

// ---------------- Agente de conteúdo: contexto e pautas do cliente ----------------
const CAMPOS_CONTEXTO = [
  ['tom_de_voz', 'Tom de voz', 'Ex.: acolhedor, elegante, sem gírias; fala com o hóspede como um anfitrião…', 3],
  ['publico', 'Público', 'Quem lê: famílias, casais, investidores, de onde vêm…', 3],
  ['pilares', 'Pilares de conteúdo', 'Um por linha: experiência do hóspede, programação dos resorts, datas especiais…', 4],
  ['conhecimento', 'Base de conhecimento (fatos confirmados)', 'Um fato por linha: unidades, comodidades, distâncias, políticas, diferenciais. O agente só afirma o que estiver aqui, na planilha ou no briefing.', 8],
  ['regras', 'Regras do cliente (o agente sempre obedece)', 'O que dizer, o que nunca dizer, avisos obrigatórios, termos proibidos…', 5],
  ['rodape', 'Rodapé padrão das legendas', 'Texto fixo no fim das legendas', 3],
  ['exemplos', 'Exemplos de posts aprovados (opcional)', 'Cole 2 ou 3 legendas que o cliente adorou. O agente imita o jeito de escrever.', 6],
];

async function abrirContextoAgente(clientId) {
  const cl = S.clients.find((c) => c.id === clientId);
  const d = $('#modal');
  let ctx; let comp = [];
  try { [ctx, comp] = await Promise.all([api(`/api/clients/${clientId}/contexto`), api('/api/agente/competencias')]); } catch (e) { return toast(e.message); }
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>Contexto do agente · ${esc(cl.nome)}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">Quanto melhor este contexto, melhor o texto. O agente também lê as marcas, a programação dos resorts, os materiais marcados para evitar e os posts que a equipe já aprovou.</p>
      <details class="ia-comp"><summary>Competências do agente (${comp.length})</summary>
        <ul>${comp.map((c) => `<li><strong>${esc(c.nome)}.</strong> ${esc(c.descricao)}</li>`).join('')}</ul></details>
      ${CAMPOS_CONTEXTO.map(([k, l, ph, r]) => `<div><label>${l}</label><textarea data-k="${k}" rows="${r}" placeholder="${esc(ph)}">${esc(ctx[k] || '')}</textarea></div>`).join('')}
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="ctxSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#ctxSalvar').addEventListener('click', async () => {
    const body = {};
    $$('[data-k]', d).forEach((i) => { body[i.dataset.k] = i.value.trim(); });
    try { await api(`/api/clients/${clientId}/contexto`, { method: 'PUT', body }); d.close(); toast('Contexto salvo'); } catch (e) { toast(e.message); }
  });
}

async function abrirPautasAgente(clientId) {
  const cl = S.clients.find((c) => c.id === clientId);
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>Pautas sugeridas · ${esc(cl.nome)} · ${esc(mesLabel(S.mes))}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body" id="pautasCorpo"><div class="empty">Pensando nas pautas do mês… pode levar até um minuto.</div></div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary hidden" id="pautasAplicar">Aplicar selecionadas</button></div></div>
  </form>`;
  d.showModal();
  let r;
  try { r = await api('/api/agente/pautas', { method: 'POST', body: { client_id: clientId, mes: S.mes } }); }
  catch (e) { $('#pautasCorpo').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!r.pautas.length) { $('#pautasCorpo').innerHTML = `<div class="empty">${esc(r.aviso || 'Nenhuma pauta sugerida.')}</div>`; return; }
  $('#pautasCorpo').innerHTML = `<p class="muted" style="margin:0">Marque as que quiser aplicar. Você pode ajustar o tema antes. Nada é criado sem o seu clique.</p>` +
    r.pautas.map((p, i) => `<div class="pauta" data-i="${i}">
      <label class="check" style="text-transform:none;font-weight:400"><input type="checkbox" checked>
        <span><strong>${esc(fmtData(p.data))} · ${esc(p.formato)}</strong> · <em>${esc(p.editorial)}</em></span></label>
      <input class="pauta-tema" value="${esc(p.tema)}"><div class="muted" style="font-size:12px">${esc(p.motivo)}</div></div>`).join('');
  $('#pautasAplicar').classList.remove('hidden');
  $('#pautasAplicar').addEventListener('click', async () => {
    const marcadas = $$('.pauta', d).filter((el) => $('input[type=checkbox]', el).checked);
    if (!marcadas.length) return toast('Marque ao menos uma pauta');
    try {
      await Promise.all(marcadas.map((el) => {
        const p = r.pautas[Number(el.dataset.i)];
        return api('/api/tasks/' + p.task_id, { method: 'PUT', body: { tema: $('.pauta-tema', el).value.trim(), editorial: p.editorial, formato: p.formato } });
      }));
      d.close(); toast(`${marcadas.length} pautas aplicadas`); render();
    } catch (e) { toast(e.message); }
  });
}


const proximaSegunda = () => {
  const d = new Date(hojeISO + 'T12:00');
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function abrirSemanaAgente(clientId) {
  const cl = S.clients.find((c) => c.id === clientId);
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>Conteúdo da semana · ${esc(cl.nome)}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body" id="semCorpo">
      <p class="muted" style="margin:0">O agente escreve a semana inteira (posts, roteiros de stories e pauta de blog) seguindo a meta do contrato, a programação dos resorts e o que já foi publicado. Leva cerca de um minuto.</p>
      <div class="row"><div><label>Semana de (qualquer dia da semana)</label><input type="date" id="semInicio" value="${proximaSegunda()}"></div>
        <div style="flex:2"><label>Pedido para esta semana (opcional)</label><input id="semFoco" placeholder="Ex.: destacar a programação de Halloween e o buggy na praia"></div></div>
      <div><button type="button" class="btn primary" id="semGerar">Gerar semana</button></div>
      <div id="semSaida"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary hidden" id="semAplicar">Aplicar selecionadas</button></div></div>
  </form>`;
  d.showModal();
  let resultado = null;
  $('#semGerar').addEventListener('click', async () => {
    const bt = $('#semGerar');
    if (!$('#semInicio').value) return toast('Escolha a semana');
    bt.disabled = true; bt.textContent = 'Gerando a semana…';
    $('#semSaida').innerHTML = '<div class="empty">Escrevendo posts, stories e pauta do blog… não feche esta janela.</div>';
    $('#semAplicar').classList.add('hidden');
    try {
      resultado = await api('/api/agente/semana', { method: 'POST', body: { client_id: clientId, inicio: $('#semInicio').value, foco: $('#semFoco').value.trim() } });
      desenharSemana();
    } catch (e) { $('#semSaida').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    finally { bt.disabled = false; bt.textContent = 'Gerar de novo'; }
  });
  const desenharSemana = () => {
    const r = resultado;
    if (!r.itens.length) { $('#semSaida').innerHTML = `<div class="empty">${esc(r.aviso || 'Nada para gerar nesta semana.')}</div>`; return; }
    const ROT = { post: 'Feed', story: 'Stories', blog: 'Blog' };
    $('#semSaida').innerHTML = `
      <div class="ia-res">
        <div class="ia-txt" style="max-height:none"><strong>Foco da semana ${esc(fmtData(r.inicio))} a ${esc(fmtData(r.fim))}.</strong> ${esc(r.foco)}</div>
        ${r.conferir_geral?.length ? `<div class="ia-conferir"><strong>Pendências da semana</strong><ul>${r.conferir_geral.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
        <div><button type="button" class="btn" id="semCopiar">Copiar pautas dos posts marcados</button></div>
        ${r.itens.map((i, n) => `<div class="pauta" data-n="${n}">
          <label class="check" style="text-transform:none;font-weight:400"><input type="checkbox" checked>
            <span><strong>${esc(dowDe(i.data))} ${esc(fmtData(i.data))}</strong> · <span class="tag ${i.tipo}">${ROT[i.tipo]}</span> ${esc(i.formato)} · <em>${esc(i.editorial || '')}</em></span></label>
          <input class="pauta-tema" value="${esc(i.tema)}">
          <div class="muted" style="font-size:12px">${esc(i.motivo)}</div>
          <details><summary>Ver texto e roteiro</summary>
            ${i.legenda ? `<div class="ia-txt">${esc(i.legenda)}</div>` : ''}
            ${i.briefing ? `<div class="ia-txt" style="margin-top:6px">${esc(i.briefing)}</div>` : ''}
            ${i.conferir?.length ? `<div class="ia-conferir" style="margin-top:6px"><strong>Conferir</strong><ul>${i.conferir.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
          </details></div>`).join('')}
      </div>`;
    $('#semAplicar').classList.remove('hidden');
    $('#semCopiar').addEventListener('click', async () => {
      const txt = $$('#semSaida .pauta', d).filter((el) => $('input[type=checkbox]', el).checked)
        .map((el) => resultado.itens[Number(el.dataset.n)]).filter((i) => i.pauta).map((i) => i.pauta).join('\n\n\n');
      if (!txt) return toast('Marque ao menos um post');
      try { await navigator.clipboard.writeText(txt); toast('Pautas copiadas'); } catch { toast('Não consegui copiar; selecione o texto manualmente'); }
    });
  };
  $('#semAplicar').addEventListener('click', async () => {
    const marcados = $$('#semSaida .pauta', d).filter((el) => $('input[type=checkbox]', el).checked);
    if (!marcados.length) return toast('Marque ao menos uma peça');
    const itens = marcados.map((el) => ({ ...resultado.itens[Number(el.dataset.n)], tema: $('.pauta-tema', el).value.trim() }));
    try {
      const r = await api('/api/agente/semana/aplicar', { method: 'POST', body: { client_id: clientId, itens } });
      d.close(); toast(`Semana aplicada: ${r.atualizadas} tarefas preenchidas, ${r.criadas} novas`); render();
    } catch (e) { toast(e.message); }
  });
}

// ---------------- Modal de tarefa ----------------
function abrirTarefa(t, padrao = {}) {
  const novo = !t;
  t = t ? structuredClone(t) : {
    client_id: Number(S.cliente) || S.clients[0]?.id, tipo: 'post', formato: '', data: hojeISO, status: 'pauta',
    prioridade: 'normal', checklist: [], ...padrao,
  };
  const d = $('#modal');
  const linkify = (s) => (s || '').split(/\s+/).filter((u) => /^https?:\/\//.test(u))
    .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${novo ? 'Nova tarefa' : esc(tituloTarefa(t))}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="detalhes" class="on">Detalhes</button>
      <button type="button" role="tab" data-tab="conteudo">Conteúdo</button>
      <button type="button" role="tab" data-tab="materiais">Materiais<span class="n" id="nMateriais"></span></button>
    </div>
    <div class="modal-body">
     <div class="tab-pane on" data-pane="detalhes">
      <div class="row">
        <div><label>Cliente</label><select id="tCliente">${S.clients.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
        <div><label>Tipo</label><select id="tTipo">${Object.entries(TIPO_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div><label>Formato</label><input id="tFormato" list="formatos" value="${esc(t.formato || '')}"><datalist id="formatos">${FORMATOS.map((f) => `<option value="${f}">`).join('')}</datalist></div>
      </div>
      <div class="row">
        <div><label>Data</label><input type="date" id="tData" value="${t.data || ''}"></div>
        <div><label>Etapa</label><select id="tStatus">${STATUS.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select></div>
        <div><label>Prioridade</label><select id="tPrio"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></div>
        <div><label>Responsável</label><input id="tResp" list="pessoas" value="${esc(t.responsavel || '')}"><datalist id="pessoas">${S.users.filter((u) => u.ativo).map((u) => `<option value="${esc(u.nome || u.email)}">`).join('')}</datalist></div>
      </div>
      <div class="row">
        <div><label>Tema</label><input id="tTema" value="${esc(t.tema || '')}"></div>
        <div><label>Editorial</label><input id="tEditorial" value="${esc(t.editorial || '')}" list="editoriais"><datalist id="editoriais">
          <option value="Experiência do cliente / hospedagens"><option value="Dicas de conteúdos para hóspedes e investidores"><option value="Datas especiais"><option value="Programação dos resorts"></datalist></div>
      </div>
      <div id="kwWrap"><label>Palavra-chave SEO</label><input id="tKw" value="${esc(t.palavra_chave || '')}" placeholder="Ex.: apartamento em Muro Alto"></div>
     </div>
     <div class="tab-pane" data-pane="conteudo">
      <div class="ia-box">
        <div class="ia-head"><div><strong>Agente de conteúdo</strong><span class="muted"> · escreve a partir do tema, do briefing e do contexto do cliente</span></div>
          <button type="button" class="btn small primary" id="iaGerar">Gerar com IA</button></div>
        <div id="iaSaida"></div>
      </div>
      <div><label id="lblLegenda">Legenda / texto</label><textarea id="tLegenda" rows="8">${esc(t.legenda || '')}</textarea>
        <div class="counter"><span id="cont"></span><button type="button" id="copiar">Copiar texto</button></div></div>
      <div><label>Briefing visual / roteiro</label><textarea id="tBriefing" rows="6">${esc(t.briefing || '')}</textarea></div>
     </div>
     <div class="tab-pane" data-pane="materiais">
      <div><label>Links de material (um por linha)</label><textarea id="tLinks" rows="3" style="min-height:60px">${esc(t.links || '')}</textarea>
        <div class="linkified" id="linksVis">${linkify(t.links)}</div></div>
      <div><label>Checklist</label><div class="checklist" id="chk"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="chkNovo" placeholder="Adicionar item"><button type="button" class="btn small" id="chkAdd">Adicionar</button></div></div>
     </div>
    </div>
    <div class="modal-foot">
      <div>${novo ? '' : '<button type="button" class="btn danger" id="tDel">Excluir</button>'}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="tSalvar">Salvar</button></div>
    </div></form>`;

  $('#tCliente').value = t.client_id; $('#tTipo').value = t.tipo; $('#tStatus').value = t.status; $('#tPrio').value = t.prioridade;
  const ajustarTipo = () => {
    const tipo = $('#tTipo').value;
    $('#kwWrap').style.display = tipo === 'blog' ? '' : 'none';
    $('#lblLegenda').textContent = tipo === 'blog' ? 'Texto do artigo' : tipo === 'captacao' ? 'Descrição da captação' : 'Legenda';
  };
  ajustarTipo();
  $('#tTipo').addEventListener('change', ajustarTipo);

  // Abas do modal: Detalhes · Conteúdo · Materiais
  const irParaAba = (nome) => {
    $$('.tabs [data-tab]', d).forEach((b) => { const on = b.dataset.tab === nome; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $$('.tab-pane', d).forEach((p) => p.classList.toggle('on', p.dataset.pane === nome));
  };
  $$('.tabs [data-tab]', d).forEach((b) => b.addEventListener('click', () => irParaAba(b.dataset.tab)));
  const contarMateriais = () => {
    const links = ($('#tLinks').value.match(/https?:\/\/\S+/g) || []).length;
    const n = links + t.checklist.length;
    $('#nMateriais').textContent = n || '';
  };

  const contar = () => {
    const txt = $('#tLegenda').value;
    const hashtags = (txt.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    const palavras = (txt.trim().match(/\S+/g) || []).length;
    $('#cont').textContent = $('#tTipo').value === 'blog'
      ? `${palavras} palavras`
      : `${txt.length} / 2200 caracteres · ${hashtags} hashtags`;
  };
  contar();
  $('#tLegenda').addEventListener('input', contar);
  $('#copiar').addEventListener('click', () => { navigator.clipboard.writeText($('#tLegenda').value); toast('Texto copiado'); });
  $('#tLinks').addEventListener('input', (e) => { $('#linksVis').innerHTML = linkify(e.target.value); contarMateriais(); });

  const desenharChk = () => {
    $('#chk').innerHTML = t.checklist.map((c, i) => `<div class="check ${c.feito ? 'feito' : ''}">
      <input type="checkbox" data-i="${i}" ${c.feito ? 'checked' : ''}><span>${esc(c.texto)}</span><button type="button" class="rm" data-rm="${i}">×</button></div>`).join('')
      || '<span class="muted">Sem itens.</span>';
    $$('#chk input').forEach((cb) => cb.addEventListener('change', () => { t.checklist[cb.dataset.i].feito = cb.checked; desenharChk(); }));
    $$('#chk [data-rm]').forEach((b) => b.addEventListener('click', () => { t.checklist.splice(Number(b.dataset.rm), 1); desenharChk(); }));
    contarMateriais();
  };
  desenharChk();
  const addChk = () => { const v = $('#chkNovo').value.trim(); if (v) { t.checklist.push({ texto: v, feito: false }); $('#chkNovo').value = ''; desenharChk(); } };
  $('#chkAdd').addEventListener('click', addChk);
  $('#chkNovo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChk(); } });

  // ----- Agente de conteúdo -----
  const MARCA_IA = '── Sugestão do agente ──';
  const ia = { id: null, resultado: null, usado: null };
  const dadosIA = () => ({
    client_id: Number($('#tCliente').value), task_id: novo ? null : t.id, tipo: $('#tTipo').value,
    formato: $('#tFormato').value.trim(), data: $('#tData').value || null, tema: $('#tTema').value.trim(),
    editorial: $('#tEditorial').value.trim(), palavra_chave: $('#tKw').value.trim(),
    briefing: $('#tBriefing').value.split(MARCA_IA)[0].trim(),
  });
  const desenharIA = () => {
    const r = ia.resultado;
    if (!r) { $('#iaSaida').innerHTML = ''; return; }
    $('#iaSaida').innerHTML = `<div class="ia-res">
      ${r.conferir?.length ? `<div class="ia-conferir"><strong>Conferir antes de publicar</strong><ul>${r.conferir.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      ${r.legenda ? `<label>Texto sugerido</label><div class="ia-txt">${esc(r.legenda)}</div>` : ''}
      ${r.briefing ? `<label>Direção visual / roteiro</label><div class="ia-txt">${esc(r.briefing)}</div>` : ''}
      ${r.alternativas?.length ? `<label>Ganchos alternativos</label><ul class="ia-alt">${r.alternativas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <div class="ia-acoes">
        <button type="button" class="btn small primary" id="iaUsar">Usar na tarefa</button>
        <input id="iaAjuste" placeholder="Pedir ajuste: mais curto, mais emocional, citar o buggy…">
        <button type="button" class="btn small" id="iaReescrever">Reescrever</button>
      </div></div>`;
    $('#iaUsar').addEventListener('click', usarIA);
    $('#iaReescrever').addEventListener('click', () => {
      const f = $('#iaAjuste').value.trim();
      if (!f) return toast('Escreva o ajuste que você quer');
      gerarIA(f);
    });
    $('#iaAjuste').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#iaReescrever').click(); } });
  };
  const gerarIA = async (feedback = '') => {
    const bt = $('#iaGerar');
    bt.disabled = true; bt.textContent = 'Gerando…';
    $('#iaReescrever') && ($('#iaReescrever').disabled = true);
    try {
      const body = dadosIA();
      if (feedback && ia.resultado) {
        body.anterior = [ia.resultado.legenda, ia.resultado.briefing].filter(Boolean).join('\n\n');
        body.feedback = feedback;
      }
      const r = await api('/api/agente/gerar', { method: 'POST', body });
      ia.id = r.id; ia.resultado = r.resultado; desenharIA();
    } catch (e) { toast(e.message); desenharIA(); }
    finally { bt.disabled = false; bt.textContent = ia.resultado ? 'Gerar de novo' : 'Gerar com IA'; }
  };
  const usarIA = () => {
    const r = ia.resultado;
    if (r.legenda && $('#tLegenda').value.trim() && $('#tLegenda').value.trim() !== r.legenda.trim()
      && !confirm('Isto substitui o texto atual da legenda. Continuar?')) return;
    if (r.legenda) $('#tLegenda').value = r.legenda;
    if (r.briefing) {
      const base = $('#tBriefing').value.split(MARCA_IA)[0].trim();
      $('#tBriefing').value = base ? `${base}\n\n${MARCA_IA}\n${r.briefing}` : r.briefing;
    }
    if (r.tema && !$('#tTema').value.trim()) $('#tTema').value = r.tema;
    if (r.palavra_chave && !$('#tKw').value.trim()) $('#tKw').value = r.palavra_chave;
    ia.usado = ia.id; contar();
    toast('Texto aplicado. Revise e clique em Salvar.');
  };
  $('#iaGerar').addEventListener('click', () => gerarIA());

  $('#tSalvar').addEventListener('click', async () => {
    const body = {
      client_id: Number($('#tCliente').value), tipo: $('#tTipo').value, formato: $('#tFormato').value.trim(),
      data: $('#tData').value || null, status: $('#tStatus').value, prioridade: $('#tPrio').value,
      responsavel: $('#tResp').value.trim(), tema: $('#tTema').value.trim(), editorial: $('#tEditorial').value.trim(),
      palavra_chave: $('#tKw').value.trim(), legenda: $('#tLegenda').value, briefing: $('#tBriefing').value,
      links: $('#tLinks').value.trim(), checklist: t.checklist,
    };
    try {
      const salvo = novo ? await api('/api/tasks', { method: 'POST', body }) : await api('/api/tasks/' + t.id, { method: 'PUT', body });
      if (padrao._onSalvo) await padrao._onSalvo(salvo);
      if (ia.usado) { // guarda o texto final, com as edições da equipe, como exemplo para próximas gerações
        const final = ($('#tLegenda').value.trim() || $('#tBriefing').value.split(MARCA_IA).pop().trim());
        api(`/api/agente/${ia.usado}/final`, { method: 'PUT', body: { task_id: salvo.id, texto: final } }).catch(() => {});
      }
      d.close(); toast('Tarefa salva'); render();
    } catch (e) { toast(e.message); }
  });
  $('#tDel')?.addEventListener('click', async () => {
    if (!confirm('Excluir esta tarefa?')) return;
    await api('/api/tasks/' + t.id, { method: 'DELETE' }); d.close(); toast('Tarefa excluída'); render();
  });
  d.showModal();
}

// ---------------- Programação (planilha de experiências) ----------------
const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
S.progAba = 'experiencias';
S.progResort = '';
S.progSoConteudo = false;

function planilhaEmbed(url) {
  const id = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit?rm=minimal${gid ? '&gid=' + gid + '#gid=' + gid : ''}` : null;
}

async function viewProgramacao(v) {
  const candidatos = S.cliente ? clientesAtivos() : S.clients.filter((c) => c.planilha_url);
  const cl = candidatos[0];
  if (!cl) {
    v.innerHTML = `<div class="view-head"><div><h2>Programação</h2><p>Experiências e datas promocionais que viram pauta.</p></div></div>
      <div class="empty">Escolha um cliente no topo ou cadastre o link da planilha de programação em <a href="#" data-go="clientes">Clientes</a>.</div>`;
    $$('[data-go]', v).forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); S.view = 'clientes'; render(); }));
    return;
  }
  const exps = await api('/api/experiencias?client_id=' + cl.id);
  const resorts = [...new Set(exps.map((e) => e.resort))];
  const embed = cl.planilha_url ? planilhaEmbed(cl.planilha_url) : null;

  // Agrupa: seção → experiência (nome + período) → resorts
  const secoes = [];
  for (const e of exps) {
    if (S.progResort && e.resort !== S.progResort) continue;
    let s = secoes.find((x) => x.nome === e.secao);
    if (!s) secoes.push((s = { nome: e.secao, itens: [] }));
    let it = s.itens.find((x) => x.nome === e.nome && x.periodo === e.periodo);
    if (!it) s.itens.push((it = { nome: e.nome, periodo: e.periodo, rows: [] }));
    it.rows.push(e);
  }
  const comConteudo = (it) => it.rows.some((r) => r.descricao);
  secoes.forEach((s) => { if (S.progSoConteudo) s.itens = s.itens.filter(comConteudo); });
  const visiveis = secoes.filter((s) => s.itens.length);
  const sync = cl.planilha_sync ? `Atualizado da planilha em ${new Date(cl.planilha_sync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Dados importados do arquivo da planilha';

  v.innerHTML = `
    <div class="view-head"><div><h2>Programação · ${esc(cl.nome)}</h2><p>Experiências e datas promocionais dos resorts para pautar conteúdos. ${esc(sync)}.</p></div>
      <div class="toolbar">
        ${cl.planilha_url ? `<button class="btn" id="pSync">Atualizar da planilha</button><a class="btn" href="${esc(cl.planilha_url)}" target="_blank" rel="noopener">Abrir no Google Sheets</a>` : ''}
      </div></div>
    <div class="toolbar" style="margin-bottom:16px">
      <div class="seg"><button data-aba="experiencias" class="${S.progAba === 'experiencias' ? 'on' : ''}">Experiências</button>
        <button data-aba="planilha" class="${S.progAba === 'planilha' ? 'on' : ''}" ${embed ? '' : 'disabled'}>Planilha ao vivo</button></div>
      ${S.progAba === 'experiencias' ? `
      <div class="seg"><button data-resort="" class="${!S.progResort ? 'on' : ''}">Todos</button>${resorts.map((r) => `<button data-resort="${esc(r)}" class="${S.progResort === r ? 'on' : ''}">${esc(r)}</button>`).join('')}</div>
      <label class="check" style="text-transform:none;font-weight:400;font-size:14px;color:var(--ink);margin:0"><input type="checkbox" id="pSo" ${S.progSoConteudo ? 'checked' : ''}><span>Só com programação preenchida</span></label>` : ''}
    </div>
    <div id="pCorpo"></div>`;

  const corpo = $('#pCorpo');
  if (S.progAba === 'planilha' && embed) {
    corpo.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><iframe src="${esc(embed)}" style="width:100%;height:75vh;border:0" loading="lazy" title="Planilha de programação"></iframe></div>
      <p class="muted" style="margin-top:8px">A planilha aparece aqui para quem estiver logado no Google com acesso a ela. Se não carregar, use “Abrir no Google Sheets”.</p>`;
  } else if (!visiveis.length) {
    corpo.innerHTML = `<div class="empty">${exps.length ? 'Nenhuma experiência com esse filtro.' : 'Nenhuma experiência importada ainda. Use “Atualizar da planilha”.'}</div>`;
  } else {
    const mesAtual = MESES_ABREV[new Date().getMonth()];
    corpo.innerHTML = visiveis.map((s) => `<div class="mat-group prog-secao" data-secao="${esc(s.nome || '')}">
      <h3>${esc(s.nome || 'Sem seção')}</h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${s.itens.map((it) => {
        const vinc = it.rows.find((r) => r.task_id);
        return `<div class="card">
          <div class="muted" style="font-size:12px">${esc(it.periodo || '')}</div>
          <h3 style="margin:2px 0 10px">${esc(it.nome)}</h3>
          ${it.rows.map((r) => `<div style="border-top:1px solid var(--line);padding:8px 0">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong style="font-size:13px">${esc(r.resort)}</strong>
              <span class="st ${/aprov/i.test(r.status || '') ? 'publicado' : /revis/i.test(r.status || '') ? 'aprovacao' : ''}">${esc(r.status || 'Pendente')}</span></div>
            ${r.descricao ? `<div style="white-space:pre-line;font-size:13px;margin-top:4px">${esc(r.descricao)}</div>` : '<div class="muted" style="font-size:13px;margin-top:4px">Aguardando programação</div>'}
            ${[r.horario && 'Horário: ' + r.horario, r.local && 'Local: ' + r.local, r.incluso && 'Incluso: ' + r.incluso, r.preco && 'Preço: ' + r.preco, r.observacoes && 'Obs.: ' + r.observacoes].filter(Boolean).map((x) => `<div class="muted" style="font-size:12px">${esc(x)}</div>`).join('')}
          </div>`).join('')}
          <div style="margin-top:10px">${vinc
            ? `<button class="btn small" data-abrir="${vinc.task_id}">Pauta criada · ${esc(STATUS_LABEL[vinc.task_status] || '')}</button>`
            : `<button class="btn small primary" data-pauta="${it.rows.map((r) => r.id).join(',')}">Criar pauta</button>`}</div>
        </div>`;
      }).join('')}</div></div>`).join('');
    const alvo = $$('.prog-secao', corpo).find((el) => el.dataset.secao.split('|')[0].includes(mesAtual));
    if (alvo) setTimeout(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  $$('[data-aba]', v).forEach((b) => b.addEventListener('click', () => { S.progAba = b.dataset.aba; viewProgramacao(v); }));
  $$('[data-resort]', v).forEach((b) => b.addEventListener('click', () => { S.progResort = b.dataset.resort; viewProgramacao(v); }));
  $('#pSo')?.addEventListener('change', (e) => { S.progSoConteudo = e.target.checked; viewProgramacao(v); });
  $('#pSync')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Atualizando…';
    try {
      const r = await api(`/api/clients/${cl.id}/sincronizar-planilha`, { method: 'POST' });
      await carregarClientes(); toast(`${r.experiencias} experiências atualizadas`); viewProgramacao(v);
    } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Atualizar da planilha'; }
  });
  $$('[data-abrir]', v).forEach((b) => b.addEventListener('click', async () => {
    const t = (await api('/api/tasks?client_id=' + cl.id)).find((x) => x.id === Number(b.dataset.abrir));
    if (t) abrirTarefa(t);
  }));
  $$('[data-pauta]', v).forEach((b) => b.addEventListener('click', () => {
    const ids = b.dataset.pauta.split(',').map(Number);
    const rows = exps.filter((e) => ids.includes(e.id));
    const base = rows[0];
    const briefing = rows.filter((r) => r.descricao).map((r) => `${r.resort}:\n${r.descricao}`).join('\n\n');
    abrirTarefa(null, {
      client_id: cl.id, tipo: 'post', data: '', editorial: 'Programação dos resorts',
      tema: base.nome, briefing: `${base.periodo ? 'Período: ' + base.periodo + '\n\n' : ''}${briefing}`,
      _onSalvo: (task) => api('/api/experiencias/vincular', { method: 'PUT', body: { ids, task_id: task.id } }),
    });
  }));
}

// ---------------- Área do cliente: links rápidos e acessos ----------------
function iconeLink(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('trello.com')) return ['T', '#0c66e4'];
  if (u.includes('docs.google.com/spreadsheets')) return ['P', '#188038'];
  if (u.includes('docs.google.com/document')) return ['D', '#1a73e8'];
  if (u.includes('drive.google.com')) return ['DR', '#f4b400'];
  if (u.includes('sharepoint.com') || u.includes('office.com')) return ['XL', '#107c41'];
  if (u.includes('stays.net')) return ['R', '#e2574c'];
  if (u.includes('instagram.com')) return ['IG', '#c13584'];
  if (u.includes('linkedin.com')) return ['in', '#0a66c2'];
  if (u.includes('canva.com')) return ['C', '#00c4cc'];
  return ['↗', 'var(--accent)'];
}
const dominio = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

async function viewArea(v) {
  const admin = S.me.papel === 'admin';
  if (!S.cliente) {
    v.innerHTML = `<div class="view-head"><div><h2>Área do cliente</h2><p>Escolha um cliente para ver links, planilhas e acessos.</p></div></div>
      <div class="cliente-pick">${S.clients.map((c) => `<button class="card" data-pick="${c.id}"><h3>${esc(c.nome)}</h3>
        <div class="muted" style="margin-top:4px">${esc((c.marcas || []).join(' · ') || 'Abrir área')}</div></button>`).join('')}</div>`;
    $$('[data-pick]', v).forEach((b) => b.addEventListener('click', () => {
      S.cliente = b.dataset.pick; localStorageSet('pbh_cliente', S.cliente); $('#fCliente').value = S.cliente; viewArea(v);
    }));
    return;
  }
  const cl = S.clients.find((c) => String(c.id) === String(S.cliente));
  const [links, { acessos, ocultos }, mats] = await Promise.all([
    api(`/api/clients/${cl.id}/links`), api(`/api/clients/${cl.id}/acessos`), api(`/api/materials?client_id=${cl.id}`),
  ]);
  const grupos = {};
  links.forEach((l) => { (grupos[l.categoria || 'Links'] ||= []).push(l); });

  v.innerHTML = `
    <div class="area-head"><div><h2>${esc(cl.nome)}</h2>
      ${(cl.marcas || []).length ? `<div class="marcas">${cl.marcas.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>` : ''}</div>
      <div class="toolbar">${cl.planilha_url ? '<button class="btn" data-ir="programacao">Programação</button>' : ''}
        <button class="btn" data-ir="calendario">Calendário</button><button class="btn" data-ir="quadro">Quadro</button><button class="btn" data-ir="materiais">Materiais</button></div></div>
    ${cl.observacoes ? `<div class="nota">${esc(cl.observacoes)}</div>` : ''}

    <div class="secao-titulo"><h3>Links rápidos</h3><button class="btn small" id="novoLink">+ Adicionar link</button></div>
    ${Object.keys(grupos).length ? Object.entries(grupos).map(([cat, arr]) => `
      <div class="mat-group"><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${esc(cat)}</div>
      <div class="atalhos">${arr.map((l) => { const [ic, cor] = iconeLink(l.url); return `
        <a class="atalho" href="${esc(l.url)}" target="_blank" rel="noopener">
          <span class="ic" style="background:${cor}">${ic}</span>
          <span class="tx"><strong>${esc(l.titulo)}</strong><span>${esc(l.observacao || dominio(l.url))}</span></span>
          <button class="edit" data-link="${l.id}" title="Editar">✎</button></a>`; }).join('')}</div></div>`).join('')
    : '<div class="empty" style="padding:20px">Nenhum link ainda.</div>'}

    <div class="secao-titulo"><h3>Materiais <span class="tag">${mats.length}</span></h3>
      <div class="toolbar"><input id="aMatBusca" placeholder="Buscar material…" style="width:200px"><button class="btn small" id="aNovoMat">+ Adicionar material</button></div></div>
    <div id="aMats">${materiaisHTML(mats)}</div>

    <div class="secao-titulo"><h3>Acessos</h3>${admin ? '<button class="btn small" id="novoAcesso">+ Adicionar acesso</button>' : ''}</div>
    ${ocultos ? `<p class="muted" style="margin-top:-4px">${ocultos} acesso(s) visíveis só para administradores.</p>` : ''}
    <div class="cofre">${acessos.map((a) => `<div class="card acesso" data-a="${a.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <h3>${esc(a.servico)}</h3>${a.restrito ? '<span class="tag" title="Só administradores veem">Restrito</span>' : ''}</div>
      ${a.url ? `<div class="linha"><span class="k">Link</span><a class="v" style="font-family:inherit" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(dominio(a.url))}</a></div>` : ''}
      ${a.usuario ? `<div class="linha"><span class="k">Usuário</span><span class="v">${esc(a.usuario)}</span><button data-copiar="${esc(a.usuario)}">Copiar</button></div>` : ''}
      ${a.tem_senha ? `<div class="linha"><span class="k">Senha</span><span class="v" data-senha>••••••••</span><button data-mostrar>Mostrar</button><button data-copiar-senha>Copiar</button></div>` : ''}
      ${a.observacao ? `<div class="muted" style="font-size:12px;margin-top:6px;white-space:pre-line">${esc(a.observacao)}</div>` : ''}
      ${admin ? '<div style="margin-top:8px"><button class="btn small" data-editar-acesso>Editar</button></div>' : ''}
    </div>`).join('') || '<div class="empty" style="padding:20px">Nenhum acesso cadastrado.</div>'}</div>`;

  $$('[data-ir]', v).forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.ir; render(); }));
  const aMats = $('#aMats');
  ligarMateriais(aMats, mats);
  $('#aMatBusca').addEventListener('input', (e) => { aMats.innerHTML = materiaisHTML(mats, e.target.value); ligarMateriais(aMats, mats); });
  $('#aNovoMat').addEventListener('click', () => abrirMaterial(null, mats));
  $('#novoLink').addEventListener('click', () => abrirLink(cl, null));
  $$('[data-link]', v).forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); abrirLink(cl, links.find((l) => l.id === Number(b.dataset.link)));
  }));
  $$('[data-copiar]', v).forEach((b) => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.copiar); toast('Usuário copiado'); }));
  $$('[data-a]', v).forEach((card) => {
    const id = Number(card.dataset.a);
    const pegar = () => api(`/api/acessos/${id}/senha`).then((r) => r.senha);
    $('[data-mostrar]', card)?.addEventListener('click', async (e) => {
      const alvo = $('[data-senha]', card);
      if (e.target.textContent === 'Ocultar') { alvo.textContent = '••••••••'; e.target.textContent = 'Mostrar'; return; }
      try { alvo.textContent = await pegar(); e.target.textContent = 'Ocultar'; setTimeout(() => { alvo.textContent = '••••••••'; e.target.textContent = 'Mostrar'; }, 20000); }
      catch (err) { toast(err.message); }
    });
    $('[data-copiar-senha]', card)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(await pegar()); toast('Senha copiada'); } catch (err) { toast(err.message); }
    });
    $('[data-editar-acesso]', card)?.addEventListener('click', () => abrirAcesso(cl, acessos.find((a) => a.id === id)));
  });
  $('#novoAcesso')?.addEventListener('click', () => abrirAcesso(cl, null));
}

function abrirLink(cl, l) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${l ? 'Editar link' : 'Novo link'} · ${esc(cl.nome)}</h3><button class="icon" value="x">×</button></div>
    <div class="modal-body">
      <div class="row"><div><label>Título do botão</label><input id="lkTitulo" value="${esc(l?.titulo || '')}" placeholder="Ex.: Planejamento mensal"></div>
        <div><label>Grupo</label><input id="lkCat" list="lkCats" value="${esc(l?.categoria || '')}" placeholder="Ex.: Planejamento">
        <datalist id="lkCats"><option value="Planejamento"><option value="Programação"><option value="Gestão"><option value="Reservas e unidades"><option value="Relatórios"></datalist></div></div>
      <div><label>Link</label><input id="lkUrl" value="${esc(l?.url || '')}" placeholder="https://…"></div>
      <div><label>Observação (aparece no botão)</label><input id="lkObs" value="${esc(l?.observacao || '')}"></div>
    </div>
    <div class="modal-foot"><div>${l ? '<button type="button" class="btn danger" id="lkDel">Excluir</button>' : ''}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="lkSalvar">Salvar</button></div></div></form>`;
  d.showModal();
  $('#lkSalvar').addEventListener('click', async () => {
    const body = { client_id: cl.id, titulo: $('#lkTitulo').value, url: $('#lkUrl').value, categoria: $('#lkCat').value.trim(), observacao: $('#lkObs').value.trim() };
    try {
      if (l) await api('/api/links/' + l.id, { method: 'PUT', body }); else await api('/api/links', { method: 'POST', body });
      d.close(); toast('Link salvo'); render();
    } catch (e) { toast(e.message); }
  });
  $('#lkDel')?.addEventListener('click', async () => {
    if (!confirm('Excluir este link?')) return;
    await api('/api/links/' + l.id, { method: 'DELETE' }); d.close(); render();
  });
}

function abrirAcesso(cl, a) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${a ? 'Editar acesso' : 'Novo acesso'} · ${esc(cl.nome)}</h3><button class="icon" value="x">×</button></div>
    <div class="modal-body">
      <div class="row"><div><label>Serviço</label><input id="acServ" value="${esc(a?.servico || '')}" placeholder="Ex.: Instagram"></div>
        <div><label>Link de login</label><input id="acUrl" value="${esc(a?.url || '')}" placeholder="https://…"></div></div>
      <div class="row"><div><label>Usuário / e-mail</label><input id="acUser" value="${esc(a?.usuario || '')}" autocomplete="off"></div>
        <div><label>${a?.tem_senha ? 'Nova senha (deixe em branco para manter)' : 'Senha'}</label><input id="acSenha" type="password" autocomplete="new-password"></div></div>
      <div><label>Observação</label><textarea id="acObs" rows="2" style="min-height:60px">${esc(a?.observacao || '')}</textarea></div>
      <label class="check" style="text-transform:none;font-weight:400;font-size:14px;color:var(--ink)"><input type="checkbox" id="acRestrito" ${a ? (a.restrito ? 'checked' : '') : 'checked'}><span>Só administradores podem ver</span></label>
      ${a?.tem_senha ? '<label class="check" style="text-transform:none;font-weight:400;font-size:14px;color:var(--ink)"><input type="checkbox" id="acLimpar"><span>Remover a senha salva</span></label>' : ''}
    </div>
    <div class="modal-foot"><div>${a ? '<button type="button" class="btn danger" id="acDel">Excluir</button>' : ''}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="acSalvar">Salvar</button></div></div></form>`;
  d.showModal();
  $('#acSalvar').addEventListener('click', async () => {
    const body = { client_id: cl.id, servico: $('#acServ').value.trim(), url: $('#acUrl').value.trim(), usuario: $('#acUser').value.trim(),
      senha: $('#acSenha').value, observacao: $('#acObs').value.trim(), restrito: $('#acRestrito').checked, limpar_senha: !!$('#acLimpar')?.checked };
    try {
      if (a) await api('/api/acessos/' + a.id, { method: 'PUT', body }); else await api('/api/acessos', { method: 'POST', body });
      d.close(); toast('Acesso salvo'); render();
    } catch (e) { toast(e.message); }
  });
  $('#acDel')?.addEventListener('click', async () => {
    if (!confirm(`Excluir o acesso ${a.servico}?`)) return;
    await api('/api/acessos/' + a.id, { method: 'DELETE' }); d.close(); render();
  });
}

// ---------------- Usuários (admin) ----------------
async function viewUsuarios(v) {
  await carregarUsuarios();
  v.innerHTML = `
    <div class="view-head"><div><h2>Usuários</h2><p>Quem pode entrar no sistema. Cada pessoa recebe um link de acesso e cria a própria senha.</p></div></div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:12px">Adicionar pessoa</h3>
      <form id="uForm" class="row" style="align-items:end">
        <div><label>E-mail</label><input type="email" id="uEmail" required placeholder="nome@exemplo.com"></div>
        <div><label>Nome</label><input id="uNome" placeholder="Como aparece em Responsável"></div>
        <div><label>Acesso</label><select id="uPapel"><option value="membro">Membro</option><option value="admin">Administrador</option></select></div>
        <div><button class="btn primary" type="submit" style="width:100%">Adicionar</button></div>
      </form>
      <div id="uSenha"></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Pessoa</th><th>Acesso</th><th>Situação</th><th></th></tr></thead>
      <tbody>${S.users.map((u) => `<tr class="user-row ${u.ativo ? '' : 'inativo'}" data-u="${u.id}">
        <td><strong>${esc(u.nome || '—')}</strong><div class="muted">${esc(u.email)}</div></td>
        <td><select data-papel style="width:auto" ${u.id === S.me.id ? 'disabled' : ''}>
          <option value="membro" ${u.papel === 'membro' ? 'selected' : ''}>Membro</option>
          <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Administrador</option></select></td>
        <td>${!u.ativo ? '<span class="st">Desativado</span>' : u.convite_pendente ? '<span class="st aprovacao">Convite enviado</span>' : '<span class="st publicado">Ativo</span>'}</td>
        <td style="text-align:right;white-space:nowrap">${u.id === S.me.id ? '<span class="muted">Você</span>' : `
          <button class="btn small" data-reset>Link de acesso</button>
          <button class="btn small" data-ativo>${u.ativo ? 'Desativar' : 'Reativar'}</button>
          <button class="btn small danger" data-del>Excluir</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`;

  const mostrarLink = (email, link) => {
    $('#uSenha').innerHTML = `<div style="margin-top:14px"><p style="margin:0 0 8px">Link de acesso de <b>${esc(email)}</b>. Envie para a pessoa: ao abrir, ela cria a própria senha. O link vale por 7 dias e só funciona uma vez.</p>
      <div class="senha-box" style="font-size:13px"><span style="word-break:break-all">${esc(link)}</span><button type="button" class="btn small" id="copiarSenha">Copiar convite</button></div></div>`;
    $('#copiarSenha').addEventListener('click', () => {
      navigator.clipboard.writeText(`Olá! Este é seu acesso ao sistema da Por Boas Histórias.\nAbra o link para criar sua senha (vale por 7 dias):\n${link}\n\nDepois, entre em ${location.origin} com o e-mail ${email}.`);
      toast('Convite copiado');
    });
  };

  $('#uForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/users', { method: 'POST', body: { email: $('#uEmail').value, nome: $('#uNome').value, papel: $('#uPapel').value } });
      await viewUsuarios(v);
      mostrarLink(r.usuario.email, r.link);
      toast('Usuário criado');
    } catch (err) { toast(err.message); }
  });

  $$('[data-u]', v).forEach((row) => {
    const u = S.users.find((x) => x.id === Number(row.dataset.u));
    $('[data-papel]', row).addEventListener('change', async (e) => {
      try { await api('/api/users/' + u.id, { method: 'PUT', body: { papel: e.target.value } }); toast('Acesso atualizado'); }
      catch (err) { toast(err.message); viewUsuarios(v); }
    });
    $('[data-reset]', row)?.addEventListener('click', async () => {
      const r = await api(`/api/users/${u.id}/convite`, { method: 'POST' });
      await viewUsuarios(v);
      mostrarLink(u.email, r.link);
    });
    $('[data-ativo]', row)?.addEventListener('click', async () => {
      try { await api('/api/users/' + u.id, { method: 'PUT', body: { ativo: !u.ativo } }); viewUsuarios(v); }
      catch (err) { toast(err.message); }
    });
    $('[data-del]', row)?.addEventListener('click', async () => {
      if (!confirm(`Excluir ${u.email}? Para só bloquear o acesso, use Desativar.`)) return;
      try { await api('/api/users/' + u.id, { method: 'DELETE' }); toast('Usuário excluído'); viewUsuarios(v); }
      catch (err) { toast(err.message); }
    });
  });
}

// ---------------- Minha conta ----------------
function abrirMinhaConta(obrigatorio) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog" id="contaForm">
    <div class="modal-head"><h3>${obrigatorio ? 'Crie sua senha' : 'Minha conta'}</h3>${obrigatorio ? '' : '<button class="icon" value="x" aria-label="Fechar">×</button>'}</div>
    <div class="modal-body">
      ${obrigatorio ? '<p style="margin:0">Você entrou com uma senha temporária. Escolha uma senha sua para continuar.</p>' : ''}
      <div class="row"><div><label>E-mail</label><input value="${esc(S.me.email)}" disabled></div>
        <div><label>Nome</label><input id="cNome" value="${esc(S.me.nome || '')}"></div></div>
      <div><label>Senha atual</label><input type="password" id="cAtual" autocomplete="current-password" ${obrigatorio ? 'required' : ''}></div>
      <div class="row"><div><label>Nova senha (mín. 8 caracteres)</label><input type="password" id="cNova" autocomplete="new-password" minlength="8" ${obrigatorio ? 'required' : ''}></div>
        <div><label>Repita a nova senha</label><input type="password" id="cNova2" autocomplete="new-password" ${obrigatorio ? 'required' : ''}></div></div>
      <p class="erro" id="cErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px">${obrigatorio ? '' : '<button class="btn" value="x">Cancelar</button>'}<button type="button" class="btn primary" id="cSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  d.oncancel = obrigatorio ? (e) => e.preventDefault() : null;
  d.onclose = () => { d.oncancel = null; d.onclose = null; };
  $('#cSalvar').addEventListener('click', async () => {
    const nova = $('#cNova').value;
    try {
      if (nova || obrigatorio) {
        if (nova.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres');
        if (nova !== $('#cNova2').value) throw new Error('As senhas não conferem');
        const r = await api('/api/minha-senha', { method: 'POST', body: { atual: $('#cAtual').value, nova } });
        S.me = r.usuario;
      }
      if (($('#cNome').value.trim() || null) !== (S.me.nome || null)) {
        const r = await api('/api/meu-perfil', { method: 'PUT', body: { nome: $('#cNome').value } });
        S.me = r.usuario;
      }
      mostrarEu(); await carregarUsuarios();
      d.close(); toast('Conta atualizada');
    } catch (err) { $('#cErro').textContent = err.message; }
  });
}

iniciar().catch((e) => { document.body.innerHTML = `<div class="empty">Erro ao iniciar: ${esc(e.message)}</div>`; });
