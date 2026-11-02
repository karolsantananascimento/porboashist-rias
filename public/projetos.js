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
        </div>
        ${p.nomes_clientes.length ? `<div class="proj-tags">${p.nomes_clientes.slice(0, 6).map((n) => `<i>${esc(n)}</i>`).join('')}</div>` : ''}
      </button>
      <div class="proj-acts">
        <button class="btn small" data-abrir="${p.id}">Abrir painel</button>
        <button class="btn small" data-criar-em="${p.id}">✦ Criar</button>
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
      <p class="erro" id="pjErro" style="margin:0"></p>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button class="btn" value="x">Cancelar</button><button type="button" class="btn primary" id="pjSalvar">Salvar</button></div></div>
  </form>`;
  d.showModal();
  $('#pjSalvar').addEventListener('click', async () => {
    const body = { nome: $('#pjNome').value, cor: $('#pjCor').value, descricao: $('#pjDesc').value, contexto: $('#pjCtx').value };
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
        <textarea id="crPedido" rows="5" placeholder="Ex.: promoção de fim de ano, público feminino 25-45, tom leve; CTA para o WhatsApp"></textarea></div>
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
    if (S.cliente && lista.some((c) => String(c.id) === String(S.cliente))) $('#crCli').value = S.cliente;
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
    } catch (err) { $('#crErro').textContent = err.message; }
    btn.disabled = false; btn.textContent = `Gerar de novo com ${a.nome}`;
  });
}

function mostrarCriacao(c, el) {
  el.innerHTML = `<label>Resultado (pode editar)</label>
    <textarea id="crTexto" rows="16" class="resultado">${esc(c.saida)}</textarea>
    <div class="acoes-res">
      <button type="button" class="btn small" id="crCopiar">Copiar</button>
      <button type="button" class="btn small" id="crSalvar">Salvar edição</button>
      <button type="button" class="btn small" id="crAprovar">${c.status === 'aprovado' ? 'Aprovado ✓' : 'Aprovar'}</button>
      <button type="button" class="btn small" id="crTarefa">Virar tarefa</button>
      <button type="button" class="btn small danger" id="crExcluir">Excluir</button>
    </div>`;
  $('#crCopiar').onclick = () => copiar($('#crTexto').value);
  $('#crSalvar').onclick = async () => { try { c = await api('/api/criacoes/' + c.id, { method: 'PUT', body: { saida: $('#crTexto').value } }); toast('Salvo'); } catch (e) { toast(e.message); } };
  $('#crAprovar').onclick = async () => {
    try { c = await api('/api/criacoes/' + c.id, { method: 'PUT', body: { saida: $('#crTexto').value, status: c.status === 'aprovado' ? 'rascunho' : 'aprovado' } }); mostrarCriacao(c, el); toast(c.status === 'aprovado' ? 'Aprovado' : 'Voltou para rascunho'); }
    catch (e) { toast(e.message); }
  };
  $('#crTarefa').onclick = () => virarTarefa(c);
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
      <p>Escolha quem vai fazer. Nada é publicado sozinho: você revisa, edita e aprova.</p></div></div>
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
  const i = await api('/api/integracoes');
  const st = (ok, sim, nao) => `<span class="pill ${ok ? 'ok' : ''}">${ok ? sim : nao}</span>`;
  v.innerHTML = `
    <div class="view-head"><div><h2>Integrações</h2><p>O que já está conectado e o que falta. Os agentes só enviam algo depois do seu clique.</p></div></div>
    <div class="grid cols-2">
      <div class="card"><h3>Agentes (IA) ${st(i.ia, 'Ativos', 'Desligados')}</h3>
        <p class="muted">Hugo, Luiz, Davi, Camila, Felipe e Bianca usam a API do Claude. Variável no Render: <code>ANTHROPIC_API_KEY</code>.</p></div>
      <div class="card"><h3>Meta · receber mensagens ${st(i.meta.recebe, 'Conectado', 'Falta configurar')}</h3>
        <p class="muted">No app da Meta (Messenger/Instagram), configure o webhook com a URL abaixo e o mesmo token de verificação.</p>
        <p><code class="url">${esc(i.meta.webhook)}</code> <button class="btn small" id="cpWh">Copiar</button></p>
        <p class="muted">Variáveis no Render: <code>META_VERIFY_TOKEN</code> (você escolhe o texto) e <code>META_APP_SECRET</code> (segredo do app).</p></div>
      <div class="card"><h3>Meta · enviar respostas ${st(i.meta.envia, 'Conectado', 'Falta configurar')}</h3>
        <p class="muted">Variável no Render: <code>META_PAGE_TOKEN</code> (token da página com permissão de mensagens). A Meta só permite responder em até 24 horas após a mensagem do contato.</p></div>
      <div class="card"><h3>LinkedIn ${st(false, '', 'Manual')}</h3>
        <p class="muted">Hugo escreve os posts e a Bianca monta propostas, mas a publicação e o envio de candidaturas são manuais: copie o texto e cole no LinkedIn.</p></div>
      <div class="card"><h3>Workana ${st(false, '', 'Manual')}</h3>
        <p class="muted">A Workana não oferece integração aberta para candidaturas. A Bianca prepara proposta e respostas de cadastro com o seu perfil; você cola e envia.</p></div>
      <div class="card"><h3>Anúncios (Meta, Google, LinkedIn)</h3>
        <p class="muted">A Camila monta o plano completo da campanha. Para subir os anúncios de fato, use o seu Assistente de Marketing (gestoragente), que já tem a conexão com as contas de anúncios.</p></div>
    </div>`;
  $('#cpWh').onclick = () => copiar(i.meta.webhook);
}

window.VIEWS_EXTRA = { inicio: viewInicio, criar: viewCriar, mensagens: viewMensagens, empregos: viewEmpregos, integracoes: viewIntegracoes };
