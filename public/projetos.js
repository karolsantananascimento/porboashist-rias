// A Melhor Mídia do Brasil — telas de projetos, Criar, Mensagens, Empregos e Integrações
// Usa as funções globais de app.js (S, api, esc, $, $$, toast, render, abrirProjeto, carregarProjetos).

let AGENTES = [];
const agente = (id) => AGENTES.find((a) => a.id === id) || { id, nome: id, icone: '•', cargo: '', formatos: [] };
const projetoPorId = (id) => S.projetos.find((p) => String(p.id) === String(id));

async function carregarAgentes() {
  if (!AGENTES.length) AGENTES = await api('/api/agentes');
  return AGENTES;
}

function copiar(texto) {
  const ok = () => toast('Copiado');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).then(ok, () => fallbackCopiar(texto, ok));
  else fallbackCopiar(texto, ok);
}
function fallbackCopiar(texto, ok) {
  const t = document.createElement('textarea');
  t.value = texto; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); ok(); } catch { toast('Não consegui copiar. Selecione o texto e copie.'); }
  t.remove();
}

// Kits de marca da sua conta do Canva (atualize quando criar kits novos)
const KITS_CANVA = [
  ['kAHVxV_gqbI', 'Disco Mídia'], ['kAHUqEMtaUA', 'Just Mkt'], ['kAGnnk9vrtI', 'Kit Otter'], ['kAHKTQZqKn0', 'Audi Growth'],
  ['kAG1PDmgf1c', 'Bienal do Livro PE'], ['kAG4xcu8B-M', 'NUMA'], ['kAG6ezOiE_U', 'Mica'], ['kAHBCqK334c', 'Salada Music'], ['kAHBDMn618A', 'Leitura em jogo'],
];
function seletorKit(id, atual, nomeAtual) {
  const lista = KITS_CANVA.slice();
  if (atual && !lista.some(([k]) => k === atual)) lista.push([atual, nomeAtual || atual]);
  return `<select id="${id}"><option value="">Nenhum kit</option>${lista.map(([k, n]) => `<option value="${esc(k)}" ${k === atual ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
}
const lerKit = (id) => { const sel = $('#' + id); const o = sel.options[sel.selectedIndex]; return { id: sel.value || '', nome: sel.value ? o.textContent : '' }; };

// ---------------- Navegação: projeto > cliente > abas ----------------
const ABAS = [['solicitar', 'Conteúdo'], ['quadro', 'Pautas'], ['mensagens', 'Mensagens'], ['recursos', 'Recursos'], ['acessos', 'Acessos e APIs'], ['relatorios', 'Relatórios']];
const GRUPO_ABA = {
  solicitar: 'solicitar', visao: 'solicitar', solicitacoes: 'solicitar', criar: 'solicitar',
  quadro: 'quadro', calendario: 'quadro', lista: 'quadro', captacao: 'quadro', painel: 'quadro',
  recursos: 'recursos', programacao: 'recursos', materiais: 'recursos', area: 'recursos',
  acessos: 'acessos', relatorios: 'relatorios', mensagens: 'mensagens',
};
const VIEWS_DO_PROJETO = [...Object.keys(GRUPO_ABA), 'clientes'];
const clienteAtual = () => (S.cliente ? S.clients.find((c) => String(c.id) === String(S.cliente)) : null);

function mostrarProjetoAtual() {
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  const box = $('#projAtual');
  box.classList.toggle('hidden', !p);
  if (p) {
    const c = clienteAtual();
    box.innerHTML = `<span class="proj-dot" style="background:${esc(p.cor)}"></span><div><small>Projeto aberto</small><strong>${esc(p.nome)}</strong>${c ? `<small>${esc(c.nome)}</small>` : ''}</div>`;
  }
  // "Projetos" fica marcado em qualquer tela de dentro do projeto
  if (p && VIEWS_DO_PROJETO.includes(S.view)) {
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === 'inicio'));
  }
  if (S.view === 'empregos') $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === 'inicio'));
  desenharContexto(p);
}

function desenharContexto(p) {
  const el = $('#ctx');
  if (!p || !VIEWS_DO_PROJETO.includes(S.view)) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const c = clienteAtual();
  const abaAtiva = GRUPO_ABA[S.view] || '';
  el.classList.remove('hidden');
  el.innerHTML = `
    <nav class="crumbs" aria-label="Você está em">
      <a href="#" data-crumb="inicio">Projetos</a><span>›</span>
      <a href="#" data-crumb="projeto" ${c ? '' : 'aria-current="page"'}>${esc(p.nome)}</a>
      ${c ? `<span>›</span><a href="#" data-crumb="cliente" aria-current="page">${esc(c.nome)}</a>` : ''}
    </nav>
    ${S.clients.length > 1 || c ? `<div class="chips" role="group" aria-label="Cliente">
      <button class="chip ${c ? '' : 'on'}" data-cli="">Todos</button>
      ${S.clients.map((x) => `<button class="chip ${c && c.id === x.id ? 'on' : ''}" data-cli="${x.id}">${esc(x.nome)}</button>`).join('')}</div>` : ''}
    <div class="ctx-tabs" role="tablist">${ABAS.map(([k, l]) => `<button role="tab" data-aba="${k}" aria-selected="${abaAtiva === k}" class="${abaAtiva === k ? 'on' : ''}">${l}</button>`).join('')}
      <button class="ctx-cfg ${S.view === 'clientes' ? 'on' : ''}" data-aba="clientes" title="Clientes, contrato e metas" aria-label="Configurações do projeto">⚙</button></div>`;
  $$('[data-crumb]', el).forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (a.dataset.crumb === 'inicio') return abrirProjeto('', 'inicio');
    S.cliente = ''; localStorageSet('pbh_cliente', ''); S.view = 'solicitar'; render();
  }));
  $$('[data-cli]', el).forEach((b) => b.addEventListener('click', () => { S.cliente = b.dataset.cli; localStorageSet('pbh_cliente', S.cliente); render(); }));
  $$('[data-aba]', el).forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.aba; render(); }));
}

