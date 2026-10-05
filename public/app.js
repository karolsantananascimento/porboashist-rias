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

const S = {
  view: 'painel',
  clients: [],
  cliente: localStorageGet('pbh_cliente') || '',
  mes: hojeISO.slice(0, 7),
  tasks: [],
  quadroTipo: 'post',
  listaFiltro: { tipo: '', status: '', busca: '' },
  matBusca: '',
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
  const s = await api('/api/sessao');
  if (!s.autenticado) return mostrarLogin();
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!s.protegido) $('#sair').classList.add('hidden');
  await carregarClientes();
  render();
}

function mostrarLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#senha').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { senha: $('#senha').value } });
    $('#loginErro').textContent = '';
    iniciar();
  } catch (err) { $('#loginErro').textContent = err.message; }
});

$('#sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); mostrarLogin(); });

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
$$('#nav a').forEach((a) => a.addEventListener('click', () => { S.view = a.dataset.view; render(); }));

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
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === S.view));
  $('#mesLabel').textContent = mesLabel(S.mes);
  const semMes = ['materiais', 'clientes', 'captacao'].includes(S.view);
  $('.mes').style.display = semMes ? 'none' : '';
  const v = $('#view');
  try {
    if (!['materiais', 'clientes'].includes(S.view)) await carregarTarefas();
    ({ painel: viewPainel, calendario: viewCalendario, quadro: viewQuadro, lista: viewLista,
      captacao: viewCaptacao, materiais: viewMateriais, clientes: viewClientes })[S.view](v);
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
      <p>${cls.length === 1 ? esc(cls[0].nome) : 'Todos os clientes'} · metas do contrato e andamento das entregas</p></div></div>
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
    <div class="view-head"><div><h2>Calendário</h2><p>Clique em um item para editar ou no + para criar no dia.</p></div></div>
    <div class="cal">${html}</div>
    <div class="cal-legend">
      <span><span class="dot" style="background:var(--post)"></span> Post no feed</span>
      <span><span class="dot" style="background:var(--blog)"></span> Blog SEO</span>
      <span><span class="dot" style="background:var(--story)"></span> Stories</span>
      <span>Itens riscados já foram publicados</span>
    </div>`;
  ligarLinhas(v);
  $$('[data-nova]', v).forEach((b) => b.addEventListener('click', () => abrirTarefa(null, { data: b.dataset.nova })));
}

// ---------------- Quadro ----------------
function viewQuadro(v) {
  const filtros = { post: 'Feed', story: 'Stories', blog: 'Blog SEO', captacao: 'Captação', '': 'Todos' };
  const lista = S.tasks.filter((t) => !S.quadroTipo || t.tipo === S.quadroTipo);
  v.innerHTML = `
    <div class="view-head"><div><h2>Quadro de produção</h2><p>Arraste os cartões para mudar a etapa.</p></div>
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
    <div class="view-head"><div><h2>Todas as tarefas</h2><p>${lista.length} itens em ${esc(mesLabel(S.mes))} (inclui tarefas sem data)</p></div>
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
async function viewMateriais(v) {
  const q = S.cliente ? '?client_id=' + S.cliente : '';
  const mats = await api('/api/materials' + q);
  const b = S.matBusca.toLowerCase();
  const filtrados = mats.filter((m) => !b || `${m.categoria} ${m.descricao}`.toLowerCase().includes(b));
  const grupos = {};
  filtrados.forEach((m) => { (grupos[m.categoria || 'Sem categoria'] ||= []).push(m); });
  v.innerHTML = `
    <div class="view-head"><div><h2>Banco de materiais</h2><p>${mats.length} pastas e arquivos no Drive. Itens apagados estão marcados para evitar.</p></div>
      <div class="toolbar"><input id="mBusca" placeholder="Buscar: piscina, café, casal…" value="${esc(S.matBusca)}" style="width:240px">
      <button class="btn primary" id="novoMat">+ Adicionar link</button></div></div>
    ${Object.entries(grupos).map(([cat, arr]) => `<div class="mat-group"><h3>${esc(cat)} <span class="tag">${arr.length}</span></h3>
      <div class="mat-list">${arr.map((m) => `<div class="mat ${m.evitar ? 'evitar' : ''}">
        <div class="ic">${/\/file\//.test(m.url) ? '▣' : '▤'}</div>
        <div class="grow"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.descricao || 'Material')}</a>
          ${m.evitar ? '<div class="muted" style="font-size:12px">Evitar / usar com cuidado</div>' : ''}</div>
        <div class="acts"><button title="Copiar link" data-copy="${esc(m.url)}">⧉</button><button title="Editar" data-edit="${m.id}">✎</button></div>
      </div>`).join('')}</div></div>`).join('') || '<div class="empty">Nenhum material encontrado.</div>'}`;
  const busca = $('#mBusca');
  busca.addEventListener('input', () => {
    S.matBusca = busca.value; clearTimeout(viewMateriais._t);
    viewMateriais._t = setTimeout(async () => { await viewMateriais(v); const i = $('#mBusca'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  });
  $('#novoMat').addEventListener('click', () => abrirMaterial(null, mats));
  $$('[data-copy]', v).forEach((bt) => bt.addEventListener('click', () => { navigator.clipboard.writeText(bt.dataset.copy); toast('Link copiado'); }));
  $$('[data-edit]', v).forEach((bt) => bt.addEventListener('click', () => abrirMaterial(mats.find((m) => m.id === Number(bt.dataset.edit)), mats)));
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
      <div><label>Descrição</label><input id="mmDesc" value="${esc(m?.descricao || '')}" placeholder="Ex.: Casal na praia ao entardecer"></div></div>
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
        <div class="row"><div><label>Posts / mês</label><input type="number" min="0" data-f="meta_posts" value="${c.meta_posts}"></div>
          <div><label>Stories / dia</label><input type="number" min="0" data-f="meta_stories_dia" value="${c.meta_stories_dia}"></div>
          <div><label>Blog / mês</label><input type="number" min="0" data-f="meta_blog" value="${c.meta_blog}"></div></div>
        <div><label>Observações / rodapé padrão</label><textarea data-f="observacoes">${esc(c.observacoes || '')}</textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary small" data-salvar>Salvar</button>
          <button class="btn small" data-gerar>Gerar estrutura de ${esc(mesLabel(S.mes))}</button>
        </div>
      </div></div>`).join('')}
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Backup dos dados</h3>
      <p class="muted" style="margin:6px 0 12px">O banco gratuito do Render expira após 30 dias. Baixe um backup com frequência e restaure no banco novo quando precisar.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="/api/backup" download>Baixar backup (.json)</a>
        <label class="btn" style="margin:0;text-transform:none;font-size:14px;color:var(--ink);letter-spacing:0">Restaurar backup<input type="file" id="restaurar" accept="application/json" hidden></label>
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
    <div class="modal-body">
      <div class="row">
        <div><label>Cliente</label><select id="tCliente">${S.clients.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
        <div><label>Tipo</label><select id="tTipo">${Object.entries(TIPO_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div><label>Formato</label><input id="tFormato" list="formatos" value="${esc(t.formato || '')}"><datalist id="formatos">${FORMATOS.map((f) => `<option value="${f}">`).join('')}</datalist></div>
      </div>
      <div class="row">
        <div><label>Data</label><input type="date" id="tData" value="${t.data || ''}"></div>
        <div><label>Etapa</label><select id="tStatus">${STATUS.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select></div>
        <div><label>Prioridade</label><select id="tPrio"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></div>
        <div><label>Responsável</label><input id="tResp" value="${esc(t.responsavel || '')}"></div>
      </div>
      <div class="row">
        <div><label>Tema</label><input id="tTema" value="${esc(t.tema || '')}"></div>
        <div><label>Editorial</label><input id="tEditorial" value="${esc(t.editorial || '')}" list="editoriais"><datalist id="editoriais">
          <option value="Experiência do cliente / hospedagens"><option value="Dicas de conteúdos para hóspedes e investidores"><option value="Datas especiais"><option value="Programação dos resorts"></datalist></div>
      </div>
      <div id="kwWrap"><label>Palavra-chave SEO</label><input id="tKw" value="${esc(t.palavra_chave || '')}" placeholder="Ex.: apartamento em Muro Alto"></div>
      <div><label id="lblLegenda">Legenda / texto</label><textarea id="tLegenda" rows="8">${esc(t.legenda || '')}</textarea>
        <div class="counter"><span id="cont"></span><button type="button" id="copiar">Copiar texto</button></div></div>
      <div><label>Briefing visual / roteiro</label><textarea id="tBriefing" rows="6">${esc(t.briefing || '')}</textarea></div>
      <div><label>Links de material (um por linha)</label><textarea id="tLinks" rows="3" style="min-height:60px">${esc(t.links || '')}</textarea>
        <div class="linkified" id="linksVis">${linkify(t.links)}</div></div>
      <div><label>Checklist</label><div class="checklist" id="chk"></div>
        <div style="display:flex;gap:8px;margin-top:8px"><input id="chkNovo" placeholder="Adicionar item"><button type="button" class="btn small" id="chkAdd">Adicionar</button></div></div>
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
  $('#tLinks').addEventListener('input', (e) => { $('#linksVis').innerHTML = linkify(e.target.value); });

  const desenharChk = () => {
    $('#chk').innerHTML = t.checklist.map((c, i) => `<div class="check ${c.feito ? 'feito' : ''}">
      <input type="checkbox" data-i="${i}" ${c.feito ? 'checked' : ''}><span>${esc(c.texto)}</span><button type="button" class="rm" data-rm="${i}">×</button></div>`).join('')
      || '<span class="muted">Sem itens.</span>';
    $$('#chk input').forEach((cb) => cb.addEventListener('change', () => { t.checklist[cb.dataset.i].feito = cb.checked; desenharChk(); }));
    $$('#chk [data-rm]').forEach((b) => b.addEventListener('click', () => { t.checklist.splice(Number(b.dataset.rm), 1); desenharChk(); }));
  };
  desenharChk();
  const addChk = () => { const v = $('#chkNovo').value.trim(); if (v) { t.checklist.push({ texto: v, feito: false }); $('#chkNovo').value = ''; desenharChk(); } };
  $('#chkAdd').addEventListener('click', addChk);
  $('#chkNovo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChk(); } });

  $('#tSalvar').addEventListener('click', async () => {
    const body = {
      client_id: Number($('#tCliente').value), tipo: $('#tTipo').value, formato: $('#tFormato').value.trim(),
      data: $('#tData').value || null, status: $('#tStatus').value, prioridade: $('#tPrio').value,
      responsavel: $('#tResp').value.trim(), tema: $('#tTema').value.trim(), editorial: $('#tEditorial').value.trim(),
      palavra_chave: $('#tKw').value.trim(), legenda: $('#tLegenda').value, briefing: $('#tBriefing').value,
      links: $('#tLinks').value.trim(), checklist: t.checklist,
    };
    try {
      if (novo) await api('/api/tasks', { method: 'POST', body });
      else await api('/api/tasks/' + t.id, { method: 'PUT', body });
      d.close(); toast('Tarefa salva'); render();
    } catch (e) { toast(e.message); }
  });
  $('#tDel')?.addEventListener('click', async () => {
    if (!confirm('Excluir esta tarefa?')) return;
    await api('/api/tasks/' + t.id, { method: 'DELETE' }); d.close(); toast('Tarefa excluída'); render();
  });
  d.showModal();
}

iniciar().catch((e) => { document.body.innerHTML = `<div class="empty">Erro ao iniciar: ${esc(e.message)}</div>`; });
