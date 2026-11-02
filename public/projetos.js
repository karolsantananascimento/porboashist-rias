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

function mostrarProjetoAtual() {
  const p = S.projeto ? projetoPorId(S.projeto) : null;
  const box = $('#projAtual');
  box.classList.toggle('hidden', !p);
  if (p) box.innerHTML = `<span class="proj-dot" style="background:${esc(p.cor)}"></span><div><small>Projeto aberto</small><strong>${esc(p.nome)}</strong></div>`;
  $$('#nav a[data-proj]').forEach((a) => a.classList.toggle('hidden', !p));
}

const opcoesProjetos = (sel) => S.projetos.map((p) => `<option value="${p.id}" ${String(p.id) === String(sel) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');

// ---------------- Início: cards de projetos + Criar ----------------
async function viewInicio(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const cards = S.projetos.map((p) => `
    <article class="proj-card" style="--cor:${esc(p.cor)}">
      <button class="proj-open" data-abrir="${p.id}" aria-label="Abrir ${esc(p.nome)}">
        <h3>${esc(p.nome)}</h3>
        <p>${esc(p.descricao || '')}</p>
        <div class="proj-stats">
          <span><b>${p.clientes}</b> ${p.clientes === 1 ? 'cliente' : 'clientes'}</span>
          <span><b>${p.abertas}</b> em aberto</span>
          <span class="${p.atrasadas ? 'late' : ''}"><b>${p.atrasadas}</b> atrasadas</span>
          <span><b>${p.solicitacoes_abertas}</b> solicitações</span>
        </div>
        ${p.nomes_clientes.length ? `<div class="proj-tags">${p.nomes_clientes.slice(0, 6).map((n) => `<i>${esc(n)}</i>`).join('')}</div>` : ''}
      </button>
      <div class="proj-acts">
        <button class="btn small" data-abrir="${p.id}">Abrir painel</button>
        <button class="btn small" data-criar-em="${p.id}">✦ Criar</button>
        <button class="btn small" data-solic-em="${p.id}">✉ Solicitações</button>
        <button class="btn ghost small" data-editar="${p.id}">Contexto</button>
      </div>
    </article>`).join('');

  const acoes = [
    ['hugo', 'Conteúdo', 'Legendas, carrosséis, roteiros e artigos'],
    ['luiz', 'Artes', 'Direção de arte e prompts de imagem'],
    ['davi', 'Edição de vídeo', 'Roteiro, decupagem e passo a passo'],
    ['felipe', 'Responder mensagens', 'Instagram e Facebook (Meta)'],
    ['camila', 'Campanhas de anúncios', 'Meta, Google e LinkedIn Ads'],
    ['bianca', 'Empregos', 'Workana, LinkedIn: vagas, propostas, cadastros'],
  ].map(([id, titulo, sub]) => {
    const a = agente(id);
    return `<button class="ag-card" data-ag="${id}">
      <span class="ag-ico">${a.icone}</span>
      <span><b>${esc(titulo)}</b><small>com ${esc(a.nome)} · ${esc(a.cargo)}</small><em>${esc(sub)}</em></span>
    </button>`;
  }).join('');

  v.innerHTML = `
    <div class="view-head"><div><h2>Projetos</h2><p>Escolha um projeto para ver tarefas, calendário e clientes, ou crie algo agora.</p></div>
      ${S.me.papel === 'admin' ? '<button class="btn" id="novoProj">+ Novo projeto</button>' : ''}</div>
    <div class="proj-grid">${cards}</div>
    <h3 class="secao-h">Criar</h3>
    ${AGENTES.length && !AGENTES[0].ativo ? '<div class="alerta">Os agentes ainda não estão ativos: falta configurar <b>ANTHROPIC_API_KEY</b> no Render.</div>' : ''}
    <div class="ag-grid">${acoes}</div>`;

  $$('[data-abrir]', v).forEach((b) => b.addEventListener('click', () => abrirProjeto(b.dataset.abrir, 'painel')));
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
      <div class="row"><div><label>Kit de marca no Canva (nome)</label><input id="pjKitNome" value="${esc(p?.canva_kit_nome || '')}" placeholder="Ex.: Disco Mídia"></div>
        <div><label>ID do kit no Canva</label><input id="pjKitId" value="${esc(p?.canva_kit_id || '')}" placeholder="Ex.: kAHVxV_gqbI"></div></div>
      <p class="erro" id="pjErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="pjSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#pjSalvar').addEventListener('click', async () => {
    const body = { nome: $('#pjNome').value, cor: $('#pjCor').value, descricao: $('#pjDesc').value, contexto: $('#pjCtx').value,
      canva_kit_nome: $('#pjKitNome').value, canva_kit_id: $('#pjKitId').value };
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
  const proj = c.project_id ? projetoPorId(c.project_id) : null;
  el.innerHTML = `${luiz ? `<div class="canva-box"><b>🎨 Canva</b>
      <p class="muted" style="margin:4px 0 8px">${proj && proj.canva_kit_nome ? `Kit de marca do projeto: <b>${esc(proj.canva_kit_nome)}</b>. ` : 'Este projeto ainda não tem kit de marca (defina em Contexto do projeto). '}
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
  const pub = $('#crPublicar'); if (pub) pub.onclick = () => abrirPublicar($('#crTexto').value);
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
            ${x.origem === 'formulario' ? '<span class="pill">Formulário</span>' : ''}${p ? '' : `<small>${esc(nomeProj(x.project_id))}</small>`}</div>
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

// ---------------- Mensagens (Felipe) ----------------
async function viewMensagens(v) {
  await Promise.all([carregarProjetos(), carregarAgentes()]);
  const [msgs, integ] = await Promise.all([api('/api/mensagens'), api('/api/integracoes')]);
  const f = agente('felipe');
  const card = (m) => `
    <div class="card msg ${m.status}" data-m="${m.id}">
      <div class="msg-top"><span class="pill">${esc({ instagram: 'Instagram', facebook: 'Facebook', manual: 'Colada' }[m.canal] || m.canal)}</span>
        <b>${esc(m.remetente_nome || (m.remetente_id ? 'Contato ' + m.remetente_id.slice(-4) : 'Contato'))}</b>
        <small>${esc(new Date(m.created_at).toLocaleString('pt-BR'))}</small>
        <span class="pill ${m.status === 'respondida' ? 'ok' : ''}">${{ nova: 'Nova', respondida: 'Respondida', ignorada: 'Ignorada' }[m.status]}</span></div>
      <p class="msg-txt">${esc(m.texto)}</p>
      ${m.status === 'ignorada' ? '' : `
      <label>Resposta</label>
      <textarea rows="4" data-resp="${m.id}" ${m.status === 'respondida' ? 'readonly' : ''}>${esc(m.resposta || '')}</textarea>
      <div class="acoes-res">
        ${m.status === 'respondida' ? '' : `
        <select data-proj="${m.id}" aria-label="Projeto da resposta">${opcoesProjetos(m.project_id || S.projeto || (S.projetos[0] || {}).id)}</select>
        <button class="btn small" data-sug="${m.id}">${f.icone} ${m.resposta ? 'Sugerir outra' : 'Sugerir resposta'}</button>
        <button class="btn small primary" data-env="${m.id}">${m.canal === 'manual' ? 'Marcar como respondida' : 'Enviar pela Meta'}</button>`}
        <button class="btn small" data-cp="${m.id}">Copiar</button>
        ${m.status === 'nova' ? `<button class="btn small ghost" data-ign="${m.id}">Ignorar</button>` : ''}
        <button class="btn small ghost danger" data-del="${m.id}">Excluir</button>
      </div>`}
    </div>`;
  v.innerHTML = `
    <div class="view-head"><div><h2>Mensagens · ${esc(f.nome)}</h2>
      <p>${esc(f.descricao)}</p></div>
      <button class="btn" id="msgNova">+ Colar mensagem</button></div>
    ${integ.meta.recebe ? '' : '<div class="alerta">As mensagens do Instagram/Facebook ainda não chegam sozinhas. Veja como conectar em <a href="#" data-go-int>Integrações</a>. Enquanto isso, cole a mensagem aqui e o Felipe sugere a resposta.</div>'}
    <div id="msgLista" class="msg-lista">${msgs.length ? msgs.map(card).join('') : '<div class="empty">Nenhuma mensagem ainda.</div>'}</div>`;
  $$('[data-go-int]', v).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); S.view = 'integracoes'; render(); }));
  $('#msgNova').addEventListener('click', () => {
    const d = $('#modal');
    d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>Colar mensagem recebida</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
      <div class="modal-body"><div><label>Nome do contato (opcional)</label><input id="mnNome"></div>
      <div><label>Mensagem</label><textarea id="mnTxt" rows="5"></textarea></div><p class="erro" id="mnErro" style="margin:0"></p></div>
      <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="mnOk">Adicionar</button></div></div></form>`;
    d.showModal();
    $('#mnOk').onclick = async () => {
      try { await api('/api/mensagens', { method: 'POST', body: { remetente_nome: $('#mnNome').value, texto: $('#mnTxt').value, project_id: Number(S.projeto) || null } }); d.close(); render(); }
      catch (e) { $('#mnErro').textContent = e.message; }
    };
  });
  const respDe = (id) => $(`[data-resp="${id}"]`, v).value;
  const lida = async (fn) => { try { await fn(); } catch (e) { toast(e.message); } };
  $$('[data-sug]', v).forEach((b) => b.addEventListener('click', () => lida(async () => {
    b.disabled = true; b.textContent = 'Felipe está escrevendo…';
    try {
      const m = await api(`/api/mensagens/${b.dataset.sug}/sugerir`, { method: 'POST', body: { project_id: Number($(`[data-proj="${b.dataset.sug}"]`, v).value) || null } });
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
  const b = agente('bianca');
  v.innerHTML = `
    <div class="view-head"><div><h2>Empregos · ${esc(b.nome)}</h2><p>${esc(b.descricao)}</p></div>
      <div class="seg" role="tablist">${[['vagas', 'Vagas'], ['perfil', 'Meu perfil']].map(([k, l]) =>
        `<button role="tab" data-ea="${k}" class="${S.empAba === k ? 'on' : ''}" aria-selected="${S.empAba === k}">${l}</button>`).join('')}</div></div>
    <div id="empCorpo"></div>`;
  $$('[data-ea]', v).forEach((x) => x.addEventListener('click', () => { S.empAba = x.dataset.ea; viewEmpregos(v); }));
  if (S.empAba === 'perfil') return empPerfil($('#empCorpo'));
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

async function empPerfil(el) {
  const p = await api('/api/perfil');
  const campos = [
    ['nome', 'Nome completo'], ['email', 'E-mail'], ['telefone', 'Telefone / WhatsApp'], ['cidade', 'Cidade'],
    ['linkedin', 'Link do LinkedIn'], ['portfolio', 'Portfólio / site'], ['headline', 'Título profissional'],
    ['idiomas', 'Idiomas'], ['pretensao', 'Pretensão (salário ou valor/hora)'], ['disponibilidade', 'Disponibilidade'],
  ];
  const longos = [['resumo', 'Resumo profissional', 4], ['experiencias', 'Experiências (uma por linha)', 7], ['formacao', 'Formação', 3], ['observacoes', 'Observações para a Bianca', 3]];
  el.innerHTML = `<div class="card"><p class="muted" style="margin-top:0">É daqui que a Bianca tira os dados para propostas e cadastros. O que estiver vazio ela deixa marcado como [PREENCHER] em vez de inventar.</p>
    <div class="perfil-grid">${campos.map(([k, l]) => `<div><label>${l}</label><input data-pf="${k}" value="${esc(p[k] || '')}"></div>`).join('')}</div>
    ${longos.map(([k, l, r]) => `<div style="margin-top:10px"><label>${l}</label><textarea rows="${r}" data-pf="${k}">${esc(p[k] || '')}</textarea></div>`).join('')}
    <div style="margin-top:14px"><button class="btn primary" id="pfSalvar">Salvar perfil</button></div></div>`;
  $('#pfSalvar').onclick = async () => {
    const body = {}; $$('[data-pf]', el).forEach((i) => { body[i.dataset.pf] = i.value; });
    try { await api('/api/perfil', { method: 'PUT', body }); toast('Perfil salvo'); } catch (e) { toast(e.message); }
  };
}

// ---------------- Integrações ----------------
async function viewIntegracoes(v) {
  const adm = S.me.papel === 'admin';
  const [ia, c, pubs, chaves, imp] = await Promise.all([
    api('/api/agentes').then((l) => l[0].ativo), api('/api/conexoes'), api('/api/publicacoes'),
    adm ? api('/api/configuracoes') : [], adm ? api('/api/importar/token') : { existe: false }]);
  const st = (ok, sim, nao) => `<span class="pill ${ok ? 'ok' : ''}">${ok ? sim : nao}</span>`;
  const m = c.meta, li = c.linkedin;
  const passo = (t) => `<li>${t}</li>`;

  const cartaoMeta = `<div class="card"><h3>Facebook e Instagram ${st(m.conectado, 'Conectado', m.app_configurado ? 'Não conectado' : 'Falta o app da Meta')}</h3>
    ${m.conectado ? `
      <p>Conta: <b>${esc(m.usuario || '')}</b></p>
      <label>Página usada para publicar e responder</label>
      <select id="mtPagina" ${adm ? '' : 'disabled'}>${m.paginas.map((p) => `<option value="${esc(p.id)}" ${p.id === m.pagina_id ? 'selected' : ''}>${esc(p.nome)}${p.ig_usuario ? ' · @' + esc(p.ig_usuario) : ' · sem Instagram vinculado'}</option>`).join('')}</select>
      <p class="muted">Facebook: <b>${esc(m.facebook || '-')}</b> · Instagram: <b>${m.instagram ? '@' + esc(m.instagram) : 'não vinculado'}</b></p>
      ${adm ? '<div class="acoes-res"><a class="btn small" href="/oauth/meta/iniciar">Reconectar</a><button class="btn small danger" id="mtDesc">Desconectar</button></div>' : ''}
    ` : m.app_configurado ? `<p class="muted">Clique para entrar com o Facebook e liberar a sua página e o Instagram profissional vinculado a ela.</p>
      ${adm ? '<a class="btn primary" href="/oauth/meta/iniciar">Conectar Facebook e Instagram</a>' : '<p class="muted">Peça a um administrador para conectar.</p>'}` : `
      <p class="muted">Antes de conectar, é preciso criar um app na Meta (uma vez só):</p>
      <ol class="passos">
        ${passo('Acesse <b>developers.facebook.com</b> > Meus apps > Criar app > tipo <b>Empresa</b>.')}
        ${passo('Adicione os produtos <b>Login do Facebook para Empresas</b> e <b>Messenger</b> (e Instagram).')}
        ${passo(`Em URIs de redirecionamento OAuth válidos, cadastre: <code class="url">${esc(m.redirect)}</code>`)}
        ${passo('Copie o <b>ID do app</b> e a <b>Chave secreta do app</b> e coloque no Render como <code>META_APP_ID</code> e <code>META_APP_SECRET</code>.')}
        ${passo('Com o app em modo de desenvolvimento, funciona para você e para quem for administrador ou testador do app. Para outras pessoas, a Meta exige a análise do app.')}
      </ol>`}
  </div>`;

  const cartaoWebhook = `<div class="card"><h3>Receber mensagens ${st(m.conectado && !!m.verify_token, 'Pronto para configurar', 'Conecte primeiro')}</h3>
    <p class="muted">No app da Meta, em Webhooks (Page e Instagram), use a URL e o token abaixo e assine <b>messages</b>.</p>
    <label>URL de callback</label><p><code class="url">${esc(m.webhook)}</code> <button class="btn small" id="cpWh">Copiar</button></p>
    ${m.verify_token ? `<label>Token de verificação</label><p><code class="url">${esc(m.verify_token)}</code> <button class="btn small" id="cpTk">Copiar</button></p>` : ''}
    <p class="muted">As mensagens aparecem em <b>Mensagens (Meta)</b>; o Felipe sugere a resposta e você aprova.</p></div>`;

  const exp = li.expira_em ? new Date(li.expira_em).toLocaleDateString('pt-BR') : '';
  const cartaoLi = `<div class="card"><h3>LinkedIn ${st(li.conectado && !li.expirado, 'Conectado', li.expirado ? 'Expirou' : li.app_configurado ? 'Não conectado' : 'Falta o app do LinkedIn')}</h3>
    ${li.conectado ? `<p>Perfil: <b>${esc(li.nome || '')}</b></p><p class="muted">A conexão vale até ${esc(exp)}; depois é só reconectar.</p>
      ${adm ? '<div class="acoes-res"><a class="btn small" href="/oauth/linkedin/iniciar">Reconectar</a><button class="btn small danger" id="liDesc">Desconectar</button></div>' : ''}`
      : li.app_configurado ? `<p class="muted">Conecte o seu perfil para publicar posts daqui.</p>${adm ? '<a class="btn primary" href="/oauth/linkedin/iniciar">Conectar LinkedIn</a>' : ''}` : `
      <p class="muted">Antes de conectar, crie um app (uma vez só):</p>
      <ol class="passos">
        ${passo('Acesse <b>linkedin.com/developers</b> > Create app (é preciso vincular uma Página da empresa).')}
        ${passo('Na aba Products, solicite <b>Share on LinkedIn</b> e <b>Sign In with LinkedIn using OpenID Connect</b>.')}
        ${passo(`Na aba Auth, em Authorized redirect URLs, cadastre: <code class="url">${esc(li.redirect)}</code>`)}
        ${passo('Copie o <b>Client ID</b> e o <b>Client Secret</b> e coloque no Render como <code>LINKEDIN_CLIENT_ID</code> e <code>LINKEDIN_CLIENT_SECRET</code>.')}
      </ol>`}
  </div>`;

  const GRUPOS = { ia: 'Agentes (Claude)', meta: 'Facebook e Instagram (Meta)', linkedin: 'LinkedIn' };
  const painelChaves = adm ? `
    <div class="card" style="margin-bottom:16px"><h3>Chaves das APIs</h3>
      <p class="muted">Cole aqui as chaves dos apps. Ficam criptografadas e valem mais que as variáveis do Render. Depois de salvar, use os botões de conectar logo abaixo.</p>
      ${Object.entries(GRUPOS).map(([g, nome]) => `<h4 class="chv-g">${nome}</h4>` + chaves.filter((k) => k.grupo === g).map((k) => `
        <div class="chv"><label>${esc(k.rotulo)}</label>
          <div class="chv-l"><input type="${k.secreto ? 'password' : 'text'}" data-chv="${k.chave}" placeholder="${k.definido ? esc(k.previa) : 'Cole aqui'}" autocomplete="off">
            <button class="btn small primary" data-chv-ok="${k.chave}">Salvar</button>
            ${k.origem === 'painel' ? `<button class="btn small ghost danger" data-chv-rm="${k.chave}">Remover</button>` : ''}
            <span class="pill ${k.definido ? 'ok' : ''}">${k.definido ? (k.origem === 'painel' ? 'No painel' : 'No Render') : 'Vazio'}</span></div></div>`).join('')).join('')}
      <p class="erro" id="chvErro"></p>
    </div>` : '';
  const painelImport = adm ? `<div class="card"><h3>Importação automática de pautas</h3>
      <p class="muted">Para enviar pautas de fora do sistema (por exemplo, de uma automação), gere um token e envie um POST para <code>/importar/pautas</code> com o cabeçalho <code>Authorization: Bearer SEU_TOKEN</code>. O formato é o mesmo do botão "Importar pautas" em Criar.</p>
      <div class="acoes-res"><button class="btn small" id="impTok">${imp.existe ? 'Gerar novo token' : 'Gerar token'}</button>${imp.existe ? '<span class="pill ok">Token ativo</span>' : ''}</div>
      <div id="impTokRes"></div></div>` : '';

  v.innerHTML = `
    <div class="view-head"><div><h2>Integrações</h2><p>Conecte suas contas. Nada é publicado ou enviado sem o seu clique de confirmação.</p></div></div>
    ${painelChaves}
    <div class="grid cols-2">
      ${cartaoMeta}${cartaoLi}${cartaoWebhook}
      <div class="card"><h3>Agentes (IA) ${st(ia, 'Ativos', 'Desligados')}</h3>
        <p class="muted">Hugo, Luiz, Davi, Camila, Felipe e Bianca usam a API do Claude. Variável no Render: <code>ANTHROPIC_API_KEY</code>.</p></div>
      ${painelImport}
      <div class="card"><h3>Workana</h3><p class="muted">A Workana não oferece integração aberta para candidaturas. A Bianca prepara a proposta e as respostas de cadastro; você cola e envia.</p></div>
      <div class="card"><h3>Anúncios (Meta, Google, LinkedIn)</h3><p class="muted">A Camila monta o plano completo. Para subir os anúncios de fato, use o seu Assistente de Marketing (gestoragente).</p></div>
    </div>
    <h3 class="secao-h">Últimas publicações</h3>
    <div class="card">${pubs.length ? pubs.map((x) => `<div class="linha-cr" style="cursor:default"><span class="pill ${x.status === 'publicado' ? 'ok' : ''}">${esc({ facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' }[x.plataforma])}</span>
      <span class="lc-t"><b>${esc((x.texto || '').split('\n')[0].slice(0, 90))}</b><small>${esc(new Date(x.created_at).toLocaleString('pt-BR'))}${x.erro ? ' · ' + esc(x.erro) : ''}</small></span>
      <span class="pill ${x.status === 'publicado' ? 'ok' : ''}">${x.status === 'publicado' ? 'Publicado' : 'Erro'}</span></div>`).join('') : '<div class="empty">Nada publicado por aqui ainda.</div>'}</div>`;

  $$('[data-chv-ok]', v).forEach((b) => b.addEventListener('click', async () => {
    const campo = $(`[data-chv="${b.dataset.chvOk}"]`, v);
    if (!campo.value.trim()) return ($('#chvErro', v).textContent = 'Cole o valor antes de salvar');
    try { await api('/api/configuracoes/' + b.dataset.chvOk, { method: 'PUT', body: { valor: campo.value } }); toast('Chave salva'); viewIntegracoes(v); }
    catch (e) { $('#chvErro', v).textContent = e.message; }
  }));
  $$('[data-chv-rm]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta chave do painel?')) return;
    try { await api('/api/configuracoes/' + b.dataset.chvRm, { method: 'DELETE' }); viewIntegracoes(v); } catch (e) { toast(e.message); }
  }));
  const it = $('#impTok', v);
  if (it) it.onclick = async () => {
    if (imp.existe && !confirm('O token anterior deixará de funcionar. Continuar?')) return;
    try { const r = await api('/api/importar/token', { method: 'POST', body: {} });
      $('#impTokRes', v).innerHTML = `<p style="margin-top:10px">Copie agora; ele não aparece de novo:</p><p><code class="url">${esc(r.token)}</code> <button class="btn small" id="impTokCp">Copiar</button></p>`;
      $('#impTokCp', v).onclick = () => copiar(r.token); } catch (e) { toast(e.message); }
  };
  const cp = (id, t) => { const b = $(id, v); if (b) b.onclick = () => copiar(t); };
  cp('#cpWh', m.webhook); cp('#cpTk', m.verify_token);
  const sel = $('#mtPagina', v);
  if (sel) sel.onchange = async () => { try { await api('/api/conexoes/meta/pagina', { method: 'PUT', body: { pagina_id: sel.value } }); toast('Página atualizada'); viewIntegracoes(v); } catch (e) { toast(e.message); } };
  const desc = (id, prov, nome) => { const b = $(id, v); if (b) b.onclick = async () => { if (!confirm(`Desconectar ${nome}?`)) return; await api('/api/conexoes/' + prov, { method: 'DELETE' }); viewIntegracoes(v); }; };
  desc('#mtDesc', 'meta', 'o Facebook e o Instagram'); desc('#liDesc', 'linkedin', 'o LinkedIn');
}

// ---------------- Publicar (com confirmação) ----------------
async function abrirPublicar(texto) {
  const c = await api('/api/conexoes');
  const opcoes = [
    ['facebook', 'Facebook' + (c.meta.facebook ? ' · ' + c.meta.facebook : ''), c.meta.conectado, 'Conecte em Integrações'],
    ['instagram', 'Instagram' + (c.meta.instagram ? ' · @' + c.meta.instagram : ''), c.meta.conectado && !!c.meta.instagram, c.meta.conectado ? 'Sem Instagram vinculado à página' : 'Conecte em Integrações'],
    ['linkedin', 'LinkedIn' + (c.linkedin.nome ? ' · ' + c.linkedin.nome : ''), c.linkedin.conectado && !c.linkedin.expirado, 'Conecte em Integrações'],
  ];
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><div class="modal-head"><h3>Publicar</h3><button class="icon" value="x" aria-label="Fechar">×</button></div>
    <div class="modal-body">
      <div><label>Onde publicar</label>${opcoes.map(([k, l, ok, aviso]) => `<label class="chk ${ok ? '' : 'off'}"><input type="checkbox" data-pl="${k}" ${ok ? '' : 'disabled'}> ${esc(l)}${ok ? '' : ` <small>(${esc(aviso)})</small>`}</label>`).join('')}</div>
      <div><label>Texto</label><textarea id="pbTexto" rows="9">${esc(texto)}</textarea></div>
      <div><label>Link da imagem (https://, obrigatório no Instagram)</label><input id="pbImg" placeholder="https://"></div>
      <p class="muted" style="margin:0">LinkedIn: sai só o texto. A publicação é imediata e pública.</p>
      <p class="erro" id="pbErro" style="margin:0"></p><div id="pbRes"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Fechar</button><button type="button" class="btn primary" id="pbOk">Publicar agora</button></div></div></form>`;
  document.body.appendChild(d); d.showModal();
  d.addEventListener('close', () => d.remove());
  $('#pbOk', d).onclick = async () => {
    const plataformas = $$('[data-pl]', d).filter((x) => x.checked).map((x) => x.dataset.pl);
    if (!plataformas.length) return ($('#pbErro', d).textContent = 'Escolha onde publicar');
    if (!confirm('Publicar agora em: ' + plataformas.join(', ') + '?')) return;
    const b = $('#pbOk', d); b.disabled = true; b.textContent = 'Publicando…'; $('#pbErro', d).textContent = '';
    try {
      const r = await api('/api/publicar', { method: 'POST', body: { plataformas, texto: $('#pbTexto', d).value, imagem_url: $('#pbImg', d).value, confirmado: true } });
      $('#pbRes', d).innerHTML = r.resultados.map((x) => `<div class="alerta ${x.status === 'publicado' ? 'ok' : 'danger'}"><b>${esc(x.plataforma)}</b>: ${x.status === 'publicado' ? 'publicado' : esc(x.erro)}</div>`).join('');
    } catch (e) { $('#pbErro', d).textContent = e.message; }
    b.disabled = false; b.textContent = 'Publicar agora';
  };
}

// Volta do login da Meta/LinkedIn: abre Integrações e mostra o resultado
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.get('integracao')) return;
  S.view = 'integracoes';
  const msg = q.get('msg') || '';
  history.replaceState(null, '', '/');
  setTimeout(() => toast(msg), 1500);
})();

window.VIEWS_EXTRA = { inicio: viewInicio, criar: viewCriar, solicitacoes: viewSolicitacoes, mensagens: viewMensagens, empregos: viewEmpregos, integracoes: viewIntegracoes };