const opcoesProjetos = (sel) => S.projetos.filter((p) => p.tipo !== 'empregos').map((p) => `<option value="${p.id}" ${String(p.id) === String(sel) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');

// ---------------- Caixa de demandas (tela inicial) ----------------
const TIPOS_DEMANDA = [
  ['conteudo', '✍️', 'Conteúdo', 'Hugo · posts, roteiros, artigos'],
  ['criacao', '🎨', 'Criação', 'Luiz e Davi · artes e vídeos'],
  ['trafego', '📈', 'Tráfego', 'Camila · campanhas e anúncios'],
  ['livre', '🧠', 'Livre', 'Escreva do seu jeito · o time entende'],
];
const PLACEHOLDER_DEMANDA = 'Ex.: Post de Natal com a promoção de 20% nas diárias, tom acolhedor, para a próxima semana';
const PLACEHOLDER_LIVRE = 'Ex.: Faça 3 posts de Natal para a Disco e uma campanha de conversão para a Operizy, com foco em novos leads. Pode citar vários clientes e itens.';

function caixaDemandas(clientes, projetos, opts = {}) {
  const grupos = projetos.filter((p) => p.tipo !== 'empregos').map((p) => {
    const cl = clientes.filter((c) => c.project_id === p.id);
    return cl.length ? `<optgroup label="${esc(p.nome)}">${cl.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `<section class="card demanda" aria-labelledby="dmTit">
    <h3 id="dmTit">📥 ${esc(opts.titulo || 'Nova demanda')}</h3>
    <p class="muted" style="margin:2px 0 12px">Escolha o cliente e o tipo e escreva o pedido. O time executa (texto, arte, plano) e a entrega fica <b>aguardando a sua aprovação</b>; só depois de aprovada segue para publicação.</p>
    <div class="dm-linha">
      <div class="dm-cli"><label for="dmCli">Cliente</label><select id="dmCli" ${opts.clienteFixo ? 'disabled' : ''}><option value="">Escolha o cliente…</option>${grupos}</select></div>
      <div><label>Tipo de demanda</label><div class="dm-tipos" role="radiogroup" aria-label="Tipo de demanda">
        ${TIPOS_DEMANDA.map(([k, ic, l, sub], i) => `<label class="dm-tipo"><input type="radio" name="dmTipo" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${ic} ${l}</b><small>${esc(sub)}</small></span></label>`).join('')}</div></div>
      <div class="dm-prazo"><label for="dmPrazo">Prazo (opcional)</label><input type="date" id="dmPrazo"></div>
    </div>
    <label for="dmTxt" style="margin-top:12px">Demanda</label>
    <textarea id="dmTxt" rows="4" placeholder="${PLACEHOLDER_DEMANDA}"></textarea>
    <div class="acoes-res"><button class="btn primary" id="dmEnviar">Enviar demanda</button><span class="erro" id="dmErro" role="alert"></span></div>
    <div id="dmRes" aria-live="polite"></div>
  </section>`;
}

function ligarCaixaDemandas(v, clientes, opts = {}) {
  const btn = $('#dmEnviar', v);
  if (opts.clienteId) $('#dmCli', v).value = String(opts.clienteId);
  else if (S.cliente && clientes.some((c) => String(c.id) === String(S.cliente))) $('#dmCli', v).value = String(S.cliente);
  const tipoAtual = () => ($$('input[name=dmTipo]', v).find((r) => r.checked) || {}).value;
  const rotuloBtn = () => (tipoAtual() === 'livre' ? 'Enviar comando' : 'Enviar demanda');
  const ajustarModo = () => {
    const livre = tipoAtual() === 'livre';
    $('#dmTxt', v).placeholder = livre ? PLACEHOLDER_LIVRE : PLACEHOLDER_DEMANDA;
    const rot = $('label[for=dmCli]', v); if (rot) rot.textContent = livre ? 'Cliente (opcional)' : 'Cliente';
    const op = $('#dmCli option[value=""]', v); if (op) op.textContent = livre ? 'Deixar o time identificar pelo texto…' : 'Escolha o cliente…';
    // No comando livre, um cliente já marcado restringiria o pedido a ele: começa vazio para o time identificar pelo texto
    if (livre && !$('#dmCli', v).disabled) $('#dmCli', v).value = '';
    btn.textContent = rotuloBtn();
  };
  $$('input[name=dmTipo]', v).forEach((r) => r.addEventListener('change', ajustarModo));
  btn.onclick = async () => {
    const client_id = Number($('#dmCli', v).value);
    const tipo = tipoAtual();
    const texto = $('#dmTxt', v).value.trim();
    const erro = $('#dmErro', v); erro.textContent = '';
    if (tipo === 'livre') {
      // Comando livre: o Claude identifica clientes e itens; as pautas entram em fila e o time executa até a aprovação
      if (!texto) return (erro.textContent = 'Escreva o comando');
      btn.disabled = true; btn.textContent = 'O time está entendendo o pedido…';
      try {
        const corpo = { texto };
        if (client_id) corpo.client_id = client_id; else if (opts.projectId) corpo.project_id = opts.projectId;
        mostrarComando(v, await api('/api/comandos', { method: 'POST', body: corpo }));
        $('#dmTxt', v).value = '';
      } catch (e) { erro.textContent = e.message; }
      btn.disabled = false; btn.textContent = rotuloBtn();
      return;
    }
    if (!client_id) return (erro.textContent = 'Escolha o cliente');
    if (!texto) return (erro.textContent = 'Escreva a demanda');
    btn.disabled = true; btn.textContent = 'Criando a pauta…';
    try {
      const r = await api('/api/demandas', { method: 'POST', body: { client_id, tipo, texto, prazo: $('#dmPrazo', v).value } });
      $('#dmTxt', v).value = ''; $('#dmPrazo', v).value = '';
      $('#dmRes', v).innerHTML = `<div class="alerta ok" style="margin-top:12px">
        <b>Pauta criada</b> em ${esc(r.projeto.nome)} › ${esc(r.cliente.nome)}: “${esc(r.tarefa.tema)}”
        <small class="muted"> · responsável ${esc(r.tarefa.responsavel)}${r.executando ? '' : ' · o time não executou (falta a chave do Claude em Integrações); a pauta ficou em Pauta'}</small>
        <div class="acoes-res"><button class="btn small" id="dmAbrir">Abrir no projeto</button><button class="btn small" id="dmTarefa">Ver a tarefa</button></div></div>`;
      $('#dmAbrir', v).onclick = async () => { await abrirProjeto(r.projeto.id, 'quadro'); S.cliente = String(r.cliente.id); S.quadroTipo = ''; localStorageSet('pbh_cliente', S.cliente); render(); };
      $('#dmTarefa', v).onclick = () => abrirTarefa(r.tarefa);
      if (r.executando) {
        $('#dmRes', v).insertAdjacentHTML('beforeend', '<div class="alerta" id="dmProg" style="margin-top:8px">⏳ <b>Time trabalhando…</b> <span id="dmProgMsg">começando</span></div>');
        acompanharEsteira(r.tarefa.id, r.cliente.id, $('#dmProgMsg', v), () => { const f = $('#filaAprov', v); if (f && f.refresh) f.refresh(); });
      }
    } catch (e) { erro.textContent = e.message; }
    btn.disabled = false; btn.textContent = rotuloBtn();
  };
}

// Resultado do comando livre: o que foi criado, dúvidas do time e o andamento de cada pauta
function mostrarComando(v, r) {
  const raiz = $('#dmRes', v);
  const lista = (itens) => `<ul class="dm-lista">${itens.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  raiz.innerHTML = `<div class="alerta ${r.criadas.length ? 'ok' : ''}" style="margin-top:12px">
    <b>${r.criadas.length ? `${r.criadas.length} pauta${r.criadas.length > 1 ? 's' : ''} criada${r.criadas.length > 1 ? 's' : ''}; o time está executando` : 'Nenhuma pauta criada'}</b>${r.resumo ? ` · ${esc(r.resumo)}` : ''}
    ${r.criadas.length ? `<ul class="dm-lista">${r.criadas.map((x) => `<li data-tid="${x.tarefa.id}"><b>${esc(x.cliente.nome)}</b> · ${esc(x.tarefa.tema)} <small class="muted">· ${esc(x.tarefa.responsavel)}${x.tarefa.data ? ' · prazo ' + esc(fmtPrazo(x.tarefa.data)) : ''}</small><div class="muted" data-st>${x.executando ? '⏳ Na fila do time…' : 'Ficou em Pauta (os agentes não estão ativos)'}</div></li>`).join('')}</ul>` : ''}
    ${r.duvidas.length ? `<p style="margin:10px 0 0"><b>Para esclarecer:</b></p>${lista(r.duvidas.map(esc))}` : ''}
    ${r.ignoradas.length ? `<p style="margin:10px 0 0"><b>Não criadas:</b></p>${lista(r.ignoradas.map(esc))}` : ''}
    ${r.criadas.length ? '<p class="muted" style="margin:10px 0 0">Quando ficarem prontas, aparecem na fila de aprovação. Nada é publicado sem o seu clique.</p>' : ''}</div>`;
  acompanharLote(r.criadas.filter((x) => x.executando).map((x) => [x.tarefa.id, x.cliente.id]), raiz, () => { const f = $('#filaAprov', v); if (f && f.refresh) f.refresh(); });
}

// Acompanha várias tarefas de uma vez (uma consulta por cliente), atualizando a linha de cada uma
function acompanharLote(pares, raiz, quandoPronto) {
  const pendentes = new Map(pares);
  let tentativas = 0;
  const volta = async () => {
    if (!raiz.isConnected || ++tentativas > 200 || !pendentes.size) return;
    try {
      const porCliente = new Map();
      for (const [tid, cid] of pendentes) { if (!porCliente.has(cid)) porCliente.set(cid, []); porCliente.get(cid).push(tid); }
      for (const [cid, ids] of porCliente) {
        const lista = await api('/api/esteira?client_id=' + cid);
        for (const tid of ids) {
          const st = raiz.querySelector(`[data-tid="${tid}"] [data-st]`);
          if (!st) { pendentes.delete(tid); continue; }
          const t = lista.find((x) => x.id === tid);
          if (t && t.esteira === 'executando') st.textContent = '⏳ ' + (t.esteira_msg || 'Trabalhando…');
          else if (t && t.esteira === 'erro') { st.textContent = '⚠️ O time não conseguiu: ' + (t.esteira_msg || ''); pendentes.delete(tid); }
          else if (t) { st.textContent = '✅ Pronto para a sua aprovação'; pendentes.delete(tid); quandoPronto && quandoPronto(); }
        }
      }
    } catch { /* tenta de novo */ }
    if (pendentes.size) setTimeout(volta, 5000);
  };
  setTimeout(volta, 3000);
}

// ---------------- Início: cards de projetos + Criar ----------------
async function viewInicio(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const clientesTodos = await api('/api/clients');
  // Projetos: só botões; ao clicar abre a área do projeto
  const cards = S.projetos.map((p) => `<button class="proj-btn" style="--cor:${esc(p.cor)}" ${p.tipo === 'empregos' ? 'data-emp="1"' : `data-abrir="${p.id}"`}>${esc(p.nome)}</button>`).join('');

  const acoes = [
    ['hugo', 'Conteúdo', 'Legendas, carrosséis, roteiros e artigos'],
    ['luiz', 'Artes', 'Direção de arte e prompts de imagem'],
    ['davi', 'Edição de vídeo', 'Roteiro, decupagem e passo a passo'],
    ['camila', 'Campanhas de anúncios', 'Meta, Google e LinkedIn Ads'],
    ['bianca', 'Candidaturas', 'Perfil, currículo e vagas (Workana, LinkedIn)'],
  ].map(([id, titulo, sub]) => {
    const a = agente(id);
    return `<button class="ag-card" data-ag="${id}">
      <span class="ag-ico">${a.icone}</span>
      <span><b>${esc(titulo)}</b><small>com ${esc(a.nome)} · ${esc(a.cargo)}</small><em>${esc(sub)}</em></span>
    </button>`;
  }).join('');

  v.innerHTML = `
    <div class="view-head"><div><h2>Projetos</h2><p>Receba uma demanda, escolha um projeto ou crie algo agora.</p></div>
      ${S.me.papel === 'admin' ? '<button class="btn" id="novoProj">+ Novo projeto</button>' : ''}</div>
    ${caixaDemandas(clientesTodos, S.projetos)}
    <h3 class="secao-h">Projetos</h3>
    <div class="proj-btns">${cards}</div>
    <h3 class="secao-h">Criar</h3>
    ${AGENTES.length && !AGENTES[0].ativo ? '<div class="alerta">Os agentes ainda não estão ativos: falta configurar <b>ANTHROPIC_API_KEY</b> no Render.</div>' : ''}
    <div class="ag-grid">${acoes}</div>`;

  ligarCaixaDemandas(v, clientesTodos);
  $$('[data-emp]', v).forEach((b) => b.addEventListener('click', () => { S.projeto = ''; S.view = 'empregos'; render(); }));
  $$('[data-abrir]', v).forEach((b) => b.addEventListener('click', () => abrirProjeto(b.dataset.abrir, 'solicitar')));
  $$('[data-criar-em]', v).forEach((b) => b.addEventListener('click', () => abrirProjeto(b.dataset.criarEm, 'criar')));
  $$('[data-solic-em]', v).forEach((b) => b.addEventListener('click', () => abrirProjeto(b.dataset.solicEm, 'solicitacoes')));
  $$('[data-editar]', v).forEach((b) => b.addEventListener('click', () => abrirContextoProjeto(projetoPorId(b.dataset.editar))));
  $$('[data-ag]', v).forEach((b) => b.addEventListener('click', () => iniciarAgente(b.dataset.ag)));
  const np = $('#novoProj', v);
  if (np) np.addEventListener('click', () => abrirContextoProjeto(null));
}

function iniciarAgente(id) {
  if (id === 'felipe') { S.view = 'mensagens'; render(); return; }
  if (id === 'bianca') { S.view = 'empregos'; render(); return; }
  abrirCriar(id);
}

function abrirContextoProjeto(p) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${p ? 'Contexto · ' + esc(p.nome) : 'Novo projeto'}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <div class="row"><div><label>Nome</label><input id="pjNome" value="${esc(p?.nome || '')}"></div>
        <div><label>Cor</label><input type="color" id="pjCor" value="${esc(p?.cor || '#b3202a')}"></div></div>
      <div><label>Descrição (aparece no card)</label><input id="pjDesc" value="${esc(p?.descricao || '')}" maxlength="600"></div>
      <div><label>Identidade, tom de voz, público e regras (os agentes seguem isto em tudo o que criam)</label>
        <textarea id="pjCtx" rows="9">${esc(p?.contexto || '')}</textarea></div>
      <div><label>Kit de marca no Canva</label>${seletorKit('pjKit', p?.canva_kit_id, p?.canva_kit_nome)}</div>
      <div><label>Guia de marca para o designer (a "skill" que Luiz e Davi seguem)</label>
        <textarea id="pjGuia" rows="10" placeholder="Paleta com hex, tipografia, estilo, regras, o que nunca fazer...">${esc(p?.guia_design || '')}</textarea></div>
      <p class="erro" id="pjErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="pjSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#pjSalvar').addEventListener('click', async () => {
    const body = { nome: $('#pjNome').value, cor: $('#pjCor').value, descricao: $('#pjDesc').value, contexto: $('#pjCtx').value,
      canva_kit_nome: lerKit('pjKit').nome, canva_kit_id: lerKit('pjKit').id, guia_design: $('#pjGuia').value };
    try {
      await api(p ? '/api/projects/' + p.id : '/api/projects', { method: p ? 'PUT' : 'POST', body });
      d.close(); await carregarProjetos(); toast('Projeto salvo'); render();
    } catch (err) { $('#pjErro').textContent = err.message; }
  });
}

// ---------------- Criar: modal com Hugo, Luiz, Davi e Camila ----------------
async function abrirCriar(agId, opcoes = {}) {
  await carregarAgentes();
  const a = agente(agId);
  const d = $('#modal');
  const projetoInicial = opcoes.projeto || S.projeto || (S.projetos[0] && S.projetos[0].id);
  const pedidoInicial = opcoes.pedido || '';
  const clientesDe = (pid) => S.clients.filter((c) => !pid || String(c.project_id) === String(pid));
  d.innerHTML = `<form method="dialog" class="criar">
    <div class="modal-head"><h3>${a.icone} ${esc(a.nome)} · ${esc(a.cargo)}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">${esc(a.descricao)}</p>
      <div class="row"><div><label>Projeto</label><select id="crProj">${opcoesProjetos(projetoInicial)}</select></div>
        <div><label>Cliente (opcional)</label><select id="crCli"></select></div></div>
      <div class="row"><div><label>${agId === 'camila' ? 'Tipo de campanha' : 'Formato'}</label>
        <select id="crFmt">${a.formatos.map((f) => `<option>${esc(f)}</option>`).join('')}</select></div>
        <div><label>Canal / plataforma</label><input id="crCanal" placeholder="Instagram, LinkedIn, Meta Ads..."></div></div>
      <div><label>O que você quer criar</label>
        <textarea id="crPedido" rows="5" placeholder="Ex.: promoção de fim de ano, público feminino 25-45, tom leve; CTA para o WhatsApp">${esc(pedidoInicial)}</textarea></div>
      <div id="crSaida"></div>
      <p class="erro" id="crErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="crGerar">Gerar com ${esc(a.nome)}</button></div></div>
  </form>`;
  d.showModal();

  const clientes = async () => {
    const pid = $('#crProj').value;
    let lista = S.clients;
    if (String(S.projeto) !== String(pid)) lista = await api('/api/clients?project_id=' + pid);
    $('#crCli').innerHTML = '<option value="">Sem cliente específico</option>' + lista.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    const pref = opcoes.cliente || S.cliente;
    if (pref && lista.some((c) => String(c.id) === String(pref))) $('#crCli').value = pref;
  };
  $('#crProj').addEventListener('change', clientes);
  clientes();

  $('#crGerar').addEventListener('click', async () => {
    const btn = $('#crGerar');
    $('#crErro').textContent = '';
    if (!$('#crPedido').value.trim()) { $('#crErro').textContent = 'Descreva o que você quer criar'; return; }
    btn.disabled = true; btn.textContent = `${a.nome} está trabalhando…`;
    try {
      const c = await api('/api/criar', { method: 'POST', body: {
        agente: agId, project_id: Number($('#crProj').value) || null, client_id: Number($('#crCli').value) || null,
        formato: $('#crFmt').value, plataforma: $('#crCanal').value, pedido: $('#crPedido').value } });
      mostrarCriacao(c, $('#crSaida'));
      if (opcoes.aoGerar) opcoes.aoGerar(c);
    } catch (err) { $('#crErro').textContent = err.message; }
    btn.disabled = false; btn.textContent = `Gerar de novo com ${a.nome}`;
  });
}

const CANVA_CRIAR = [
  [/stor|reels|1080x1920|vertical/i, 'https://www.canva.com/create/instagram-stories/'],
  [/linkedin/i, 'https://www.canva.com/create/linkedin-posts/'],
  [/an[uú]ncio|criativo/i, 'https://www.canva.com/create/facebook-ads/'],
  [/thumbnail|capa de v[ií]deo/i, 'https://www.canva.com/create/youtube-thumbnails/'],
];
const canvaUrlPara = (formato) => (CANVA_CRIAR.find(([r]) => r.test(formato || '')) || [0, 'https://www.canva.com/create/instagram-posts/'])[1];

function mostrarCriacao(c, el) {
  const luiz = c.agente === 'luiz';
  el.innerHTML = `${luiz ? `<div class="canva-box"><b>🎨 Canva</b>
      <p class="muted" style="margin:4px 0 8px">${c.kit ? `Kit de marca: <b>${esc(c.kit.nome || '')}</b>. ` : 'Sem kit de marca vinculado a esta marca (defina no guia de marca). '}
      Para criar a arte pronta, peça no Claude: <i>"crie no Canva a arte da criação #${c.id}"</i>. Ou monte você mesma: copie o prompt e abra o Canva.</p>
      <div class="acoes-res"><button type="button" class="btn small" id="cvAbrir">Copiar e abrir Canva</button></div>
      <label style="margin-top:8px">Link da arte no Canva</label>
      <div style="display:flex;gap:8px"><input id="cvLink" placeholder="https://www.canva.com/design/..." value="${esc(c.arte_url || '')}"><button type="button" class="btn small" id="cvSalvar">Salvar link</button></div></div>` : ''}
    <label>Resultado (pode editar)</label>
    <textarea id="crTexto" rows="16" class="resultado">${esc(c.saida)}</textarea>
    <div class="acoes-res">
      <button type="button" class="btn small" id="crCopiar">Copiar</button>
      <button type="button" class="btn small" id="crSalvar">Salvar edição</button>
      <button type="button" class="btn small" id="crAprovar">${c.status === 'aprovado' ? 'Aprovado ✓' : 'Aprovar'}</button>
      <button type="button" class="btn small" id="crTarefa">Virar tarefa</button>
      ${['hugo', 'camila'].includes(c.agente) ? '<button type="button" class="btn small primary" id="crPublicar">Publicar…</button>' : ''}
      <button type="button" class="btn small danger" id="crExcluir">Excluir</button>
    </div>`;
  $('#crCopiar').onclick = () => copiar($('#crTexto').value);
  if (luiz) {
    $('#cvAbrir').onclick = () => { copiar($('#crTexto').value); window.open(canvaUrlPara(c.formato), '_blank', 'noopener'); };
    $('#cvSalvar').onclick = async () => {
      try { c = await api('/api/criacoes/' + c.id, { method: 'PUT', body: { arte_url: $('#cvLink').value.trim() } }); toast(c.arte_url ? 'Link salvo' : 'Link removido'); }
      catch (e) { toast(e.message); }
    };
  }
  $('#crSalvar').onclick = async () => { try { c = await api('/api/criacoes/' + c.id, { method: 'PUT', body: { saida: $('#crTexto').value } }); toast('Salvo'); } catch (e) { toast(e.message); } };
  $('#crAprovar').onclick = async () => {
    try { c = await api('/api/criacoes/' + c.id, { method: 'PUT', body: { saida: $('#crTexto').value, status: c.status === 'aprovado' ? 'rascunho' : 'aprovado' } }); mostrarCriacao(c, el); toast(c.status === 'aprovado' ? 'Aprovado' : 'Voltou para rascunho'); }
    catch (e) { toast(e.message); }
  };
  $('#crTarefa').onclick = () => virarTarefa(c);
  const pub = $('#crPublicar'); if (pub) pub.onclick = () => abrirPublicar($('#crTexto').value, { clientId: c.client_id });
  $('#crExcluir').onclick = async () => {
    if (!confirm('Excluir esta criação?')) return;
    try { await api('/api/criacoes/' + c.id, { method: 'DELETE' }); el.innerHTML = ''; toast('Excluída'); if (S.view === 'criar') render(); } catch (e) { toast(e.message); }
  };
}

async function virarTarefa(c) {
  const lista = await api('/api/clients' + (c.project_id ? '?project_id=' + c.project_id : ''));
  if (!lista.length) return toast('Este projeto ainda não tem clientes');
  const d = document.createElement('dialog');
  d.className = 'mini';
  d.innerHTML = `<form method="dialog"><div class="modal-body">
    <h3 style="margin-bottom:10px">Criar tarefa a partir da criação</h3>
    <label>Cliente</label><select id="vtCli">${lista.map((x) => `<option value="${x.id}" ${String(x.id) === String(c.client_id) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
    <label style="margin-top:8px">Data (opcional)</label><input type="date" id="vtData">
    <p class="erro" id="vtErro"></p></div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="vtOk">Criar tarefa</button></div></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener('close', () => d.remove());
  $('#vtOk', d).onclick = async () => {
    try {
      await api(`/api/criacoes/${c.id}/tarefa`, { method: 'POST', body: { client_id: Number($('#vtCli', d).value), data: $('#vtData', d).value } });
      d.close(); toast('Tarefa criada na etapa Conteúdo / copy');
    } catch (e) { $('#vtErro', d).textContent = e.message; }
  };
}

// ---------------- Criar (dentro de um projeto) ----------------
async function viewCriar(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  const time = ['hugo', 'luiz', 'davi', 'camila'].map((id) => {
    const a = agente(id);
    return `<button class="ag-card" data-ag="${id}"><span class="ag-ico">${a.icone}</span>
      <span><b>${esc(a.nome)}</b><small>${esc(a.cargo)}</small><em>${esc(a.descricao)}</em></span></button>`;
  }).join('');
  const hist = await api('/api/criacoes' + (S.projeto ? '?project_id=' + S.projeto : ''));
  v.innerHTML = `
    <div class="view-head"><div><h2>Criar${p ? ' · ' + esc(p.nome) : ''}</h2>
      <p>Escolha quem vai fazer. Nada é publicado sozinho: você revisa, edita e aprova.</p></div>
      <button class="btn" id="impPautas">⇪ Importar pautas</button></div>
    ${AGENTES.length && !AGENTES[0].ativo ? '<div class="alerta">Os agentes ainda não estão ativos: falta configurar <b>ANTHROPIC_API_KEY</b> no Render.</div>' : ''}
    <div class="ag-grid">${time}</div>
    <h3 class="secao-h">Criações recentes</h3>
    <div class="card">${hist.length ? hist.map((c) => {
      const a = agente(c.agente);
      return `<button class="linha-cr" data-cr="${c.id}"><span class="ag-ico sm">${a.icone}</span>
        <span class="lc-t"><b>${esc((c.pedido || '').split('\n')[0].slice(0, 90))}</b><small>${esc(a.nome)} · ${esc(c.formato || '')} · ${esc(new Date(c.created_at).toLocaleDateString('pt-BR'))}</small></span>
        <span class="pill ${c.status === 'aprovado' ? 'ok' : ''}">${c.status === 'aprovado' ? 'Aprovado' : 'Rascunho'}</span></button>`;
    }).join('') : '<div class="empty">Nada criado ainda. Escolha um agente acima.</div>'}</div>`;
  $$('[data-ag]', v).forEach((b) => b.addEventListener('click', () => abrirCriar(b.dataset.ag)));
  $('#impPautas', v).addEventListener('click', () => abrirImportar());
  $$('[data-cr]', v).forEach((b) => b.addEventListener('click', () => {
    const c = hist.find((x) => String(x.id) === b.dataset.cr);
    const a = agente(c.agente);
    const d = $('#modal');
    d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>${a.icone} ${esc(a.nome)} · ${esc(c.formato || '')}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
      <div class="modal-body"><p class="muted" style="margin:0"><b>Pedido:</b> ${esc(c.pedido)}</p><div id="crSaida"></div></div></form>`;
    d.showModal();
    mostrarCriacao(c, $('#crSaida'));
    d.addEventListener('close', () => render(), { once: true });
  }));
}

function abrirGuiaCliente(cl, depois) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>Guia de marca · ${esc(cl.nome)}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">É o padrão que o Luiz (artes) e o Davi (vídeos) seguem ao criar para este cliente.</p>
      <div><label>Kit de marca no Canva</label>${seletorKit('gcKit', cl.canva_kit_id, cl.canva_kit_nome)}</div>
      <label class="chk"><input type="checkbox" id="gcPropria" ${cl.marca_propria ? 'checked' : ''}> Este cliente é a própria marca do projeto (usa o guia do projeto quando não tiver o seu)</label>
      <div><label>Guia (paleta com hex, tipografia, estilo, regras)</label>
        <textarea id="gcGuia" rows="12" placeholder="Se ficar vazio, o designer NÃO usa a identidade do projeto e marca [CONFIRMAR] na peça.">${esc(cl.guia_design || '')}</textarea></div>
      <p class="erro" id="gcErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="gcSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#gcSalvar').onclick = async () => {
    const k = lerKit('gcKit');
    try {
      await api(`/api/clients/${cl.id}/guia`, { method: 'PUT', body: { canva_kit_id: k.id, canva_kit_nome: k.nome, marca_propria: $('#gcPropria').checked, guia_design: $('#gcGuia').value } });
      d.close(); await carregarClientes(); toast('Guia salvo'); depois && depois();
    } catch (e) { $('#gcErro').textContent = e.message; }
  };
}

// ---------------- Esteira: time executa -> aprovação -> publicação ----------------
function acompanharEsteira(taskId, clientId, msgEl, quandoPronto) {
  let tentativas = 0;
  const volta = async () => {
    if (!msgEl.isConnected || ++tentativas > 150) return;
    try {
      const lista = await api('/api/esteira?client_id=' + clientId);
      const t = lista.find((x) => x.id === taskId);
      if (t && t.esteira === 'executando') { msgEl.textContent = t.esteira_msg || 'trabalhando'; return setTimeout(volta, 4000); }
      if (t && t.esteira === 'erro') { msgEl.parentElement.className = 'alerta danger'; msgEl.parentElement.innerHTML = `<b>O time não conseguiu:</b> ${esc(t.esteira_msg || '')}`; return; }
      if (t) { msgEl.parentElement.className = 'alerta ok'; msgEl.parentElement.innerHTML = '✅ <b>Pronto para a sua aprovação.</b> Veja na fila abaixo.'; quandoPronto && quandoPronto(); }
    } catch { setTimeout(volta, 6000); }
  };
  setTimeout(volta, 3000);
}

// Texto que vai ao ar: extrai a legenda do que o Hugo escreveu (o resto é briefing e conferências)
function extrairLegenda(txt) {
  const t = String(txt || '');
  const m = t.match(/^[#*\s]*LEGENDA[^\n]*\n([\s\S]*?)(?=\n[#*\s]*(BRIEFING|HASHTAGS|CONFERIR|OP[ÇC][ÕO]ES|CARD\s*1|CAPA)\b|(?![\s\S]))/im);
  return (m ? m[1] : t).replace(/^\s+|\s+$/g, '');
}

function abrirAjustes(t, depois) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>Pedir ajustes ao time</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body"><p class="muted" style="margin:0">“${esc(t.tema || '')}”. O time refaz com o que você pedir e a tarefa volta para a fila de aprovação.</p>
      <div><label>O que ajustar</label><textarea id="ajTxt" rows="5" placeholder="Ex.: mais curto, citar o buggy, tirar o preço, trocar o gancho"></textarea></div><p class="erro" id="ajErro" style="margin:0"></p></div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="ajOk">Refazer</button></div></div></form>`;
  d.showModal();
  $('#ajOk').onclick = async () => {
    try { await api(`/api/tasks/${t.id}/ajustar`, { method: 'POST', body: { ajuste: $('#ajTxt').value } }); d.close(); toast('O time está refazendo'); depois && depois(); }
    catch (e) { $('#ajErro').textContent = e.message; }
  };
}

async function aprovarTarefa(t, depois) {
  // Posts e stories passam pela Social media (Mariana): agendar ou publicar agora. Os demais tipos só são aprovados.
  if (['post', 'story'].includes(t.tipo)) return abrirPublicar(extrairLegenda(t.tipo === 'story' ? (t.briefing || '') : (t.legenda || '')), { taskId: t.id, clientId: t.client_id, depois, aprovar: true, imagem: t.publicar_imagem });
  try { await api(`/api/tasks/${t.id}/aprovar`, { method: 'POST' }); } catch (e) { return toast(e.message); }
  toast('Aprovada.');
  depois && depois();
}

// Conteúdo que a pessoa aprova: a legenda (post), o roteiro (story) ou o plano/briefing (criação e tráfego)
function conteudoDaTarefa(t) {
  if (t.tipo === 'post') return extrairLegenda(t.legenda || t.briefing || '');
  if (t.tipo === 'story') return extrairLegenda(t.briefing || '');
  return String(t.legenda || t.briefing || '').slice(0, 2500);
}

// Fila de aprovação do projeto ou do cliente
function filaAprovacao(el, filtro) {
  const q = filtro.client_id ? 'client_id=' + filtro.client_id : 'project_id=' + filtro.project_id;
  let timer;
  const desenhar = async () => {
    if (!el.isConnected) return clearTimeout(timer);
    let lista = [];
    try { lista = await api('/api/esteira?' + q); } catch { return; }
    const rotulo = { executando: 'Time trabalhando', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada: falta publicar', agendada: 'Agendada (Mariana)', publicando: 'Mariana publicando', erro: 'Erro' };
    el.innerHTML = `<h3 class="secao-h">Esteira do time <span class="pill">${lista.length}</span></h3>
      ${lista.length ? lista.map((t) => `<article class="card esteira ${t.esteira}">
        <div class="msg-top"><span class="pill ${t.esteira === 'aprovada' ? 'ok' : ''}">${rotulo[t.esteira]}</span><span class="pill">${esc(TIPO_LABEL[t.tipo] || t.tipo)}</span>
          <small>${esc(t.cliente_nome)} · ${esc(t.responsavel || '')}${t.data ? ' · ' + esc(fmtPrazo(t.data)) : ''}</small></div>
        <b>${esc(t.tema || 'Sem título')}</b>
        ${t.esteira === 'executando' ? `<p class="muted" style="margin:4px 0 0">⏳ ${esc(t.esteira_msg || '')}</p>` : ''}
        ${t.esteira === 'erro' ? `<p class="erro" style="margin:4px 0 0">${esc(t.esteira_msg || '')}</p>` : ''}
        ${t.esteira === 'agendada' ? `<p class="muted" style="margin:4px 0 0">🗓 ${esc(t.esteira_msg || '')} · ${esc((t.plataformas || '').replace(/,/g, ', '))}. Publica sozinha no horário.</p>` : ''}
        ${t.esteira === 'aprovada' && /falhou|interrompida|cancelado/i.test(t.esteira_msg || '') ? `<p class="erro" style="margin:4px 0 0">${esc(t.esteira_msg)}</p>` : ''}
        ${['aguardando_aprovacao', 'aprovada', 'agendada'].includes(t.esteira) ? `
          <div class="est-label">Conteúdo</div><div class="est-conteudo">${esc(conteudoDaTarefa(t))}</div>
          <div class="est-label">Criativo</div>
          ${t.arte_url ? `<a class="est-arte" href="${esc(t.arte_url)}" target="_blank" rel="noopener">🎨 Abrir criativo no Canva ↗</a>` : '<div class="muted" style="font-size:13px">Sem link do criativo (adicione em Revisar › Arte no Canva)</div>'}` : ''}
        <div class="acoes-res">
          ${t.esteira === 'aguardando_aprovacao' ? `<button class="btn small primary" data-ap="${t.id}">✓ Aprovar e passar para a Social media</button><button class="btn small" data-rev="${t.id}">Revisar</button><button class="btn small" data-aj="${t.id}">Pedir ajustes</button>` : ''}
          ${t.esteira === 'aprovada' ? `${['post', 'story'].includes(t.tipo) ? `<button class="btn small primary" data-pub="${t.id}">Publicar…</button>` : ''}<button class="btn small" data-conc="${t.id}">Marcar como concluída</button><button class="btn small" data-rev="${t.id}">Abrir</button>` : ''}
          ${t.esteira === 'agendada' ? `<button class="btn small primary" data-pub="${t.id}">Publicar agora…</button><button class="btn small" data-desag="${t.id}">Cancelar agendamento</button>` : ''}
          ${t.esteira === 'erro' ? `<button class="btn small primary" data-ex="${t.id}">Tentar de novo</button>` : ''}
        </div></article>`).join('') : '<div class="card"><div class="empty" style="padding:16px">Nada na esteira. Envie um comando na caixa acima.</div></div>'}`;
    const achar = (id) => lista.find((x) => String(x.id) === String(id));
    $$('[data-ap]', el).forEach((b) => b.addEventListener('click', () => aprovarTarefa(achar(b.dataset.ap), desenhar)));
    $$('[data-rev]', el).forEach((b) => b.addEventListener('click', () => abrirTarefa(achar(b.dataset.rev))));
    $$('[data-aj]', el).forEach((b) => b.addEventListener('click', () => abrirAjustes(achar(b.dataset.aj), desenhar)));
    $$('[data-pub]', el).forEach((b) => b.addEventListener('click', () => { const t = achar(b.dataset.pub); abrirPublicar(extrairLegenda(t.tipo === 'story' ? (t.briefing || '') : (t.legenda || '')), { taskId: t.id, clientId: t.client_id, depois: desenhar, imagem: t.publicar_imagem }); }));
    $$('[data-desag]', el).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Cancelar o agendamento?')) return; try { await api(`/api/tasks/${b.dataset.desag}/desagendar`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    $$('[data-conc]', el).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/tasks/${b.dataset.conc}/concluir`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    $$('[data-ex]', el).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/tasks/${b.dataset.ex}/executar`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    clearTimeout(timer);
    if (lista.some((t) => t.esteira === 'executando')) timer = setTimeout(desenhar, 5000);
  };
  el.refresh = desenhar;
  desenhar();
}



// ---------------- Google Drive: escolher fotos e vídeos ----------------
async function abrirDrive(opts = {}) {
  const q0 = opts.clienteId ? 'client_id=' + opts.clienteId : opts.projetoId ? 'project_id=' + opts.projetoId : '';
  const d = document.createElement('dialog'); d.className = 'dlg-drive';
  const escolhidos = new Map(); let pilha = [{ id: 'root', nome: 'Meu Drive' }]; let busca = '';
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>📁 Google Drive</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><div id="dvCaminho" class="muted" style="flex:1"></div><input id="dvBusca" placeholder="Buscar por nome…" style="max-width:220px"></div>
      <div id="dvGrade" class="dv-grade"><div class="empty" style="padding:20px">Carregando…</div></div>
      <p class="erro" id="dvErro" style="margin:0"></p></div>
    <div class="modal-foot"><div id="dvSel" class="muted"></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${opts.pautas ? `<select id="dvPauta" aria-label="Pauta"><option value="">Anexar à pauta…</option>${opts.pautas.map((t) => `<option value="${t.id}">${esc((t.data ? String(t.data).slice(5, 10).split('-').reverse().join('/') + ' · ' : '') + (t.tema || 'Sem título'))}</option>`).join('')}</select>` : ''}
      <button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="dvOk" disabled>${opts.rotuloOk || 'Anexar'}</button></div></div></form>`;
  document.body.appendChild(d); d.showModal(); d.addEventListener('close', () => d.remove());
  const atualizaSel = () => { $('#dvSel', d).textContent = escolhidos.size ? `${escolhidos.size} selecionado(s)` : 'Clique nas fotos e vídeos para selecionar'; $('#dvOk', d).disabled = !escolhidos.size; };
  const carrega = async () => {
    const atual = pilha[pilha.length - 1];
    $('#dvCaminho', d).innerHTML = busca ? `Busca: <b>${esc(busca)}</b>` : pilha.map((x, i) => `<a href="#" data-n="${i}">${esc(x.nome)}</a>`).join(' › ');
    $$('[data-n]', d).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); pilha = pilha.slice(0, Number(a.dataset.n) + 1); carrega(); }));
    const g = $('#dvGrade', d); g.innerHTML = '<div class="empty" style="padding:20px">Carregando…</div>'; $('#dvErro', d).textContent = '';
    try {
      const r = await api(`/api/drive/arquivos?${q0}&pasta=${encodeURIComponent(atual.id)}${busca ? '&q=' + encodeURIComponent(busca) : ''}`);
      g.innerHTML = r.arquivos.length ? r.arquivos.map((f) => `<button type="button" class="dv-item ${escolhidos.has(f.id) ? 'on' : ''}" data-f="${esc(f.id)}" title="${esc(f.nome)}">
          ${f.pasta ? '<span class="dv-ico">📁</span>' : f.thumb ? `<img loading="lazy" alt="" src="${esc(f.thumb)}" referrerpolicy="no-referrer">` : '<span class="dv-ico">🎞</span>'}
          ${f.video ? `<i class="dv-play">▶ ${f.duracao ? f.duracao + 's' : ''}</i>` : ''}<span class="dv-nome">${esc(f.nome)}</span></button>`).join('') : '<div class="empty" style="padding:20px">Nenhuma pasta, foto ou vídeo aqui.</div>';
      $$('.dv-item', g).forEach((b) => b.addEventListener('click', () => {
        const f = r.arquivos.find((x) => x.id === b.dataset.f);
        if (f.pasta) { busca = ''; $('#dvBusca', d).value = ''; pilha.push({ id: f.id, nome: f.nome }); return carrega(); }
        if (escolhidos.has(f.id)) { escolhidos.delete(f.id); b.classList.remove('on'); } else { if (opts.unico) { escolhidos.clear(); $$('.dv-item.on', g).forEach((x) => x.classList.remove('on')); } escolhidos.set(f.id, f); b.classList.add('on'); }
        atualizaSel();
      }));
    } catch (e) { g.innerHTML = ''; $('#dvErro', d).textContent = e.message; }
  };
  let tm; $('#dvBusca', d).addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => { busca = e.target.value.trim(); carrega(); }, 400); });
  $('#dvOk', d).onclick = async () => {
    const arquivos = [...escolhidos.values()];
    if (opts.aoEscolher) { const ok = await opts.aoEscolher(arquivos, d); if (ok !== false) d.close(); return; }
    const pid = $('#dvPauta', d) && $('#dvPauta', d).value; if (!pid) return ($('#dvErro', d).textContent = 'Escolha a pauta que vai receber os arquivos');
    try { await api(`/api/tasks/${pid}/midias`, { method: 'POST', body: { arquivos } }); toast('Anexado à pauta'); d.close(); opts.depois && opts.depois(); }
    catch (e) { $('#dvErro', d).textContent = e.message; }
  };
  atualizaSel(); carrega();
}

// ---------------- Documento único de pauta ----------------
function abrirDocPauta(filtro) {
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>📄 Gerar doc de pauta</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body"><p class="muted" style="margin:0">Um documento único com as datas, as legendas e os criativos (links do Canva e fotos/vídeos do Drive) de todas as pautas do mês.</p>
      <div><label>Mês</label><input type="month" id="dcMes" value="${hoje}"></div>
      <p class="erro" id="dcErro" style="margin:0"></p><div id="dcRes"></div></div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="dcOk">Gerar documento</button></div></div></form>`;
  document.body.appendChild(d); d.showModal(); d.addEventListener('close', () => d.remove());
  $('#dcOk', d).onclick = async () => {
    const b = $('#dcOk', d); b.disabled = true; b.textContent = 'Gerando…'; $('#dcErro', d).textContent = '';
    try {
      const r = await api('/api/docs/pauta', { method: 'POST', body: { ...filtro, mes: $('#dcMes', d).value } });
      if (r.via === 'google') $('#dcRes', d).innerHTML = `<div class="alerta ok">✅ Documento criado no seu Google Drive com ${r.total} pauta(s).<br><a class="btn small primary" style="margin-top:8px" href="${esc(r.link)}" target="_blank" rel="noopener">Abrir no Google Docs ↗</a></div>`;
      else {
        const url = URL.createObjectURL(new Blob([r.html], { type: 'application/msword' })); const a = document.createElement('a'); a.href = url; a.download = r.nome.replace(/[^\w\- ·]/g, '') + '.doc'; document.body.appendChild(a); a.click(); a.remove();
        $('#dcRes', d).innerHTML = `<div class="alerta">O Google ainda não está conectado, então baixei o documento (${r.total} pauta(s)). Ele abre no Word e no Google Docs. Para criar direto no Drive, conecte o Google em <b>Acessos e APIs</b>.</div>`;
      }
    } catch (e) { $('#dcErro', d).textContent = e.message; }
    b.disabled = false; b.textContent = 'Gerar documento';
  };
}

// ---------------- Painel Conteúdo: metas da semana e colunas por etapa (modelo do Agente de Tráfego) ----------------
const COLUNAS_CT = [
  ['✍ Em arte', ['executando', 'erro'], '#7c5cff', 'Nada aqui. Peça uma pauta ao time ou clique em Rodar agora.'],
  ['⏳ Aguardando aprovação', ['aguardando_aprovacao'], '#f0a13a', 'Quando o time entregar, a peça aparece aqui para você aprovar.'],
  ['📅 Aprovado / agendado', ['aprovada', 'agendada', 'publicando'], '#4f8cff', 'Os posts aprovados ficam aqui até a hora de publicar.'],
  ['✅ Publicado / outros', ['publicada', 'legado'], '#2fbf71', 'Os últimos publicados aparecem aqui.'],
];
const fmtCt = (t) => { const f = `${t.formato || ''} ${t.tipo || ''}`.toLowerCase(); return /carrossel/.test(f) ? '🖼 Carrossel' : /reels|v[ií]deo/.test(f) ? '🎬 Reels' : t.tipo === 'story' ? '⭕ Story' : t.tipo === 'blog' ? '📝 Blog' : t.tipo === 'trafego' ? '📈 Campanha' : t.tipo === 'criacao' ? '🎨 Criação' : '📷 Feed'; };
const diaCt = (d) => d ? new Date(String(d).slice(0, 10) + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '') : 'sem data';
const dm = (ymd) => ymd.slice(8) + '/' + ymd.slice(5, 7);

function painelConteudo(v, filtro, ctx) {
  const q = filtro.client_id ? 'client_id=' + filtro.client_id : 'project_id=' + filtro.project_id;
  const raiz = $('#ctCols', v); let timer; let lista = [];
  const achar = (id) => lista.find((x) => String(x.id) === String(id));
  const cardCt = (t) => {
    const col = t.esteira || 'legado';
    const img = t.publicar_imagem && /^(https:\/\/|\/media\/)/.test(t.publicar_imagem) ? `<img class="ct-img" loading="lazy" alt="Arte" src="${esc(t.publicar_imagem)}">` : '';
    const chips = String(t.plataformas || '').split(',').filter(Boolean).map((x) => `<span class="chip ${t.esteira === 'publicada' ? 'ok' : ''}">${esc(x)}</span>`).join('');
    return `<article class="ct-card ${col}">
      <div class="ct-chips"><span class="chip">${fmtCt(t)}</span><span class="chip">📅 ${esc(diaCt(t.data))}</span>${t.esteira === 'erro' ? '<span class="chip bad">⚠ erro</span>' : ''}${t.esteira === 'agendada' ? `<span class="chip ok">🗓 ${esc((t.esteira_msg || '').replace(/^.*para /, ''))}</span>` : ''}</div>
      <b class="ct-tit">${esc(t.cliente_nome)} · ${esc(t.tema || 'Sem título')}</b>
      ${img}
      ${t.esteira === 'executando' ? `<p class="muted" style="margin:4px 0">⏳ ${esc(t.esteira_msg || '')}</p>` : ''}
      ${t.esteira === 'erro' ? `<p class="erro" style="margin:4px 0">${esc(t.esteira_msg || '')}</p>` : ''}
      ${t.esteira === 'aprovada' && /falhou|interrompida|cancelado/i.test(t.esteira_msg || '') ? `<p class="erro" style="margin:4px 0">${esc(t.esteira_msg)}</p>` : ''}
      ${['aguardando_aprovacao', 'aprovada', 'agendada', 'publicada', 'legado'].includes(col) ? `<div class="ct-texto">${esc(conteudoDaTarefa(t))}</div>` : ''}
      ${t.arte_url ? `<a class="est-arte" href="${esc(t.arte_url)}" target="_blank" rel="noopener">🎨 Abrir criativo no Canva ↗</a>` : (['aguardando_aprovacao', 'aprovada'].includes(col) ? '<small class="muted">Sem link do criativo</small>' : '')}
      ${(t.midias || []).length ? `<div class="ct-midias" title="Fotos e vídeos do Drive">${t.midias.slice(0, 6).map((m) => `<a href="${esc(m.link || '#')}" target="_blank" rel="noopener" title="${esc(m.nome)}">${m.thumb ? `<img loading="lazy" alt="" src="${esc(m.thumb)}" referrerpolicy="no-referrer">` : '<span>📄</span>'}${m.video ? '<i>▶</i>' : ''}</a>`).join('')}${t.midias.length > 6 ? `<small>+${t.midias.length - 6}</small>` : ''}</div>` : ''}
      ${chips ? `<div class="ct-chips">${chips}</div>` : ''}
      <div class="acoes-res">
        ${col === 'aguardando_aprovacao' ? `<button class="btn small primary" data-ap="${t.id}">Aprovar…</button><button class="btn small" data-rev="${t.id}">Revisar</button><button class="btn small" data-aj="${t.id}">Pedir ajustes</button>` : ''}
        ${col === 'aprovada' ? `${['post', 'story'].includes(t.tipo) ? `<button class="btn small primary" data-pub="${t.id}">Publicar…</button>` : ''}<button class="btn small" data-conc="${t.id}">Marcar como concluída</button>` : ''}
        ${col === 'agendada' ? `<button class="btn small primary" data-pub="${t.id}">Publicar agora…</button><button class="btn small" data-desag="${t.id}">Cancelar agendamento</button>` : ''}
        ${col === 'erro' ? `<button class="btn small primary" data-ex="${t.id}">Tentar de novo</button>` : ''}
        ${['publicada', 'legado'].includes(col) ? `<button class="btn small" data-rev="${t.id}">Ver</button>` : ''}
      </div></article>`;
  };
  const desenhar = async () => {
    if (!raiz.isConnected) return clearTimeout(timer);
    let r; try { r = await api('/api/conteudo?' + q); } catch { return; }
    lista = r.tarefas;
    $('#ctMetas', v).innerHTML = r.semanas.map((w) => {
      const pct = Math.min(100, Math.round((w.feitos / Math.max(1, w.meta)) * 100)); const falta = Math.max(0, w.meta - w.feitos);
      return `<div class="wk"><b>Semana ${dm(w.ini)}–${dm(w.fim)}</b><small>${w.feitos}/${w.meta} posts</small><div class="bar ${falta ? '' : 'full'}"><i style="width:${pct}%"></i></div>${falta ? `<div class="muted" style="margin-top:6px;font-size:12px">Faltam ${falta} para a meta</div>` : ''}</div>`;
    }).join('') + '<button class="btn" id="ctMeta" style="align-self:center">Alterar meta semanal</button>';
    $('#ctMeta', v).onclick = async () => {
      if (!ctx.cliente) return toast('Escolha um cliente (faixa acima) para alterar a meta dele');
      const x = prompt('Quantos posts por semana para ' + ctx.cliente.nome + '?', String(r.semanas[0]?.meta ?? 2)); if (x === null) return;
      try { await api(`/api/clients/${ctx.cliente.id}/meta-semanal`, { method: 'PUT', body: { meta: Number(x) } }); desenhar(); } catch (e) { toast(e.message); }
    };
    raiz.innerHTML = COLUNAS_CT.map(([titulo, estados, cor, vazio]) => {
      const itens = lista.filter((t) => estados.includes(t.esteira || 'legado'));
      return `<section class="ct-col" style="--cor:${cor}"><h4><span>${titulo}</span><b>${itens.length}</b></h4>${itens.length ? itens.map(cardCt).join('') : `<div class="ct-vazio">${vazio}</div>`}</section>`;
    }).join('');
    $$('[data-ap]', raiz).forEach((b) => b.addEventListener('click', () => aprovarTarefa(achar(b.dataset.ap), desenhar)));
    $$('[data-rev]', raiz).forEach((b) => b.addEventListener('click', () => abrirTarefa(achar(b.dataset.rev), { _onSalvo: desenhar })));
    $$('[data-aj]', raiz).forEach((b) => b.addEventListener('click', () => abrirAjustes(achar(b.dataset.aj), desenhar)));
    $$('[data-pub]', raiz).forEach((b) => b.addEventListener('click', () => { const t = achar(b.dataset.pub); abrirPublicar(extrairLegenda(t.tipo === 'story' ? (t.briefing || '') : (t.legenda || '')), { taskId: t.id, clientId: t.client_id, depois: desenhar, imagem: t.publicar_imagem }); }));
    $$('[data-desag]', raiz).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Cancelar o agendamento?')) return; try { await api(`/api/tasks/${b.dataset.desag}/desagendar`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    $$('[data-conc]', raiz).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/tasks/${b.dataset.conc}/concluir`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    $$('[data-ex]', raiz).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/tasks/${b.dataset.ex}/executar`, { method: 'POST' }); desenhar(); } catch (e) { toast(e.message); } }));
    clearTimeout(timer);
    if (lista.some((t) => t.esteira === 'executando')) timer = setTimeout(desenhar, 5000);
  };
  $('#ctRef', v).onclick = desenhar;
  $('#ctDrive', v).onclick = () => abrirDrive({ clienteId: filtro.client_id, projetoId: filtro.project_id, pautas: lista.filter((t) => !['publicada'].includes(t.esteira)), depois: desenhar });
  $('#ctDoc', v).onclick = () => abrirDocPauta(filtro);
  $('#ctNova', v).onclick = () => abrirTarefa(null, { client_id: ctx.cliente ? ctx.cliente.id : undefined, _onSalvo: desenhar });
  $('#ctRodar', v).onclick = async () => {
    const b = $('#ctRodar', v); b.disabled = true;
    try { const r = await api('/api/esteira/rodar', { method: 'POST', body: filtro }); toast(r.iniciadas ? `O time começou ${r.iniciadas} pauta(s). Elas chegam em "Aguardando aprovação".` : 'Nenhuma pauta pendente. Use "+ Nova pauta" ou "Pedir ao time".'); desenhar(); }
    catch (e) { toast(e.message); }
    b.disabled = false;
  };
  raiz.refresh = desenhar; v.refreshConteudo = desenhar;
  desenhar();
}

// ---------------- Solicitar: caixa de comandos, esteira do time e solicitações recebidas ----------------
async function viewSolicitar(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  if (!p) { S.view = 'inicio'; return render(); }
  const c = clienteAtual();
  const sols = await api('/api/solicitacoes?project_id=' + p.id);
  const abertas = sols.filter((x) => ['nova', 'andamento'].includes(x.status) && !x.task_id && (!c || !x.client_id || x.client_id === c.id));
  const alvo = c ? c.nome : p.nome;
  v.innerHTML = `
    <div class="view-head"><div><h2>Conteúdo · ${esc(alvo)}</h2>
        <div class="pipe"><span>✍ Hugo escreve a pauta</span><i>→</i><span>🎨 Luiz faz a arte</span><i>→</i><span class="on">✅ Você aprova</span><i>→</i><span>📅 Mariana agenda</span><i>↻</i></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start"><button class="btn" id="ctRef" title="Atualizar">↻</button><button class="btn" id="ctDrive">📁 Drive</button><button class="btn" id="ctDoc">📄 Gerar doc de pauta</button><button class="btn" id="ctNova">+ Nova pauta</button><button class="btn primary" id="ctRodar">▶ Rodar agora</button></div></div>
    <div class="metas" id="ctMetas"></div>
    <div class="paineis2">
      <details class="painel"><summary>💬 Pedir ao time <span class="note">descreva o post que você quer</span></summary><div class="in">${caixaDemandas(S.clients, [p], { titulo: 'Comandos para o time de ' + alvo, clienteFixo: !!c })}</div></details>
      <details class="painel"><summary>🔗 Fontes de pauta <span class="note">planilha, Google Docs ou Sheets</span></summary><div class="in">
        <p class="muted" style="margin:0 0 8px">O Claude lê o documento e gera as pautas; você cola aqui (ou envia pelo link de importação do projeto).</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="ctImp">⇪ Importar pautas</button><button class="btn" id="svLink">🔗 Link para clientes</button><button class="btn" id="svNova">+ Registrar solicitação</button></div></div></details>
    </div>
    <div id="ctCols" class="cols4"></div>
    <h3 class="secao-h">Solicitações recebidas <span class="pill">${abertas.length}</span></h3>
    ${abertas.length ? abertas.map((x) => `<article class="card sol">
      <div class="msg-top"><span class="pill">${esc(SOL_TIPOS[x.tipo])}</span>${x.origem === 'formulario' ? '<span class="pill">Formulário</span>' : ''}
        <small>${esc([x.solicitante, x.contato, x.prazo ? 'prazo ' + fmtPrazo(x.prazo) : ''].filter(Boolean).join(' · '))}</small></div>
      <b>${esc(x.titulo)}</b>${x.descricao ? `<p class="sol-desc">${esc(x.descricao)}</p>` : ''}
      <div class="acoes-res">
        <select data-sc="${x.id}" aria-label="Cliente">${S.clients.map((k) => `<option value="${k.id}" ${(x.client_id || (c && c.id)) === k.id ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select>
        <button class="btn small primary" data-env="${x.id}">Enviar ao time</button>
        <button class="btn small ghost" data-ed="${x.id}">Editar</button>
        <button class="btn small ghost danger" data-rm="${x.id}">Descartar</button></div></article>`).join('')
      : '<div class="card"><div class="empty" style="padding:16px">Nenhuma solicitação pendente. Quem tem o link do projeto pode pedir direto pelo formulário.</div></div>'}`;
  ligarCaixaDemandas(v, S.clients, { clienteId: c ? c.id : null, projectId: p.id });
  painelConteudo(v, c ? { client_id: c.id } : { project_id: p.id }, { cliente: c });
  $('#ctImp', v).onclick = () => abrirImportar();
  const porId = (id) => sols.find((x) => String(x.id) === String(id));
  $('#svLink', v).onclick = () => abrirLinkSolicitacao(p);
  $('#svNova', v).onclick = () => abrirSolicitacao(null, () => render());
  $$('[data-ed]', v).forEach((b) => b.addEventListener('click', () => abrirSolicitacao(porId(b.dataset.ed), () => render())));
  $$('[data-rm]', v).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Descartar esta solicitação?')) return; await api('/api/solicitacoes/' + b.dataset.rm, { method: 'DELETE' }); render(); }));
  $$('[data-env]', v).forEach((b) => b.addEventListener('click', async () => {
    const x = porId(b.dataset.env);
    const tipo = { conteudo: 'conteudo', arte: 'criacao', video: 'criacao', campanha: 'trafego' }[x.tipo] || 'conteudo';
    b.disabled = true; b.textContent = 'Enviando…';
    try {
      await api('/api/demandas', { method: 'POST', body: { client_id: Number($(`[data-sc="${x.id}"]`, v).value), tipo, solicitacao_id: x.id, prazo: x.prazo ? String(x.prazo).slice(0, 10) : '', texto: `${x.titulo}\n\n${x.descricao || ''}`.trim() } });
      toast('Enviado ao time'); render();
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Enviar ao time'; }
  }));
}

// ---------------- Relatórios por período ----------------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodoPreset(k) {
  const h = new Date(); const d0 = new Date(h.getFullYear(), h.getMonth(), h.getDate());
  const seg = new Date(d0); seg.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const soma = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (k === 'semana') return [iso(seg), iso(soma(seg, 6))];
  if (k === 'semana_passada') return [iso(soma(seg, -7)), iso(soma(seg, -1))];
  if (k === 'mes') return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(new Date(h.getFullYear(), h.getMonth() + 1, 0))];
  if (k === 'mes_passado') return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))];
  if (k === '30') return [iso(soma(d0, -29)), iso(d0)];
  return null;
}
const ROT_STATUS = { ...STATUS_LABEL };
const ROT_AGENTE = { hugo: 'Hugo (conteúdo)', luiz: 'Luiz (artes)', davi: 'Davi (vídeos)', camila: 'Camila (campanhas)' };

function relatorioMarkdown(r) {
  const d = r.dados; const f = (x) => String(x).slice(0, 10).split('-').reverse().join('/');
  const kv = (o, rot = (k) => k) => Object.entries(o || {}).map(([k, n]) => `- ${rot(k)}: ${n}`).join('\n') || '- nenhum';
  return [`# Relatório · ${d.escopo}`, `Período: ${f(d.periodo.de)} a ${f(d.periodo.ate)}`, '', '## Resumo', r.resumo || '', '',
    '## Números', `- Entregas planejadas: ${d.planejado.total}`, `- Publicadas: ${d.planejado.publicadas}`, `- Atrasadas: ${d.planejado.atrasadas}`,
    `- Aprovadas no período: ${d.esteira.aprovadas_no_periodo}`, `- Solicitações recebidas: ${d.solicitacoes.recebidas}`, '',
    '## Por tipo', kv(d.planejado.por_tipo, (k) => TIPO_LABEL[k] || k), '', '## Por etapa', kv(d.planejado.por_status, (k) => ROT_STATUS[k] || k), '',
    '## Time (criações no período)', kv(d.time, (k) => ROT_AGENTE[k] || k), '',
    '## Clientes', ...d.clientes.map((c) => `- ${c.nome}: ${c.posts_publicados} posts publicados (meta mensal ${c.meta_posts_mes})`), '',
    '## Entregas', ...d.entregas.map((e) => `- ${f(e.data)} · ${e.cliente} · ${TIPO_LABEL[e.tipo] || e.tipo} · ${e.tema || 'sem título'} · ${ROT_STATUS[e.status] || e.status}`)].join('\n');
}

function desenharRelatorio(el, r, aoExcluir) {
  const d = r.dados; const f = (x) => String(x).slice(0, 10).split('-').reverse().join('/');
  const kpi = (n, l, cls = '') => `<div class="card meta-card ${cls}"><div class="big">${n}</div><div class="muted">${l}</div></div>`;
  const lista = (o, rot) => Object.entries(o || {}).length ? `<ul class="rel-lista">${Object.entries(o).map(([k, n]) => `<li><span>${esc(rot(k))}</span><b>${n}</b></li>`).join('')}</ul>` : '<p class="muted">Nenhum.</p>';
  el.innerHTML = `<article class="relatorio">
    <div class="view-head no-print-gap"><div><h3>Relatório · ${esc(d.escopo)}</h3><p>${f(d.periodo.de)} a ${f(d.periodo.ate)} · gerado em ${esc(new Date(r.created_at).toLocaleString('pt-BR'))}</p></div>
      <div class="acoes-res no-print"><button class="btn small" id="rpCopiar">Copiar texto</button><button class="btn small" id="rpPrint">Imprimir / salvar PDF</button>${aoExcluir ? '<button class="btn small ghost danger" id="rpDel">Excluir</button>' : ''}</div></div>
    <div class="card"><h4 class="rel-h">Resumo</h4><p style="white-space:pre-wrap;margin:0">${esc(r.resumo || '')}</p></div>
    <div class="grid cols-3" style="margin-top:12px">
      ${kpi(d.planejado.total, 'entregas planejadas')}${kpi(d.planejado.publicadas, 'publicadas')}${kpi(d.planejado.atrasadas, 'atrasadas', d.planejado.atrasadas ? 'alerta-kpi' : '')}
      ${kpi(d.esteira.aprovadas_no_periodo, 'aprovadas no período')}${kpi(d.esteira.agora.aguardando_aprovacao || 0, 'aguardando aprovação agora')}${kpi(d.solicitacoes.recebidas, 'solicitações recebidas')}
    </div>
    <div class="grid cols-3" style="margin-top:12px">
      <div class="card"><h4 class="rel-h">Por tipo</h4>${lista(d.planejado.por_tipo, (k) => TIPO_LABEL[k] || k)}</div>
      <div class="card"><h4 class="rel-h">Por etapa</h4>${lista(d.planejado.por_status, (k) => ROT_STATUS[k] || k)}</div>
      <div class="card"><h4 class="rel-h">Time (criações)</h4>${lista(d.time, (k) => ROT_AGENTE[k] || k)}</div>
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      <div class="card"><h4 class="rel-h">Clientes</h4><ul class="rel-lista">${d.clientes.map((c) => `<li><span>${esc(c.nome)}</span><b>${c.posts_publicados} posts publicados · meta mensal ${c.meta_posts_mes}</b></li>`).join('')}</ul></div>
      <div class="card"><h4 class="rel-h">Publicações nas redes (todo o sistema)</h4>${d.redes.length ? `<ul class="rel-lista">${d.redes.map((x) => `<li><span>${esc(x.plataforma)} · ${x.status === 'publicado' ? 'publicado' : 'erro'}</span><b>${x.n}</b></li>`).join('')}</ul>` : '<p class="muted">Nenhuma publicação feita por aqui no período.</p>'}</div>
    </div>
    <div class="card" style="margin-top:12px"><h4 class="rel-h">Entregas do período ${d.entregas.length >= 40 ? '(primeiras 40)' : ''}</h4>
      ${d.entregas.length ? `<table class="rel-tab"><thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Pauta</th><th>Etapa</th></tr></thead><tbody>${d.entregas.map((e) => `<tr><td>${f(e.data)}</td><td>${esc(e.cliente)}</td><td>${esc(TIPO_LABEL[e.tipo] || e.tipo)}</td><td>${esc(e.tema || 'sem título')}</td><td>${esc(ROT_STATUS[e.status] || e.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma entrega com data neste período.</p>'}</div>
    <p class="muted rel-nota">Este relatório mostra a produção e o andamento dentro do sistema. Alcance, cliques e vendas das redes e dos anúncios não são medidos aqui.</p>
  </article>`;
  $('#rpCopiar', el).onclick = () => copiar(relatorioMarkdown(r));
  $('#rpPrint', el).onclick = () => window.print();
  const del = $('#rpDel', el);
  if (del) del.onclick = async () => { if (!confirm('Excluir este relatório?')) return; await api('/api/relatorios/' + r.id, { method: 'DELETE' }); aoExcluir(); };
}

async function viewRelatorios(v) {
  await carregarProjetos();
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  if (!p) { S.view = 'inicio'; return render(); }
  const c = clienteAtual();
  const hist = await api('/api/relatorios?' + (c ? 'client_id=' + c.id : 'project_id=' + p.id));
  const [de0, ate0] = periodoPreset('mes');
  v.innerHTML = `
    <div class="view-head no-print"><div><h2>Relatórios · ${esc(c ? c.nome : p.nome)}</h2><p>Escolha o período e gere o relatório automaticamente.</p></div></div>
    <div class="card no-print"><div class="dm-linha" style="grid-template-columns:minmax(180px,1fr) minmax(150px,.7fr) minmax(150px,.7fr) auto;align-items:end">
      <div><label for="rpPer">Período</label><select id="rpPer"><option value="mes">Este mês</option><option value="mes_passado">Mês passado</option><option value="semana">Esta semana</option><option value="semana_passada">Semana passada</option><option value="30">Últimos 30 dias</option><option value="custom">Personalizado</option></select></div>
      <div><label for="rpDe">De</label><input type="date" id="rpDe" value="${de0}"></div>
      <div><label for="rpAte">Até</label><input type="date" id="rpAte" value="${ate0}"></div>
      <button class="btn primary" id="rpGerar">Gerar relatório</button></div>
      <p class="erro" id="rpErro" style="margin:8px 0 0"></p></div>
    <div id="rpResultado" style="margin-top:14px"></div>
    <h3 class="secao-h no-print">Relatórios anteriores</h3>
    <div class="card no-print">${hist.length ? hist.map((r) => `<button class="linha-cr" data-rel="${r.id}"><span class="lc-t"><b>${esc(r.dados.escopo)} · ${String(r.de).slice(0, 10).split('-').reverse().join('/')} a ${String(r.ate).slice(0, 10).split('-').reverse().join('/')}</b><small>gerado em ${esc(new Date(r.created_at).toLocaleString('pt-BR'))}${r.usuario ? ' por ' + esc(r.usuario) : ''}</small></span></button>`).join('') : '<div class="empty" style="padding:16px">Nenhum relatório ainda.</div>'}</div>`;
  const per = $('#rpPer', v);
  per.onchange = () => { const x = periodoPreset(per.value); if (x) { $('#rpDe', v).value = x[0]; $('#rpAte', v).value = x[1]; } };
  const mostrar = (r) => { desenharRelatorio($('#rpResultado', v), r, () => render()); $('#rpResultado', v).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#rpGerar', v).onclick = async () => {
    const b = $('#rpGerar', v); $('#rpErro', v).textContent = '';
    b.disabled = true; b.textContent = 'Gerando…';
    try {
      const r = await api('/api/relatorios', { method: 'POST', body: { project_id: p.id, client_id: c ? c.id : null, de: $('#rpDe', v).value, ate: $('#rpAte', v).value } });
      mostrar(r);
    } catch (e) { $('#rpErro', v).textContent = e.message; }
    b.disabled = false; b.textContent = 'Gerar relatório';
  };
  $$('[data-rel]', v).forEach((b) => b.addEventListener('click', () => mostrar(hist.find((x) => String(x.id) === b.dataset.rel))));
}

// ---------------- Solicitações (janela de cada projeto) ----------------
const SOL_TIPOS = { conteudo: 'Conteúdo', arte: 'Arte', video: 'Vídeo', campanha: 'Campanha de anúncios', mensagem: 'Mensagens', outro: 'Outro' };
const SOL_AGENTE = { conteudo: 'hugo', arte: 'luiz', video: 'davi', campanha: 'camila', mensagem: 'felipe' };
const SOL_STATUS = { nova: 'Nova', andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const fmtPrazo = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

async function viewSolicitacoes(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  const lista = await api('/api/solicitacoes' + (S.projeto ? '?project_id=' + S.projeto : ''));
  const nomeProj = (id) => (projetoPorId(id) || {}).nome || '';
  const coluna = (chave, titulo) => {
    const itens = lista.filter((x) => (chave === 'concluida' ? ['concluida', 'cancelada'].includes(x.status) : x.status === chave));
    return `<section class="sol-col"><h4>${titulo} <span class="pill">${itens.length}</span></h4>
      ${itens.length ? itens.map((x) => {
        const a = SOL_AGENTE[x.tipo] && agente(SOL_AGENTE[x.tipo]);
        return `<article class="card sol ${x.prioridade === 'alta' ? 'alta' : ''}">
          <div class="msg-top"><span class="pill">${esc(SOL_TIPOS[x.tipo])}</span>${x.prioridade === 'alta' ? '<span class="pill" style="background:var(--danger-soft);color:var(--danger)">Alta</span>' : ''}
            ${x.origem === 'formulario' ? '<span class="pill">Formulário</span>' : ''}${x.origem === 'caixa' ? '<span class="pill">Caixa</span>' : ''}${p ? '' : `<small>${esc(nomeProj(x.project_id))}</small>`}</div>
          <b>${esc(x.titulo)}</b>
          ${x.descricao ? `<p class="sol-desc">${esc(x.descricao)}</p>` : ''}
          <small class="muted">${esc([x.solicitante, x.contato, x.prazo ? 'prazo ' + fmtPrazo(x.prazo) : ''].filter(Boolean).join(' · '))}</small>
          <div class="acoes-res">
            ${a ? `<button class="btn small primary" data-fazer="${x.id}">${a.icone} ${x.tipo === 'mensagem' ? 'Abrir Mensagens' : 'Criar com ' + esc(a.nome)}</button>` : ''}
            <select data-st="${x.id}" aria-label="Status">${Object.entries(SOL_STATUS).map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn small ghost" data-ed="${x.id}">Editar</button>
            <button class="btn small ghost danger" data-rm="${x.id}">Excluir</button>
          </div></article>`;
      }).join('') : '<div class="empty" style="padding:16px">Nada aqui.</div>'}</section>`;
  };
  v.innerHTML = `
    <div class="view-head"><div><h2>Solicitações${p ? ' · ' + esc(p.nome) : ''}</h2>
      <p>Pedidos de conteúdo, arte, vídeo e campanhas. Receba pelo formulário do projeto ou registre aqui.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${p ? '<button class="btn" id="solLink">🔗 Link para clientes</button>' : ''}
        <button class="btn primary" id="solNova">+ Nova solicitação</button></div></div>
    ${p ? '' : '<div class="alerta">Mostrando todos os projetos. Abra um projeto para pegar o link do formulário dele.</div>'}
    <div class="sol-grid">${coluna('nova', 'Novas')}${coluna('andamento', 'Em andamento')}${coluna('concluida', 'Concluídas')}</div>`;

  const recarregar = () => render();
  const porId = (id) => lista.find((x) => String(x.id) === String(id));
  $('#solNova', v).onclick = () => abrirSolicitacao(null, recarregar);
  const lk = $('#solLink', v);
  if (lk) lk.onclick = () => abrirLinkSolicitacao(p);
  $$('[data-ed]', v).forEach((b) => b.addEventListener('click', () => abrirSolicitacao(porId(b.dataset.ed), recarregar)));
  $$('[data-rm]', v).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Excluir esta solicitação?')) return; await api('/api/solicitacoes/' + b.dataset.rm, { method: 'DELETE' }); recarregar(); }));
  $$('[data-st]', v).forEach((sel) => sel.addEventListener('change', async () => { try { await api('/api/solicitacoes/' + sel.dataset.st, { method: 'PUT', body: { status: sel.value } }); recarregar(); } catch (e) { toast(e.message); } }));
  $$('[data-fazer]', v).forEach((b) => b.addEventListener('click', () => {
    const x = porId(b.dataset.fazer);
    const ag = SOL_AGENTE[x.tipo];
    if (ag === 'felipe') { S.view = 'mensagens'; render(); return; }
    abrirCriar(ag, {
      projeto: x.project_id, cliente: x.client_id,
      pedido: `${x.titulo}\n\n${x.descricao || ''}${x.prazo ? `\nPrazo: ${fmtPrazo(x.prazo)}` : ''}${x.solicitante ? `\nSolicitante: ${x.solicitante}` : ''}`.trim(),
      aoGerar: async () => { if (x.status === 'nova') { try { await api('/api/solicitacoes/' + x.id, { method: 'PUT', body: { status: 'andamento' } }); } catch { /* segue */ } } },
    });
  }));
}

function abrirSolicitacao(x, depois) {
  const d = $('#modal');
  const projetoSel = x?.project_id || S.projeto || (S.projetos[0] || {}).id;
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${x ? 'Editar solicitação' : 'Nova solicitação'}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <div class="row"><div><label>Projeto</label><select id="soProj" ${x ? 'disabled' : ''}>${opcoesProjetos(projetoSel)}</select></div>
        <div><label>Tipo</label><select id="soTipo">${Object.entries(SOL_TIPOS).map(([k, l]) => `<option value="${k}" ${x?.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div><label>Título</label><input id="soTit" value="${esc(x?.titulo || '')}" maxlength="200"></div>
      <div><label>Detalhes</label><textarea id="soDesc" rows="5">${esc(x?.descricao || '')}</textarea></div>
      <div class="row"><div><label>Solicitante</label><input id="soSol" value="${esc(x?.solicitante || '')}"></div>
        <div><label>Contato</label><input id="soCont" value="${esc(x?.contato || '')}"></div></div>
      <div class="row"><div><label>Prazo</label><input type="date" id="soPrazo" value="${esc(x?.prazo ? String(x.prazo).slice(0, 10) : '')}"></div>
        <div><label>Prioridade</label><select id="soPri">${[['baixa', 'Baixa'], ['normal', 'Normal'], ['alta', 'Alta']].map(([k, l]) => `<option value="${k}" ${(x?.prioridade || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <p class="erro" id="soErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="soSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#soSalvar').onclick = async () => {
    const body = { project_id: Number($('#soProj').value), tipo: $('#soTipo').value, titulo: $('#soTit').value, descricao: $('#soDesc').value,
      solicitante: $('#soSol').value, contato: $('#soCont').value, prazo: $('#soPrazo').value, prioridade: $('#soPri').value };
    try { await api(x ? '/api/solicitacoes/' + x.id : '/api/solicitacoes', { method: x ? 'PUT' : 'POST', body }); d.close(); toast('Solicitação salva'); depois && depois(); }
    catch (e) { $('#soErro').textContent = e.message; }
  };
}

async function abrirLinkSolicitacao(p) {
  const { link } = await api(`/api/projects/${p.id}/link-solicitacao`, { method: 'POST', body: {} });
  const d = $('#modal');
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>Link de solicitações · ${esc(p.nome)}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body"><p style="margin:0">Quem receber este link preenche um formulário simples (sem login) e a solicitação aparece aqui como <b>Nova</b>.</p>
    <p><code class="url" id="lkUrl">${esc(link)}</code></p>
    <div class="acoes-res"><button type="button" class="btn small primary" id="lkCp">Copiar link</button><a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Abrir formulário ↗</a>
      <button type="button" class="btn small danger" id="lkNovo">Gerar outro link</button></div>
    <p class="muted" style="margin:0">Se o link vazar, gere outro: o antigo deixa de funcionar.</p></div></form>`;
  d.showModal();
  $('#lkCp').onclick = () => copiar(link);
  $('#lkNovo').onclick = async () => {
    if (!confirm('O link antigo deixará de funcionar. Continuar?')) return;
    const r = await api(`/api/projects/${p.id}/link-solicitacao`, { method: 'POST', body: { regenerar: true } });
    $('#lkUrl').textContent = r.link; $('#lkCp').onclick = () => copiar(r.link); toast('Novo link gerado');
  };
}

// ---------------- Importar pautas (geradas no Claude) ----------------
const EXEMPLO_PAUTAS = `{
  "projeto": "Disco",
  "cliente": "Operizy",
  "itens": [
    { "data": "2026-11-10", "tipo": "post", "formato": "carrossel", "editorial": "Educativo",
      "tema": "3 erros de mídia paga", "legenda": "Texto da legenda...", "briefing": "CARD 1 · CAPA: ..." }
  ]
}`;

function abrirImportar() {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>Importar pautas</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">Peça as pautas ao Claude no formato abaixo e cole aqui. Elas ocupam as tarefas vazias do mesmo dia ou viram tarefas novas; nada é publicado.</p>
      <div class="row"><div><label>Projeto (se não vier no texto)</label><select id="ipProj"><option value="">—</option>${opcoesProjetos(S.projeto)}</select></div>
        <div><label>Cliente (se não vier no texto)</label><select id="ipCli"><option value="">—</option></select></div></div>
      <div><label>Pautas em JSON</label><textarea id="ipJson" rows="12" class="resultado" placeholder='${esc(EXEMPLO_PAUTAS)}'></textarea></div>
      <details><summary>Ver formato</summary><pre class="analise">${esc(EXEMPLO_PAUTAS)}</pre>
        <small class="muted">Campos de cada item: data (AAAA-MM-DD), tipo (post, story, blog, captacao), formato, editorial, tema, legenda, briefing, palavra_chave, links, status.</small></details>
      <p class="erro" id="ipErro" style="margin:0"></p><div id="ipRes"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="ipOk">Importar</button></div></div>
  </form>`;
  d.showModal();
  const clientes = async () => {
    const pid = $('#ipProj').value;
    const lista = pid ? await api('/api/clients?project_id=' + pid) : [];
    $('#ipCli').innerHTML = '<option value="">—</option>' + lista.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    if (S.cliente && lista.some((c) => String(c.id) === String(S.cliente))) $('#ipCli').value = S.cliente;
  };
  $('#ipProj').addEventListener('change', clientes); clientes();
  $('#ipOk').onclick = async () => {
    $('#ipErro').textContent = ''; $('#ipRes').innerHTML = '';
    let dados;
    try { dados = JSON.parse($('#ipJson').value); } catch { return ($('#ipErro').textContent = 'Não consegui ler o JSON. Confira se copiou tudo.'); }
    if (Array.isArray(dados)) dados = { itens: dados };
    if (!dados.project_id && !dados.projeto && $('#ipProj').value) dados.project_id = Number($('#ipProj').value);
    if (!dados.client_id && !dados.cliente && $('#ipCli').value) dados.client_id = Number($('#ipCli').value);
    const b = $('#ipOk'); b.disabled = true; b.textContent = 'Importando…';
    try {
      const r = await api('/api/importar/pautas', { method: 'POST', body: dados });
      $('#ipRes').innerHTML = `<div class="alerta ok"><b>${r.criadas}</b> novas · <b>${r.preenchidas}</b> preencheram tarefas vazias${r.erros.length ? ` · <b>${r.erros.length}</b> com problema` : ''}</div>` +
        r.erros.map((e) => `<div class="alerta danger">${esc(e)}</div>`).join('');
    } catch (e) { $('#ipErro').textContent = e.message; }
    b.disabled = false; b.textContent = 'Importar';
  };
}

// ---------------- Mensagens (Felipe) · por projeto e cliente ----------------
async function viewMensagens(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  if (!p) { S.view = 'inicio'; return render(); }
  const c = clienteAtual();
  const msgs = await api('/api/mensagens?' + (c ? 'client_id=' + c.id : 'project_id=' + p.id));
  const f = agente('felipe');
  const nomeCli = (id) => (S.clients.find((x) => x.id === id) || {}).nome || '';
  const card = (m) => `
    <div class="card msg ${m.status}" data-m="${m.id}">
      <div class="msg-top"><span class="pill">${esc({ instagram: 'Instagram', facebook: 'Facebook', manual: 'Colada' }[m.canal] || m.canal)}</span>
        <b>${esc(m.remetente_nome || (m.remetente_id ? 'Contato ' + m.remetente_id.slice(-4) : 'Contato'))}</b>
        ${c ? '' : `<span class="pill">${esc(nomeCli(m.client_id))}</span>`}
        <small>${esc(new Date(m.created_at).toLocaleString('pt-BR'))}</small>
        <span class="pill ${m.status === 'respondida' ? 'ok' : ''}">${{ nova: 'Nova', respondida: 'Respondida', ignorada: 'Ignorada' }[m.status]}</span></div>
      <p class="msg-txt">${esc(m.texto)}</p>
      ${m.status === 'ignorada' ? '' : `
      <label>Resposta</label>
      <textarea rows="4" data-resp="${m.id}" ${m.status === 'respondida' ? 'readonly' : ''}>${esc(m.resposta || '')}</textarea>
      <div class="acoes-res">
        ${m.status === 'respondida' ? '' : `
        <button class="btn small" data-sug="${m.id}">${f.icone} ${m.resposta ? 'Sugerir outra' : 'Sugerir resposta'}</button>
        <button class="btn small primary" data-env="${m.id}">${m.canal === 'manual' ? 'Marcar como respondida' : 'Enviar pela Meta'}</button>`}
        <button class="btn small" data-cp="${m.id}">Copiar</button>
        ${m.status === 'nova' ? `<button class="btn small ghost" data-ign="${m.id}">Ignorar</button>` : ''}
        <button class="btn small ghost danger" data-del="${m.id}">Excluir</button>
      </div>`}
    </div>`;
  v.innerHTML = `
    <div class="view-head"><div><h2>Mensagens · ${esc(c ? c.nome : p.nome)}</h2>
      <p>${esc(f.descricao)}</p></div>
      <button class="btn" id="msgNova">+ Colar mensagem</button></div>
    <div class="alerta" id="msgAviso" hidden></div>
    <div id="msgLista" class="msg-lista">${msgs.length ? msgs.map(card).join('') : '<div class="empty">Nenhuma mensagem ainda.</div>'}</div>`;
  // Aviso de conexão do cliente (só quando há um cliente escolhido)
  if (c) {
    api('/api/conexoes?client_id=' + c.id).then((i) => {
      if (i.meta.conectado) return;
      const av = $('#msgAviso', v); av.hidden = false;
      av.innerHTML = `As mensagens do Instagram e do Facebook de <b>${esc(c.nome)}</b> ainda não chegam sozinhas. Conecte em <a href="#" data-go-acessos>Acessos e APIs</a>. Enquanto isso, cole a mensagem aqui e o Felipe sugere a resposta.`;
      $$('[data-go-acessos]', av).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); S.view = 'acessos'; render(); }));
    }).catch(() => {});
  } else {
    const av = $('#msgAviso', v); av.hidden = false; av.textContent = 'Escolha um cliente na barra acima para ver só as mensagens dele e conectar as contas dele.';
  }
  $('#msgNova').addEventListener('click', () => {
    const d = $('#modal');
    d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>Colar mensagem recebida</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
      <div class="modal-body"><div><label>Cliente</label><select id="mnCli">${S.clients.map((x) => `<option value="${x.id}" ${c && c.id === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
      <div><label>Nome do contato (opcional)</label><input id="mnNome"></div>
      <div><label>Mensagem</label><textarea id="mnTxt" rows="5"></textarea></div><p class="erro" id="mnErro" style="margin:0"></p></div>
      <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="mnOk">Adicionar</button></div></div></form>`;
    d.showModal();
    $('#mnOk').onclick = async () => {
      try { await api('/api/mensagens', { method: 'POST', body: { remetente_nome: $('#mnNome').value, texto: $('#mnTxt').value, client_id: Number($('#mnCli').value) } }); d.close(); render(); }
      catch (e) { $('#mnErro').textContent = e.message; }
    };
  });
  const respDe = (id) => $(`[data-resp="${id}"]`, v).value;
  const lida = async (fn) => { try { await fn(); } catch (e) { toast(e.message); } };
  $$('[data-sug]', v).forEach((b) => b.addEventListener('click', () => lida(async () => {
    b.disabled = true; b.textContent = 'Felipe está escrevendo…';
    try {
      const m = await api(`/api/mensagens/${b.dataset.sug}/sugerir`, { method: 'POST', body: {} });
      $(`[data-resp="${m.id}"]`, v).value = m.resposta;
      b.textContent = 'Sugerir outra';
    } finally { b.disabled = false; if (/escrevendo/.test(b.textContent)) b.textContent = 'Sugerir resposta'; }
  })));
  $$('[data-env]', v).forEach((b) => b.addEventListener('click', () => lida(async () => {
    const id = b.dataset.env; const resposta = respDe(id);
    if (!resposta.trim()) return toast('Escreva ou gere a resposta primeiro');
    if (!confirm('Confirmar o envio desta resposta?')) return;
    const r = await api(`/api/mensagens/${id}/enviar`, { method: 'POST', body: { resposta } });
    toast(r.enviado ? 'Resposta enviada' : 'Marcada como respondida. Copie e envie no app.');
    render();
  })));
  $$('[data-cp]', v).forEach((b) => b.addEventListener('click', () => copiar(respDe(b.dataset.cp))));
  $$('[data-ign]', v).forEach((b) => b.addEventListener('click', () => lida(async () => { await api('/api/mensagens/' + b.dataset.ign, { method: 'PUT', body: { status: 'ignorada' } }); render(); })));
  $$('[data-del]', v).forEach((b) => b.addEventListener('click', () => lida(async () => { if (!confirm('Excluir esta mensagem?')) return; await api('/api/mensagens/' + b.dataset.del, { method: 'DELETE' }); render(); })));
}

// ---------------- Empregos (Bianca) ----------------
S.empAba = 'vagas';
const STATUS_VAGA = { nova: 'Nova', salva: 'Salva', candidatado: 'Candidatado', descartada: 'Descartada' };

async function viewEmpregos(v) {
  await carregarAgentes();
  await carregarProjetos();
  const b = agente('bianca');
  const pc = S.projetos.find((x) => x.tipo === 'empregos');
  const nomeP = pc ? pc.nome : 'Carreira';
  v.innerHTML = `
    <nav class="crumbs" aria-label="Você está em" style="margin-bottom:10px"><a href="#" id="empVolta">Projetos</a><span>›</span><a href="#" aria-current="page">${esc(nomeP)}</a></nav>
    <div class="view-head"><div><h2>${esc(nomeP)} · candidaturas</h2><p>Perfil, currículo e portfólio num lugar só. ${esc(b.nome)} busca vagas, avalia a aderência e monta a proposta e as respostas de cadastro com os seus dados.</p></div>
      <div class="seg" role="tablist">${[['vagas', 'Vagas'], ['funil', 'Funil'], ['perfil', 'Meu perfil'], ['docs', 'Currículo e portfólio']].map(([k, l]) =>
        `<button role="tab" data-ea="${k}" class="${S.empAba === k ? 'on' : ''}" aria-selected="${S.empAba === k}">${l}</button>`).join('')}</div></div>
    <div id="empCorpo"></div>`;
  $$('[data-ea]', v).forEach((x) => x.addEventListener('click', () => { S.empAba = x.dataset.ea; viewEmpregos(v); }));
  $('#empVolta', v).onclick = (e) => { e.preventDefault(); S.view = 'inicio'; render(); };
  if (S.empAba === 'perfil') return empPerfil($('#empCorpo'));
  if (S.empAba === 'docs') return empDocs($('#empCorpo'));
  if (S.empAba === 'funil') return empFunil($('#empCorpo'));
  return empVagas($('#empCorpo'));
}

async function empVagas(el) {
  const vagas = await api('/api/vagas');
  el.innerHTML = `
    <div class="card busca-vagas">
      <label>Peça para a Bianca procurar</label>
      <div class="linha-busca"><input id="bvTermos" placeholder="Ex.: gestor de tráfego remoto, growth marketing, CRM e automação"><button class="btn primary" id="bvIr">Buscar vagas</button>
        <button class="btn" id="bvNova">+ Adicionar vaga</button></div>
      <small class="muted">A busca traz só vagas com link real. Para candidatar-se, abra a vaga, copie a proposta e as respostas prontas e envie você mesma: a Bianca não entra na sua conta da Workana ou do LinkedIn.</small>
      <p class="erro" id="bvErro"></p>
    </div>
    <div class="vagas-lista">${vagas.length ? vagas.map((x) => `
      <button class="card vaga ${x.status}" data-v="${x.id}">
        <div><b>${esc(x.titulo)}</b><small>${esc([x.empresa, x.plataforma, x.orcamento].filter(Boolean).join(' · '))}</small></div>
        <span class="pill ${x.status === 'candidatado' ? 'ok' : ''}">${STATUS_VAGA[x.status]}</span>
      </button>`).join('') : '<div class="empty">Nenhuma vaga ainda. Peça uma busca ou adicione uma vaga colando a descrição.</div>'}</div>`;
  $('#bvIr').onclick = async () => {
    const termos = $('#bvTermos').value.trim();
    if (!termos) return ($('#bvErro').textContent = 'Diga o que procurar');
    const btn = $('#bvIr'); btn.disabled = true; btn.textContent = 'Bianca está procurando…'; $('#bvErro').textContent = '';
    try {
      const r = await api('/api/vagas/buscar', { method: 'POST', body: { termos } });
      toast(r.novas.length ? `${r.novas.length} vagas novas` : 'Nada novo encontrado');
      empVagas(el);
    } catch (e) { $('#bvErro').textContent = e.message; btn.disabled = false; btn.textContent = 'Buscar vagas'; }
  };
  $('#bvNova').onclick = () => abrirVaga(null, () => empVagas(el));
  $$('[data-v]', el).forEach((b) => b.addEventListener('click', () => abrirVaga(vagas.find((x) => String(x.id) === b.dataset.v), () => empVagas(el))));
}

async function empFunil(el) {
  const vagas = await api('/api/vagas');
  const cols = [['nova', 'Novas'], ['salva', 'Salvas / com proposta'], ['candidatado', 'Candidatado'], ['descartada', 'Descartadas']];
  el.innerHTML = `<div class="funil">${cols.map(([k, l]) => {
    const itens = vagas.filter((x) => x.status === k);
    return `<section class="sol-col"><h4>${l} <span class="pill">${itens.length}</span></h4>
      ${itens.length ? itens.map((x) => `<button class="card vaga ${x.status}" data-v="${x.id}"><div><b>${esc(x.titulo)}</b><small>${esc([x.empresa, x.plataforma, x.orcamento].filter(Boolean).join(' · '))}</small>${x.proposta ? '<small>✓ proposta pronta</small>' : ''}</div></button>`).join('') : '<div class="empty" style="padding:14px">Vazio.</div>'}</section>`;
  }).join('')}</div>`;
  $$('[data-v]', el).forEach((b) => b.addEventListener('click', () => abrirVaga(vagas.find((x) => String(x.id) === b.dataset.v), () => empFunil(el))));
}

function abrirVaga(x, depois) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog">
    <div class="modal-head"><h3>${x ? 'Vaga' : 'Nova vaga'}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <div><label>Título</label><input id="vgTit" value="${esc(x?.titulo || '')}"></div>
      <div class="row"><div><label>Empresa / cliente</label><input id="vgEmp" value="${esc(x?.empresa || '')}"></div>
        <div><label>Plataforma</label><select id="vgPlat">${['Workana', 'LinkedIn', 'Outra'].map((p) => `<option ${x?.plataforma === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
      <div class="row"><div><label>Link</label><input id="vgUrl" value="${esc(x?.url || '')}" placeholder="https://"></div>
        <div><label>Orçamento / salário</label><input id="vgOrc" value="${esc(x?.orcamento || '')}"></div></div>
      <div><label>Descrição da vaga (cole aqui o texto completo)</label><textarea id="vgDesc" rows="7">${esc(x?.descricao || '')}</textarea></div>
      ${x ? `<div class="acoes-res"><button type="button" class="btn small primary" id="vgAnalisar">${x.analise ? 'Analisar de novo' : 'Analisar e montar proposta'}</button>
        ${x.url ? `<a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir vaga ↗</a>` : ''}
        <select id="vgStatus">${Object.entries(STATUS_VAGA).map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="vgRes">${resultadoVaga(x)}</div>` : ''}
      <p class="erro" id="vgErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div>${x ? '<button type="button" class="btn danger" id="vgDel">Excluir</button>' : ''}</div>
      <div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="vgSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  d.addEventListener('close', () => depois && depois(), { once: true });
  const corpo = () => ({ titulo: $('#vgTit').value, empresa: $('#vgEmp').value, plataforma: $('#vgPlat').value, url: $('#vgUrl').value, orcamento: $('#vgOrc').value,
    descricao: $('#vgDesc').value, ...(x ? { status: $('#vgStatus').value, proposta: $('#vgProp') ? $('#vgProp').value : x.proposta } : {}) });
  $('#vgSalvar').onclick = async () => {
    try { await api(x ? '/api/vagas/' + x.id : '/api/vagas', { method: x ? 'PUT' : 'POST', body: corpo() }); d.close(); toast('Vaga salva'); }
    catch (e) { $('#vgErro').textContent = e.message; }
  };
  if (!x) return;
  $('#vgDel').onclick = async () => { if (!confirm('Excluir esta vaga?')) return; await api('/api/vagas/' + x.id, { method: 'DELETE' }); d.close(); };
  $('#vgAnalisar').onclick = async () => {
    const btn = $('#vgAnalisar'); btn.disabled = true; btn.textContent = 'Bianca está analisando…'; $('#vgErro').textContent = '';
    try {
      await api('/api/vagas/' + x.id, { method: 'PUT', body: corpo() });
      x = await api(`/api/vagas/${x.id}/analisar`, { method: 'POST' });
      $('#vgRes').innerHTML = resultadoVaga(x); ligarResultadoVaga();
      btn.textContent = 'Analisar de novo';
    } catch (e) { $('#vgErro').textContent = e.message; btn.textContent = 'Analisar e montar proposta'; }
    btn.disabled = false;
  };
  function ligarResultadoVaga() {
    const a = $('#vgCpAn'), p = $('#vgCpProp');
    if (a) a.onclick = () => copiar(x.analise || '');
    if (p) p.onclick = () => copiar($('#vgProp').value);
  }
  ligarResultadoVaga();
}

function resultadoVaga(x) {
  if (!x.analise && !x.proposta) return '';
  return `<label>Análise e respostas prontas para o cadastro</label>
    <pre class="analise">${esc(x.analise || '')}</pre>
    <div class="acoes-res"><button type="button" class="btn small" id="vgCpAn">Copiar análise</button></div>
    <label>Proposta (pode editar; salve antes de fechar)</label>
    <textarea id="vgProp" rows="9" class="resultado">${esc(x.proposta || '')}</textarea>
    <div class="acoes-res"><button type="button" class="btn small" id="vgCpProp">Copiar proposta</button></div>`;
}

const GRUPOS_PERFIL = [
  ['Dados e contato', true, [
    ['nome', 'Nome completo'], ['headline', 'Título profissional (português)'], ['headline_en', 'Professional headline (English)'],
    ['email', 'E-mail'], ['telefone', 'Telefone / WhatsApp'], ['cidade', 'Cidade e modelo de trabalho'], ['linkedin', 'LinkedIn'], ['portfolio', 'Link do portfólio']]],
  ['Resumo profissional', false, [['resumo', 'Resumo (português)', 6], ['resumo_en', 'Summary (English)', 6]]],
  ['Resultados em números', false, [['resultados', 'Um resultado por linha: valor · métrica · contexto', 8]]],
  ['Experiência profissional', false, [['experiencias', 'Empresa, cargo e período, com os destaques abaixo', 22], ['outras_experiencias', 'Outras experiências', 6]]],
  ['Cases do portfólio', false, [['cases', 'Cases com contexto, o que fez e resultados', 14]]],
  ['Competências, ferramentas e formação', false, [
    ['competencias', 'Competências principais', 7], ['ferramentas', 'Ferramentas e stack', 5], ['soft_skills', 'Competências comportamentais', 5],
    ['formacao', 'Formação', 3], ['idiomas', 'Idiomas'], ['diferenciais', 'Diferenciais', 4]]],
  ['Para candidaturas', false, [['disponibilidade', 'Disponibilidade (regime, viagens, CNH etc.)'], ['pretensao', 'Pretensão (salário ou valor/hora)'], ['respostas_prontas', 'Respostas prontas para formulários (pergunta e resposta)', 10]]],
  ['Observações e itens a confirmar', true, [['observacoes', 'Dúvidas e divergências entre documentos. A Bianca NÃO usa o que estiver aqui como fato.', 7]]],
];

function reduzirFoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const lado = 480; const c = document.createElement('canvas'); c.width = lado; c.height = lado;
      const m = Math.min(img.width, img.height); const ctx = c.getContext('2d');
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Não consegui ler a imagem'));
    img.src = URL.createObjectURL(file);
  });
}

async function empPerfil(el) {
  const p = await api('/api/perfil');
  let foto = p.foto || '';
  const campo = ([k, l, r]) => r
    ? `<div style="margin-top:10px"><label>${esc(l)}</label><textarea rows="${r}" data-pf="${k}">${esc(p[k] || '')}</textarea></div>`
    : `<div><label>${esc(l)}</label><input data-pf="${k}" value="${esc(p[k] || '')}"></div>`;
  el.innerHTML = `<p class="muted" style="margin-top:0">É daqui que a Bianca tira os dados para propostas e cadastros, e o que estiver vazio ela marca como [PREENCHER] em vez de inventar. Fica só no seu banco, não no repositório do código.</p>
    <div class="card" style="margin-bottom:12px"><div class="foto-linha"><div id="pfFoto" class="foto-box">${foto ? `<img src="${foto}" alt="Foto de perfil">` : '<span>sem foto</span>'}</div>
      <div><label>Foto de perfil</label><div class="acoes-res" style="margin-top:0"><label class="btn small" style="margin:0;text-transform:none;letter-spacing:0">Escolher foto<input type="file" id="pfFile" accept="image/*" hidden></label><button class="btn small ghost danger" id="pfFotoDel" ${foto ? '' : 'hidden'}>Remover</button></div>
      <small class="muted">Recortada em quadrado e reduzida para 480 px. Aparece no card do projeto.</small></div></div></div>
    ${GRUPOS_PERFIL.map(([t, aberto, campos]) => `<details class="card perfil-grupo" ${aberto ? 'open' : ''}><summary><b>${esc(t)}</b></summary>
      <div class="perfil-grid" style="margin-top:12px">${campos.filter((c) => !c[2]).map(campo).join('')}</div>${campos.filter((c) => c[2]).map(campo).join('')}</details>`).join('')}
    <div style="margin:14px 0"><button class="btn primary" id="pfSalvar">Salvar perfil</button></div>`;
  const pintar = () => { $('#pfFoto', el).innerHTML = foto ? `<img src="${foto}" alt="Foto de perfil">` : '<span>sem foto</span>'; $('#pfFotoDel', el).hidden = !foto; };
  $('#pfFile', el).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { foto = await reduzirFoto(f); pintar(); } catch (err) { toast(err.message); } };
  $('#pfFotoDel', el).onclick = () => { foto = ''; pintar(); };
  $('#pfSalvar', el).onclick = async () => {
    const body = { foto }; $$('[data-pf]', el).forEach((i) => { body[i.dataset.pf] = i.value; });
    try { await api('/api/perfil', { method: 'PUT', body }); toast('Perfil salvo'); } catch (e) { toast(e.message); }
  };
}

// ---------------- Currículo e portfólio: arquivos, ficha rápida e texto pronto ----------------
const ROTULOS_DOC = ['Currículo (português)', 'Currículo (inglês)', 'Currículo (tráfego pago / MarTech)', 'Portfólio', 'Portfólio (MarTech)', 'Outro'];
const fmtKB = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

function curriculoTexto(p, en) {
  const bloco = (t, x) => (x && String(x).trim() ? `${t}\n${String(x).trim()}\n` : '');
  const contato = [p.email, p.telefone, p.cidade, p.linkedin, p.portfolio].filter(Boolean).join(' · ');
  return [String(p.nome || '').toUpperCase(), en ? (p.headline_en || p.headline) : p.headline, contato, '',
    bloco(en ? 'PROFESSIONAL SUMMARY' : 'RESUMO PROFISSIONAL', en ? (p.resumo_en || p.resumo) : p.resumo),
    bloco(en ? 'RESULTS IN NUMBERS' : 'RESULTADOS EM NÚMEROS', p.resultados),
    bloco(en ? 'PROFESSIONAL EXPERIENCE' : 'EXPERIÊNCIA PROFISSIONAL', p.experiencias),
    bloco(en ? 'OTHER EXPERIENCE' : 'OUTRAS EXPERIÊNCIAS', p.outras_experiencias),
    bloco(en ? 'CORE COMPETENCIES' : 'COMPETÊNCIAS PRINCIPAIS', p.competencias),
    bloco(en ? 'TOOLS' : 'FERRAMENTAS', p.ferramentas),
    bloco(en ? 'EDUCATION' : 'FORMAÇÃO', p.formacao), bloco(en ? 'LANGUAGES' : 'IDIOMAS', p.idiomas),
    bloco(en ? 'AVAILABILITY' : 'DISPONIBILIDADE', p.disponibilidade)].filter((x) => x !== '').join('\n').trim();
}

async function empDocs(el) {
  const [docs, p] = await Promise.all([api('/api/documentos'), api('/api/perfil')]);
  const ficha = [['Nome', p.nome], ['E-mail', p.email], ['Telefone', p.telefone], ['Cidade', p.cidade], ['LinkedIn', p.linkedin], ['Portfólio', p.portfolio],
    ['Título (PT)', p.headline], ['Headline (EN)', p.headline_en], ['Idiomas', p.idiomas], ['Disponibilidade', p.disponibilidade], ['Pretensão', p.pretensao]].filter(([, x]) => x && String(x).trim());
  el.innerHTML = `
    <div class="card"><h3 style="margin-bottom:6px">Arquivos para anexar</h3>
      <p class="muted" style="margin-top:0">Suba os currículos e portfólios em PDF (até 3,5 MB cada). A Bianca sugere qual anexar em cada vaga.</p>
      ${docs.length ? `<div>${docs.map((d) => `<div class="linha-cr" style="cursor:default"><span class="ag-ico sm">📄</span>
        <span class="lc-t"><b>${esc(d.rotulo || d.nome)}</b><small>${esc(d.nome)} · ${fmtKB(d.tamanho)}${d.idioma ? ' · ' + esc(d.idioma) : ''}</small></span>
        <a class="btn small" href="/api/documentos/${d.id}/arquivo" target="_blank" rel="noopener">Abrir</a><button class="btn small ghost danger" data-dd="${d.id}">Excluir</button></div>`).join('')}</div>`
        : '<div class="empty" style="padding:14px">Nenhum arquivo ainda.</div>'}
      <div class="dm-linha" style="grid-template-columns:minmax(200px,1.2fr) minmax(160px,.8fr) minmax(130px,.5fr) auto;align-items:end;margin-top:12px">
        <div><label for="ddArq">Arquivo</label><input type="file" id="ddArq" accept=".pdf,.docx,.png,.jpg,.jpeg"></div>
        <div><label for="ddRot">Tipo</label><select id="ddRot">${ROTULOS_DOC.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div><label for="ddIdi">Idioma</label><select id="ddIdi"><option value="">—</option><option>Português</option><option>Inglês</option></select></div>
        <button class="btn primary" id="ddEnviar">Enviar</button></div>
      <p class="erro" id="ddErro" style="margin:8px 0 0"></p></div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h3 style="margin-bottom:6px">Ficha rápida para cadastros</h3>
        ${ficha.length ? ficha.map(([k, x], i) => `<div class="linha-cr" style="cursor:default"><span class="lc-t"><small>${esc(k)}</small><b style="white-space:normal">${esc(String(x))}</b></span><button class="btn small" data-fc="${i}">Copiar</button></div>`).join('') : '<div class="empty" style="padding:14px">Preencha o perfil para ver a ficha.</div>'}</div>
      <div class="card"><h3 style="margin-bottom:6px">Currículo em texto</h3>
        <p class="muted" style="margin-top:0">Texto completo montado a partir do seu perfil, para colar em formulários que não aceitam anexo.</p>
        <div class="acoes-res"><button class="btn small primary" id="ctPt">Copiar em português</button><button class="btn small primary" id="ctEn">Copiar em inglês</button></div>
        <p class="muted" style="font-size:12px">Em inglês, usa o resumo e o título em inglês; as experiências seguem como estão no perfil.</p></div>
    </div>`;
  $$('[data-dd]', el).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Excluir este arquivo?')) return; await api('/api/documentos/' + b.dataset.dd, { method: 'DELETE' }); empDocs(el); }));
  $$('[data-fc]', el).forEach((b) => b.addEventListener('click', () => copiar(String(ficha[Number(b.dataset.fc)][1]))));
  $('#ctPt', el).onclick = () => copiar(curriculoTexto(p, false));
  $('#ctEn', el).onclick = () => copiar(curriculoTexto(p, true));
  $('#ddEnviar', el).onclick = async () => {
    const f = $('#ddArq', el).files[0]; const erro = $('#ddErro', el); erro.textContent = '';
    if (!f) return (erro.textContent = 'Escolha um arquivo');
    if (f.size > 3.5 * 1024 * 1024) return (erro.textContent = 'O arquivo pode ter no máximo 3,5 MB');
    const mime = f.type || ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' })[f.name.split('.').pop().toLowerCase()];
    const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
    const b = $('#ddEnviar', el); b.disabled = true; b.textContent = 'Enviando…';
    try { await api('/api/documentos', { method: 'POST', body: { nome: f.name, rotulo: $('#ddRot', el).value, idioma: $('#ddIdi', el).value, mime, base64 } }); toast('Arquivo enviado'); empDocs(el); }
    catch (e) { erro.textContent = e.message; b.disabled = false; b.textContent = 'Enviar'; }
  };
}

// ---------------- Chaves das APIs: formulário reutilizável (padrão do sistema ou de um cliente) ----------------
const GRUPOS_API = { ia: 'Agentes (Claude)', meta: 'Facebook e Instagram (Meta)', linkedin: 'LinkedIn' };
const ORIGEM_API = { cliente: 'Deste cliente', painel: 'No painel', padrao: 'Padrão do sistema', ambiente: 'No Render' };

function formChaves(chaves, clienteId) {
  return Object.entries(GRUPOS_API).map(([g, nome]) => {
    const lista = chaves.filter((k) => k.grupo === g);
    if (!lista.length) return '';
    return `<h4 class="chv-g">${nome}</h4>` + lista.map((k) => `
      <div class="chv"><label>${esc(k.rotulo)}</label>
        <div class="chv-l"><input type="${k.secreto ? 'password' : 'text'}" data-chv="${k.chave}" placeholder="${k.definido ? esc(k.previa) : 'Cole aqui'}" autocomplete="off">
          <button class="btn small primary" data-chv-ok="${k.chave}">Salvar</button>
          ${['cliente', 'painel'].includes(k.origem) ? `<button class="btn small ghost danger" data-chv-rm="${k.chave}">Remover</button>` : ''}
          <span class="pill ${k.definido ? 'ok' : ''}">${k.definido ? ORIGEM_API[k.origem] : 'Vazio'}</span></div></div>`).join('');
  }).join('');
}

function ligarChaves(el, clienteId, recarregar) {
  const q = clienteId ? '?client_id=' + clienteId : '';
  $$('[data-chv-ok]', el).forEach((b) => b.addEventListener('click', async () => {
    const campo = $(`[data-chv="${b.dataset.chvOk}"]`, el);
    const erro = $('.chv-erro', el);
    if (!campo.value.trim()) return (erro.textContent = 'Cole o valor antes de salvar');
    try { await api('/api/configuracoes/' + b.dataset.chvOk + q, { method: 'PUT', body: { valor: campo.value } }); toast('Chave salva'); recarregar(); }
    catch (e) { erro.textContent = e.message; }
  }));
  $$('[data-chv-rm]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta chave?')) return;
    try { await api('/api/configuracoes/' + b.dataset.chvRm + q, { method: 'DELETE' }); recarregar(); } catch (e) { toast(e.message); }
  }));
}

// ---------------- APIs padrão (administração): valem para todos os clientes sem chaves próprias ----------------
async function viewIntegracoes(v) {
  if (S.me.papel !== 'admin') { S.view = 'inicio'; return render(); }
  const [ia, chaves, imp] = await Promise.all([api('/api/agentes').then((l) => l[0].ativo), api('/api/configuracoes'), api('/api/importar/token')]);
  v.innerHTML = `
    <div class="view-head"><div><h2>APIs padrão</h2><p>Valem para todos os clientes que não tiverem chaves próprias. Cada cliente conecta as suas contas na aba <b>Acessos e APIs</b> do projeto.</p></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Chaves padrão ${ia ? '<span class="pill ok">Agentes ativos</span>' : '<span class="pill">Agentes desligados</span>'}</h3>
      <p class="muted">Ficam criptografadas e valem mais que as variáveis do Render. A chave do Claude é única do sistema; Meta e LinkedIn podem ser trocadas por cliente.</p>
      <div id="chavesPadrao">${formChaves(chaves, 0)}</div><p class="erro chv-erro"></p></div>
    <div class="grid cols-2">
      <div class="card"><h3>Webhook da Meta (mensagens)</h3>
        <p class="muted">Um único endereço serve para todos os clientes: a mensagem é encaminhada ao cliente dono da página.</p>
        <p><code class="url">${esc(location.origin)}/webhook/meta</code> <button class="btn small" id="cpWh">Copiar</button></p>
        <p class="muted">Endereços de retorno do login (cadastre nos apps da Meta e do LinkedIn): <code class="url">${esc(location.origin)}/oauth/meta/retorno</code> e <code class="url">${esc(location.origin)}/oauth/linkedin/retorno</code>.</p></div>
      <div class="card"><h3>Importação automática de pautas</h3>
        <p class="muted">Para enviar pautas de fora do sistema, gere um token e envie um POST para <code>/importar/pautas</code> com <code>Authorization: Bearer SEU_TOKEN</code>.</p>
        <div class="acoes-res"><button class="btn small" id="impTok">${imp.existe ? 'Gerar novo token' : 'Gerar token'}</button>${imp.existe ? '<span class="pill ok">Token ativo</span>' : ''}</div>
        <div id="impTokRes"></div></div>
    </div>`;
  ligarChaves($('#chavesPadrao', v).parentElement, 0, () => viewIntegracoes(v));
  $('#cpWh', v).onclick = () => copiar(location.origin + '/webhook/meta');
  $('#impTok', v).onclick = async () => {
    if (imp.existe && !confirm('O token anterior deixará de funcionar. Continuar?')) return;
    try { const r = await api('/api/importar/token', { method: 'POST', body: {} });
      $('#impTokRes', v).innerHTML = `<p style="margin-top:10px">Copie agora; ele não aparece de novo:</p><p><code class="url">${esc(r.token)}</code> <button class="btn small" id="impTokCp">Copiar</button></p>`;
      $('#impTokCp', v).onclick = () => copiar(r.token); } catch (e) { toast(e.message); }
  };
}

// ---------------- Acessos e APIs de um cliente: contas conectadas, chaves próprias e webhook ----------------
async function blocoIntegracoes(el, cl) {
  if (!el) return;
  const adm = S.me.papel === 'admin';
  const [c, pubs, chaves] = await Promise.all([
    api('/api/conexoes?client_id=' + cl.id), api('/api/publicacoes?client_id=' + cl.id), adm ? api('/api/configuracoes?client_id=' + cl.id) : []]);
  const st = (ok, sim, nao) => `<span class="pill ${ok ? 'ok' : ''}">${ok ? sim : nao}</span>`;
  const m = c.meta, li = c.linkedin, go = c.google;
  const conectar = (prov) => `/oauth/${prov}/iniciar?client_id=${cl.id}`;
  const exp = li.expira_em ? new Date(li.expira_em).toLocaleDateString('pt-BR') : '';

  const cartaoMeta = `<div class="card"><h3>Facebook e Instagram ${st(m.conectado, 'Conectado', m.app_configurado ? 'Não conectado' : 'Falta o app da Meta')}</h3>
    ${m.conectado ? `
      <p>Conta: <b>${esc(m.usuario || '')}</b></p>
      <label>Página usada para publicar e responder</label>
      <select id="mtPagina" ${adm ? '' : 'disabled'}>${m.paginas.map((p) => `<option value="${esc(p.id)}" ${p.id === m.pagina_id ? 'selected' : ''}>${esc(p.nome)}${p.ig_usuario ? ' · @' + esc(p.ig_usuario) : ' · sem Instagram vinculado'}</option>`).join('')}</select>
      <p class="muted">Facebook: <b>${esc(m.facebook || '-')}</b> · Instagram: <b>${m.instagram ? '@' + esc(m.instagram) : 'não vinculado'}</b></p>
      ${adm ? `<div class="acoes-res"><a class="btn small" href="${conectar('meta')}">Reconectar</a><button class="btn small danger" id="mtDesc">Desconectar</button></div>` : ''}
    ` : m.app_configurado ? `<p class="muted">Entre com o Facebook de <b>${esc(cl.nome)}</b> e libere a página e o Instagram profissional vinculado a ela.</p>
      ${adm ? `<a class="btn primary" href="${conectar('meta')}">Conectar Facebook e Instagram</a>` : '<p class="muted">Peça a um administrador para conectar.</p>'}` : `
      <p class="muted">Falta o app da Meta. Cole o ID e a chave secreta nas chaves deste cliente (abaixo), ou nas <b>APIs padrão</b> se o app for compartilhado. No app da Meta, cadastre o retorno do login: <code class="url">${esc(m.redirect)}</code></p>`}
  </div>`;

  const cartaoLi = `<div class="card"><h3>LinkedIn ${st(li.conectado && !li.expirado, 'Conectado', li.expirado ? 'Expirou' : li.app_configurado ? 'Não conectado' : 'Falta o app do LinkedIn')}</h3>
    ${li.conectado ? `<p>Perfil: <b>${esc(li.nome || '')}</b></p><p class="muted">A conexão vale até ${esc(exp)}; depois é só reconectar.</p>
      ${adm ? `<div class="acoes-res"><a class="btn small" href="${conectar('linkedin')}">Reconectar</a><button class="btn small danger" id="liDesc">Desconectar</button></div>` : ''}`
      : li.app_configurado ? `<p class="muted">Conecte o perfil de <b>${esc(cl.nome)}</b> para publicar posts daqui.</p>${adm ? `<a class="btn primary" href="${conectar('linkedin')}">Conectar LinkedIn</a>` : ''}` : `
      <p class="muted">Falta o app do LinkedIn. Cole o Client ID e o Secret nas chaves deste cliente (abaixo) ou nas <b>APIs padrão</b>. Retorno do login: <code class="url">${esc(li.redirect)}</code></p>`}
  </div>`;

  const cartaoGo = `<div class="card"><h3>Google Drive e Docs ${st(go.conectado, 'Conectado', go.app_configurado ? 'Não conectado' : 'Falta o cliente OAuth do Google')}</h3>
    ${go.conectado ? `<p>Conta: <b>${esc(go.email || '')}</b></p><p class="muted">Puxa fotos e vídeos do Drive para as pautas e cria o documento de pauta. O sistema só lê o Drive e cria documentos; nunca apaga nada.</p>
      ${adm ? `<div class="acoes-res"><a class="btn small" href="${conectar('google')}">Reconectar</a><button class="btn small danger" id="goDesc">Desconectar</button></div>` : ''}`
      : go.app_configurado ? `<p class="muted">Conecte o Google de <b>${esc(cl.nome)}</b> para escolher fotos e vídeos do Drive e gerar o doc de pauta.</p>${adm ? `<a class="btn primary" href="${conectar('google')}">Conectar Google</a>` : ''}` : `
      <p class="muted">Falta o cliente OAuth do Google. No Google Cloud: ative a <b>Google Drive API</b>, crie um <b>ID do cliente OAuth (Aplicativo da Web)</b> e cadastre este retorno: <code class="url">${esc(go.redirect)}</code>. Depois cole o ID e a chave secreta nas chaves deste cliente (abaixo) ou nas <b>APIs padrão</b>.</p>`}
  </div>`;

  const cartaoHook = `<div class="card"><h3>Receber mensagens ${st(m.conectado, 'Pronto', 'Conecte primeiro')}</h3>
    <p class="muted">No app da Meta, em Webhooks (Page e Instagram), use a URL e o token abaixo e assine <b>messages</b>. As mensagens aparecem na aba <b>Mensagens</b> deste cliente.</p>
    <label>URL de callback</label><p><code class="url">${esc(m.webhook)}</code> <button class="btn small" id="cpWh">Copiar</button></p>
    ${m.verify_token ? `<label>Token de verificação</label><p><code class="url">${esc(m.verify_token)}</code> <button class="btn small" id="cpTk">Copiar</button></p>` : ''}</div>`;

  const cartaoChaves = adm ? `<div class="card"><h3>Chaves de API deste cliente</h3>
    <p class="muted">Opcional. Se ficar vazio, <b>${esc(cl.nome)}</b> usa as chaves padrão do sistema. Preencha quando o cliente tiver o próprio app da Meta ou do LinkedIn.</p>
    <div id="chavesCli">${formChaves(chaves, cl.id)}</div><p class="erro chv-erro"></p></div>` : '';

  el.innerHTML = `<div class="secao-titulo"><h3>Contas e APIs · ${esc(cl.nome)}</h3></div>
    <div class="grid cols-2" style="margin-bottom:18px">${cartaoMeta}${cartaoLi}${cartaoGo}${cartaoHook}${cartaoChaves}</div>
    <div class="card" style="margin-bottom:18px"><h3 style="margin-bottom:8px">Últimas publicações de ${esc(cl.nome)}</h3>
      ${pubs.length ? pubs.slice(0, 8).map((x) => `<div class="linha-cr" style="cursor:default"><span class="pill ${x.status === 'publicado' ? 'ok' : ''}">${esc({ facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' }[x.plataforma])}</span>
        <span class="lc-t"><b>${esc((x.texto || '').split('\n')[0].slice(0, 90))}</b><small>${esc(new Date(x.created_at).toLocaleString('pt-BR'))}${x.erro ? ' · ' + esc(x.erro) : ''}</small></span>
        <span class="pill ${x.status === 'publicado' ? 'ok' : ''}">${x.status === 'publicado' ? 'Publicado' : 'Erro'}</span></div>`).join('') : '<div class="empty" style="padding:12px">Nada publicado por aqui ainda.</div>'}</div>`;

  const recarregar = () => blocoIntegracoes(el, cl);
  if (adm) ligarChaves($('#chavesCli', el).parentElement, cl.id, recarregar);
  const cp = (id, t) => { const b = $(id, el); if (b) b.onclick = () => copiar(t); };
  cp('#cpWh', m.webhook); cp('#cpTk', m.verify_token);
  const sel = $('#mtPagina', el);
  if (sel) sel.onchange = async () => { try { await api('/api/conexoes/meta/pagina', { method: 'PUT', body: { client_id: cl.id, pagina_id: sel.value } }); toast('Página atualizada'); recarregar(); } catch (e) { toast(e.message); } };
  const desc = (id, prov, nome) => { const b = $(id, el); if (b) b.onclick = async () => { if (!confirm(`Desconectar ${nome} de ${cl.nome}?`)) return; await api(`/api/conexoes/${prov}?client_id=${cl.id}`, { method: 'DELETE' }); recarregar(); }; };
  desc('#mtDesc', 'meta', 'o Facebook e o Instagram'); desc('#liDesc', 'linkedin', 'o LinkedIn'); desc('#goDesc', 'google', 'o Google');
}
window.blocoIntegracoes = blocoIntegracoes;

// ---------------- Publicar (com confirmação) ----------------
async function abrirPublicar(texto, opts = {}) {
  const clienteId = opts.clientId || (S.cliente ? Number(S.cliente) : 0);
  if (!clienteId) return toast('Escolha o cliente antes de publicar');
  const c = await api('/api/conexoes?client_id=' + clienteId);
  const opcoes = [
    ['facebook', 'Facebook' + (c.meta.facebook ? ' · ' + c.meta.facebook : ''), c.meta.conectado, 'Conecte em Integrações'],
    ['instagram', 'Instagram' + (c.meta.instagram ? ' · @' + c.meta.instagram : ''), c.meta.conectado && !!c.meta.instagram, c.meta.conectado ? 'Sem Instagram vinculado à página' : 'Conecte em Integrações'],
    ['linkedin', 'LinkedIn' + (c.linkedin.nome ? ' · ' + c.linkedin.nome : ''), c.linkedin.conectado && !c.linkedin.expirado, 'Conecte em Integrações'],
  ];
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>${opts.aprovar ? 'Aprovar e passar para a Social media (Mariana)' : 'Publicar'}</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      ${opts.aprovar ? `<div><label>Como a Mariana segue</label><label class="chk"><input type="radio" name="pbModo" value="agendar" checked> Agendar (publica sozinha no horário)</label><label class="chk"><input type="radio" name="pbModo" value="agora"> Publicar agora (você confirma em seguida)</label></div>
      <div id="pbQuando"><label>Data e hora</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input type="datetime-local" id="pbData"><button type="button" class="btn small" id="pbSug">💡 Sugestão da Mariana</button></div><p class="muted" id="pbSugTxt" style="margin:4px 0 0"></p></div>` : ''}
      <div><label>Onde publicar</label>${opcoes.map(([k, l, ok, aviso]) => `<label class="chk ${ok ? '' : 'off'}"><input type="checkbox" data-pl="${k}" ${ok ? '' : 'disabled'}> ${esc(l)}${ok ? '' : ` <small>(${esc(aviso)})</small>`}</label>`).join('')}</div>
      <div><label>Texto</label><textarea id="pbTexto" rows="9">${esc(texto)}</textarea></div>
      <div><label>Link da imagem (https://, obrigatório no Instagram)</label><div style="display:flex;gap:8px"><input id="pbImg" placeholder="https://" value="${esc(opts.imagem || '')}"><button type="button" class="btn small" id="pbDrive" title="Escolher uma foto do Google Drive">📁 Drive</button><button type="button" class="btn small" id="pbGuardar" title="Baixa a imagem do link de exportação (Canva, PNG/JPG), converte para JPEG e guarda aqui com um link estável">📥 Guardar</button></div><small class="muted">Cole o link de exportação da arte (PNG/JPG) e clique em Guardar: o link do Canva expira, o do sistema não.</small></div>
      <p class="muted" style="margin:0">${opts.taskId ? 'Confira se o texto é só a legenda que vai ao ar. ' : ''}LinkedIn: sai só o texto. ${opts.aprovar ? 'Agendada, a Mariana publica sozinha no horário escolhido; "Publicar agora" é imediato e público.' : 'A publicação é imediata e pública.'}</p>
      <p class="erro" id="pbErro" style="margin:0"></p><div id="pbRes"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button>${opts.aprovar ? '<button type="button" class="btn" id="pbSo">Só aprovar</button>' : ''}<button type="button" class="btn primary" id="pbOk">${opts.aprovar ? 'Aprovar e agendar' : 'Publicar agora'}</button></div></div></form>`;
  document.body.appendChild(d); d.showModal();
  d.addEventListener('close', () => d.remove());
  $('#pbDrive', d).onclick = () => abrirDrive({ clienteId, unico: true, rotuloOk: 'Usar como imagem', aoEscolher: async (arqs) => {
    const f = arqs[0]; if (!f) return false;
    if (f.video) { $('#pbErro', d).textContent = 'Vídeo não serve como imagem do post. Escolha uma foto.'; return false; }
    try { const r = await api('/api/drive/importar', { method: 'POST', body: { file_id: f.id, task_id: opts.taskId || null } }); $('#pbImg', d).value = r.url; toast('Foto do Drive guardada'); return true; }
    catch (e) { $('#pbErro', d).textContent = e.message; return false; }
  } });
  $('#pbGuardar', d).onclick = async () => {
    const b = $('#pbGuardar', d); const u = $('#pbImg', d).value.trim(); if (!u) return ($('#pbErro', d).textContent = 'Cole o link da imagem');
    b.disabled = true; b.textContent = 'Guardando…'; $('#pbErro', d).textContent = '';
    try { const r = await api('/api/midia', { method: 'POST', body: { url: u, task_id: opts.taskId || null } }); $('#pbImg', d).value = r.url; toast('Imagem guardada'); }
    catch (e) { $('#pbErro', d).textContent = e.message; }
    b.disabled = false; b.textContent = '📥 Guardar';
  };
  const modo = () => (opts.aprovar ? ($$('[name=pbModo]', d).find((x) => x.checked) || {}).value : 'agora');
  if (opts.aprovar) {
    const ajustaModo = () => { $('#pbQuando', d).style.display = modo() === 'agendar' ? '' : 'none'; $('#pbOk', d).textContent = modo() === 'agendar' ? 'Aprovar e agendar' : 'Aprovar e publicar agora'; };
    $$('[name=pbModo]', d).forEach((x) => x.addEventListener('change', ajustaModo));
    $('#pbSo', d).onclick = async () => { try { await api(`/api/tasks/${opts.taskId}/aprovar`, { method: 'POST' }); d.close(); toast('Aprovada. Publique depois pela fila.'); opts.depois && opts.depois(); } catch (e) { $('#pbErro', d).textContent = e.message; } };
    $('#pbSug', d).onclick = async () => {
      const pls = $$('[data-pl]', d).filter((x) => x.checked).map((x) => x.dataset.pl).join(',');
      const b = $('#pbSug', d); b.disabled = true; b.textContent = 'Mariana pensando…'; $('#pbErro', d).textContent = '';
      try { const r = await api(`/api/tasks/${opts.taskId}/social-sugestao`, { method: 'POST', body: { plataformas: pls } }); if (r.texto) $('#pbTexto', d).value = r.texto; $('#pbSugTxt', d).textContent = r.horario ? '🕒 ' + r.horario : ''; }
      catch (e) { $('#pbErro', d).textContent = e.message; }
      b.disabled = false; b.textContent = '💡 Sugestão da Mariana';
    };
  }
  $('#pbOk', d).onclick = async () => {
    const plataformas = $$('[data-pl]', d).filter((x) => x.checked).map((x) => x.dataset.pl);
    if (!plataformas.length) return ($('#pbErro', d).textContent = 'Escolha onde publicar');
    if (opts.aprovar && modo() === 'agendar') {
      const quando = $('#pbData', d).value;
      if (!quando) return ($('#pbErro', d).textContent = 'Escolha a data e a hora');
      const b0 = $('#pbOk', d); b0.disabled = true; $('#pbErro', d).textContent = '';
      try {
        await api(`/api/tasks/${opts.taskId}/aprovar`, { method: 'POST', body: { modo: 'agendar', agendar_para: new Date(quando).toISOString(), plataformas, texto: $('#pbTexto', d).value, imagem_url: $('#pbImg', d).value } });
        d.close(); toast('Aprovada e agendada pela Mariana'); opts.depois && opts.depois();
      } catch (e) { $('#pbErro', d).textContent = e.message; }
      b0.disabled = false; return;
    }
    if (!confirm('Publicar agora em: ' + plataformas.join(', ') + '?')) return;
    const b = $('#pbOk', d); b.disabled = true; b.textContent = 'Publicando…'; $('#pbErro', d).textContent = '';
    try {
      if (opts.aprovar) { await api(`/api/tasks/${opts.taskId}/aprovar`, { method: 'POST' }); opts.aprovar = false; }
      const r = await api('/api/publicar', { method: 'POST', body: { plataformas, texto: $('#pbTexto', d).value, imagem_url: $('#pbImg', d).value, confirmado: true, task_id: opts.taskId || null, client_id: clienteId } });
      if (opts.depois && r.resultados.some((x) => x.status === 'publicado')) opts.depois();
      $('#pbRes', d).innerHTML = r.resultados.map((x) => `<div class="alerta ${x.status === 'publicado' ? 'ok' : 'danger'}"><b>${esc(x.plataforma)}</b>: ${x.status === 'publicado' ? 'publicado' : esc(x.erro)}</div>`).join('');
    } catch (e) { $('#pbErro', d).textContent = e.message; }
    b.disabled = false; b.textContent = modo() === 'agendar' ? 'Aprovar e agendar' : (opts.aprovar ? 'Aprovar e publicar agora' : 'Publicar agora');
  };
}

// Volta do login da Meta/LinkedIn: abre Integrações e mostra o resultado
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.get('integracao')) return;
  if (q.get('project_id') && q.get('client_id')) { S.projeto = q.get('project_id'); S.cliente = q.get('client_id'); S.view = 'acessos'; }
  else S.view = 'inicio';
  const msg = q.get('msg') || '';
  history.replaceState(null, '', '/');
  setTimeout(() => toast(msg), 1500);
})();

window.VIEWS_EXTRA = { solicitar: viewSolicitar, visao: viewSolicitar, recursos: (v) => viewArea(v, 'recursos'), acessos: (v) => viewArea(v, 'acessos'), relatorios: viewRelatorios, inicio: viewInicio, criar: viewCriar, solicitacoes: viewSolicitacoes, mensagens: viewMensagens, empregos: viewEmpregos, integracoes: viewIntegracoes };
