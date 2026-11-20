// Gestor de tráfego: campanhas no Meta Ads (Facebook e Instagram).
// Base: módulo de campanhas do Agente de Tráfego (gestoragente), adaptado a este sistema.
//
// Fluxo, sempre com uma pessoa no comando:
//   1. A Camila monta o plano da campanha (esteira.js) e o sistema gera um RASCUNHO técnico a partir dele.
//   2. A pessoa revisa e edita o rascunho na tela e clica em "Conferir" (só leituras no Meta).
//   3. Um administrador clica em "Subir pausada": cria campanha + conjunto + criativo + anúncio, tudo PAUSADO.
//   4. Um administrador confere no Gerenciador de Anúncios e clica em "Ativar" (é aí que começa a gastar).
// Travas: orçamento diário máximo por campanha, limite de ativações por dia, transições de estado atômicas
// (clique duplo não cria duas campanhas) e nenhuma exclusão de nada no Meta.

const { cfg } = require('./config');
const { lerConexao } = require('./integracoes');

const VERSAO = process.env.META_GRAPH_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSAO}`;
const TETO_PADRAO_BRL = 100;
const ATIVACOES_POR_DIA = 5;
const PRESETS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'];

const OBJ = {
  OUTCOME_TRAFFIC: { goal: 'LINK_CLICKS', rotulo: 'Tráfego' },
  OUTCOME_AWARENESS: { goal: 'REACH', rotulo: 'Reconhecimento' },
  OUTCOME_LEADS: { goal: 'OFFSITE_CONVERSIONS', evento: 'LEAD', rotulo: 'Leads' },
  OUTCOME_SALES: { goal: 'OFFSITE_CONVERSIONS', evento: 'PURCHASE', rotulo: 'Vendas' },
  OUTCOME_ENGAGEMENT: { goal: 'POST_ENGAGEMENT', rotulo: 'Engajamento' },
};
// Destinos. Engajamento: post (curtidas/comentários) ou mensagens. Leads: site ou WhatsApp. Demais: site.
const DESTINOS = ['site', 'whatsapp', 'post', 'messenger', 'instagram_direct', 'instagram_facebook'];
const MSG = {
  messenger: { destination_type: 'MESSENGER', cta: 'MESSAGE_PAGE', app: 'MESSENGER', rotulo: 'mensagens no Messenger (Facebook)' },
  instagram_direct: { destination_type: 'INSTAGRAM_DIRECT', cta: 'INSTAGRAM_MESSAGE', app: 'INSTAGRAM_DIRECT', rotulo: 'mensagens no Instagram Direct' },
  instagram_facebook: { destination_type: 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER', cta: 'MESSAGE_PAGE', app: 'MESSENGER', rotulo: 'mensagens no Instagram e no Facebook' },
};
const OBJ_MSG = ['OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES'];
const MSG_LINK = 'https://fb.com/messenger_doc/';
const CTAS = ['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD', 'APPLY_NOW', 'BOOK_TRAVEL'];
const DESTINO_ROTULO = { site: 'site', whatsapp: 'WhatsApp', post: 'engajamento no anúncio', messenger: 'Messenger', instagram_direct: 'Instagram Direct', instagram_facebook: 'Instagram e Facebook' };

const httpsUrl = (u) => /^https:\/\/[^\s]+$/i.test(String(u || ''));
// imagem enviada pelo assinante pela tela: guardada como "midia:<id>"
const ehMidia = (u) => /^midia:\d+$/.test(String(u || ''));
const imagemOk = (u) => httpsUrl(u) || ehMidia(u);
const semAcento = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const centavos = (brl) => String(Math.round(Number(brl) * 100));
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Chamadas ao Graph API (o token vai no cabeçalho, nunca na URL nem nos logs) ----------
async function chamar(ctx, caminho, { metodo = 'GET', params = {} } = {}) {
  const init = { method: metodo, headers: { authorization: `Bearer ${ctx.token}` }, signal: AbortSignal.timeout(30000) };
  let url = `${BASE}/${caminho}`;
  if (metodo === 'GET') { const qs = new URLSearchParams(params).toString(); if (qs) url += `?${qs}`; }
  else init.body = new URLSearchParams(params);
  let r;
  try { r = await fetch(url, init); }
  catch (e) { throw erro(e.name === 'TimeoutError' ? 'O Meta demorou demais para responder. Tente de novo.' : 'Não consegui falar com o Meta agora. Tente de novo.', 504); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const e = d.error || {};
    throw erro(e.error_user_msg || e.message || `O Meta recusou o pedido (HTTP ${r.status})`, 502);
  }
  return d;
}
const get = (ctx, caminho, params) => chamar(ctx, caminho, { params });
const post = (ctx, caminho, params) => chamar(ctx, caminho, { metodo: 'POST', params });

// Segue a paginação (até 10 páginas) só para o próprio graph.facebook.com
async function lerTodos(ctx, caminho, params = {}) {
  let r = await get(ctx, caminho, params); const out = [...(r.data || [])];
  for (let i = 0; i < 10 && r.paging?.next; i++) {
    const u = new URL(r.paging.next); if (u.hostname !== 'graph.facebook.com') break;
    u.searchParams.delete('access_token');
    const resp = await fetch(u, { headers: { authorization: `Bearer ${ctx.token}` }, signal: AbortSignal.timeout(30000) });
    r = await resp.json().catch(() => ({})); if (r.error) break; out.push(...(r.data || []));
  }
  return out;
}

// ---------- Contexto de um cliente: token e conta de anúncios, página do Facebook e Instagram ----------
async function contexto(pool, clienteId, { exigirPagina = false } = {}) {
  const token = cfg('META_ADS_TOKEN', clienteId);
  if (!token) throw erro('O Meta Ads ainda não está configurado para este cliente: cole o token de anúncios em Integrações (Meta Ads · Token de acesso).');
  const idConta = String(cfg('META_AD_ACCOUNT_ID', clienteId) || '').trim();
  const conta = idConta ? (idConta.startsWith('act_') ? idConta : `act_${idConta}`) : '';
  const con = await lerConexao(pool, 'meta', clienteId);
  const pg = con && (con.paginas || []).find((p) => p.id === con.pagina_id);
  const ctx = {
    token, conta, pixel: cfg('META_PIXEL_ID', clienteId) || '',
    teto: Number(cfg('META_MAX_DAILY_BUDGET_BRL', clienteId)) || TETO_PADRAO_BRL,
    page: pg?.id || '', ig: pg?.ig_id || '', pageNome: pg?.nome || '',
  };
  if (exigirPagina && !ctx.page) throw erro('Não achei a página do Facebook deste cliente: conecte o Facebook em Integrações e escolha a página.');
  return ctx;
}
const exigirConta = (ctx) => { if (!ctx.conta) throw erro('Falta o ID da conta de anúncios deste cliente (Integrações · Meta Ads · ID da conta, no formato act_...).'); return ctx.conta; };

// ---------- Leituras ----------
async function listarContas(ctx) {
  const status = { 1: 'ATIVA', 2: 'DESATIVADA', 3: 'COM PENDÊNCIA DE PAGAMENTO', 7: 'EM ANÁLISE', 9: 'EM PERÍODO DE CARÊNCIA', 100: 'ENCERRAMENTO PENDENTE', 101: 'ENCERRADA' };
  const rows = await lerTodos(ctx, 'me/adaccounts', { fields: 'id,name,account_status,currency,business{name}', limit: '100' });
  return rows.map((a) => ({ id: a.id, nome: a.name, empresa: a.business?.name || null, moeda: a.currency, status: status[a.account_status] || String(a.account_status) }));
}
async function buscarInteresses(ctx, q) {
  const r = await get(ctx, 'search', { type: 'adinterest', q: String(q), limit: '6', locale: 'pt_BR' });
  return (r.data || []).map((x) => ({ id: String(x.id), nome: x.name, tamanho_min: x.audience_size_lower_bound ?? null, tamanho_max: x.audience_size_upper_bound ?? null }));
}
async function listarPublicos(ctx) {
  const rows = await lerTodos(ctx, `${exigirConta(ctx)}/customaudiences`, { fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound', limit: '100' });
  return rows.map((x) => ({ id: String(x.id), nome: x.name, tipo: x.subtype || null, tamanho_min: x.approximate_count_lower_bound ?? null, tamanho_max: x.approximate_count_upper_bound ?? null }));
}
const geoMemo = new Map();
async function buscarLocal(ctx, q, pais = 'BR') {
  const k = `${ctx.conta}|${pais}|${semAcento(q)}`; if (geoMemo.has(k)) return geoMemo.get(k);
  const r = await get(ctx, 'search', { type: 'adgeolocation', q: String(q), location_types: JSON.stringify(['city', 'region']), country_code: pais, limit: '10' });
  const out = (r.data || []).filter((x) => x.type === 'city' || x.type === 'region').map((x) => ({ tipo: x.type, chave: String(x.key), nome: x.name, regiao: x.region || null, pais: x.country_code }));
  if (geoMemo.size > 200) geoMemo.clear(); geoMemo.set(k, out); return out;
}
async function listarCampanhas(ctx) {
  const rows = await lerTodos(ctx, `${exigirConta(ctx)}/campaigns`, { fields: 'id,name,objective,status,effective_status,daily_budget', limit: '100' });
  return rows.map((c) => ({ id: c.id, nome: c.name, objetivo: c.objective, status: c.status, situacao: c.effective_status, orcamento_dia_brl: c.daily_budget ? Number(c.daily_budget) / 100 : null }));
}
async function desempenho(ctx, { nivel = 'campaign', periodo = 'last_7d' } = {}) {
  if (!['campaign', 'adset', 'ad'].includes(nivel)) throw erro('Nível inválido.');
  if (!PRESETS.includes(periodo)) throw erro('Período inválido.');
  const rows = await lerTodos(ctx, `${exigirConta(ctx)}/insights`, {
    level: nivel, date_preset: periodo, limit: '100',
    fields: 'account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,frequency,actions,cost_per_action_type,date_start,date_stop',
  });
  return rows; // spend já vem em unidades da moeda da conta
}

// ---------- Localização exata e público ----------
// Cada item de "localizacoes" é um nome ("Recife", "João Pessoa, Paraíba") resolvido no Meta.
async function resolverGeo(ctx, s) {
  const toks = (s.localizacoes || []).map((t) => String(t).trim()).filter(Boolean);
  if (!toks.length) return null;
  const raioPadrao = Number(s.raio_km) || 17; const locs = [];
  for (const t of toks) {
    const [nome, dica] = t.split(',').map((x) => x.trim());
    const achados = await buscarLocal(ctx, nome, (s.paises?.[0] || 'BR').toUpperCase());
    const alvo = (dica && achados.find((x) => semAcento(x.regiao || '').includes(semAcento(dica)))) || achados[0];
    if (!alvo) throw erro(`Não encontrei a localização "${t}" no Meta. Confira o nome (ex.: "Recife" ou "João Pessoa, Paraíba").`);
    locs.push({ ...alvo, raio: raioPadrao });
  }
  const cities = locs.filter((l) => l.tipo === 'city').map((l) => ({ key: l.chave, radius: l.raio, distance_unit: 'kilometer' }));
  const regions = locs.filter((l) => l.tipo === 'region').map((l) => ({ key: l.chave }));
  return {
    geo: { ...(cities.length ? { cities } : {}), ...(regions.length ? { regions } : {}) },
    resumo: locs.map((l) => (l.tipo === 'city' ? `${l.nome}${l.regiao ? `, ${l.regiao}` : ''} (cidade + ${l.raio} km)` : `${l.nome} (estado)`)),
  };
}

const tokId = (t) => { const m = /^(\d+)(?:\|(.*))?$/.exec(String(t).trim()); return m ? { id: m[1], nome: m[2] || '' } : null; };
async function resolverPublico(ctx, s) {
  const interests = []; const vistos = new Set();
  for (const t of s.interesses || []) {
    const k = tokId(t); let it;
    if (k) it = { id: k.id, name: k.nome || k.id };
    else { const r = await buscarInteresses(ctx, t); if (!r[0]) throw erro(`Não encontrei o interesse "${t}" no Meta. Troque por um termo mais comum.`); it = { id: r[0].id, name: r[0].nome }; }
    if (!vistos.has(it.id)) { vistos.add(it.id); interests.push(it); }
  }
  let todos;
  const pubs = async (lista) => {
    const out = [];
    for (const t of lista || []) {
      const k = tokId(t); if (k) { out.push({ id: k.id, name: k.nome || k.id }); continue; }
      todos ||= await listarPublicos(ctx);
      const x = todos.find((p) => semAcento(p.nome) === semAcento(t)) || todos.find((p) => semAcento(p.nome).includes(semAcento(t)));
      if (!x) throw erro(`Não achei o público personalizado "${t}" nesta conta de anúncios.`);
      out.push({ id: x.id, name: x.nome });
    }
    return out;
  };
  const inc = await pubs(s.publicos_personalizados); const exc = await pubs(s.publicos_excluidos);
  if (inc.some((x) => exc.some((y) => y.id === x.id))) throw erro('Um mesmo público não pode estar incluído e excluído ao mesmo tempo.');
  const resumo = [];
  if (interests.length) resumo.push(`Interesses: ${interests.map((i) => i.name).join(', ')}`);
  if (inc.length) resumo.push(`Públicos personalizados: ${inc.map((i) => i.name).join(', ')}`);
  if (exc.length) resumo.push(`Exclui: ${exc.map((i) => i.name).join(', ')}`);
  return { interests, inc, exc, resumo };
}

// ---------- Rascunho: só entra o que é conhecido e dentro dos limites ----------
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const lista = (v, max, tam = 120) => (Array.isArray(v) ? v : []).map((x) => txt(x, tam)).filter(Boolean).slice(0, max);
const num = (v) => { if (v === null || v === undefined || v === '') return undefined; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
const dataIso = (v) => { const t = txt(v, 40); return t && !Number.isNaN(new Date(t).getTime()) ? t : ''; };

function normalizar(b = {}) {
  const s = {
    nome: txt(b.nome, 120), objetivo: OBJ[b.objetivo] ? b.objetivo : '',
    orcamento_diario_brl: num(b.orcamento_diario_brl), texto_principal: txt(b.texto_principal, 2000),
    titulo: txt(b.titulo, 60), descricao: txt(b.descricao, 60), cta: CTAS.includes(b.cta) ? b.cta : '',
    destino: DESTINOS.includes(b.destino) ? b.destino : '', url_destino: txt(b.url_destino, 500),
    imagem_url: txt(b.imagem_url, 600), imagens_urls: lista(b.imagens_urls, 10, 600),
    localizacoes: lista(b.localizacoes, 25), raio_km: num(b.raio_km), paises: lista(b.paises, 10, 2).map((c) => c.toUpperCase()),
    interesses: lista(b.interesses, 25), publicos_personalizados: lista(b.publicos_personalizados, 20), publicos_excluidos: lista(b.publicos_excluidos, 20),
    idade_min: num(b.idade_min), idade_max: num(b.idade_max), genero: ['todos', 'masculino', 'feminino'].includes(b.genero) ? b.genero : '',
    inicio: dataIso(b.inicio), termina_em: dataIso(b.termina_em), pixel_id: txt(b.pixel_id, 40),
  };
  for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === '' || (Array.isArray(s[k]) && !s[k].length)) delete s[k];
  return s;
}

const destinoDe = (s) => s.destino || (s.objetivo === 'OUTCOME_ENGAGEMENT' ? 'post' : 'site');
const criativoDe = (s) => ((s.imagens_urls || []).length ? 'carrossel' : 'imagem');

// O que falta para poder subir (não precisa falar com o Meta): usado nas pendências do rascunho
function faltando(s, ctx = null) {
  const f = [];
  if (!s.nome) f.push('nome da campanha');
  if (!s.objetivo) f.push('objetivo');
  if (!(s.orcamento_diario_brl > 0)) f.push('orçamento diário');
  if (!s.texto_principal) f.push('texto principal do anúncio');
  if (!(s.imagens_urls || []).length && !s.imagem_url) f.push('imagem do anúncio (envie um arquivo ou cole um link https)');
  if (!(s.localizacoes || []).length && !(s.paises || []).length) f.push('localização do público (cidades ou estados)');
  if (s.objetivo && destinoDe(s) === 'site' && !s.url_destino) f.push('link de destino');
  if (ctx && ctx.teto && s.orcamento_diario_brl > ctx.teto) f.push(`orçamento dentro do teto de R$ ${ctx.teto}`);
  return f;
}

// Validação completa antes de qualquer escrita. Devolve o texto do problema ou '' se estiver tudo certo.
function validar(s, ctx) {
  const o = OBJ[s.objetivo];
  if (!txt(s.nome, 5)) return 'Informe o nome da campanha.';
  if (!o) return `Escolha o objetivo: ${Object.values(OBJ).map((x) => x.rotulo).join(', ')}.`;
  if (!(Number(s.orcamento_diario_brl) > 0)) return 'Informe o orçamento diário em reais.';
  if (Number(s.orcamento_diario_brl) > ctx.teto) return `O orçamento diário de R$ ${s.orcamento_diario_brl} passa do teto de R$ ${ctx.teto} por campanha. Para subir o teto, ajuste "Meta Ads · Teto de orçamento diário" em Integrações.`;
  if (!txt(s.texto_principal, 2)) return 'Informe o texto principal do anúncio.';
  const tipo = criativoDe(s);
  if (tipo === 'carrossel') {
    if (s.imagens_urls.length < 2 || s.imagens_urls.length > 10) return 'O carrossel precisa de 2 a 10 imagens.';
    if (!s.imagens_urls.every(imagemOk)) return 'Todas as imagens do carrossel precisam ser imagens enviadas ou links https públicos (JPG/PNG).';
  } else if (!imagemOk(s.imagem_url)) return 'A imagem do anúncio precisa ser uma imagem enviada ou um link https público (JPG/PNG).';
  const dest = destinoDe(s);
  if (!DESTINOS.includes(dest)) return `Destino inválido. Use: ${DESTINOS.join(', ')}.`;
  const whats = dest === 'whatsapp', msg = !!MSG[dest], site = dest === 'site';
  if (whats && s.objetivo !== 'OUTCOME_LEADS') return 'Destino WhatsApp só funciona com o objetivo Leads.';
  if (msg && !OBJ_MSG.includes(s.objetivo)) return 'Mensagens no Instagram/Facebook funcionam com os objetivos Engajamento, Leads ou Vendas.';
  if (dest === 'post' && s.objetivo !== 'OUTCOME_ENGAGEMENT') return 'Engajamento no anúncio (curtidas e comentários) usa o objetivo Engajamento.';
  if (s.objetivo === 'OUTCOME_ENGAGEMENT' && !(msg || dest === 'post')) return 'O objetivo Engajamento usa o destino post, messenger, instagram_direct ou instagram_facebook.';
  if (site && !httpsUrl(s.url_destino)) return 'Informe o link de destino (https://) do anúncio.';
  if (site && o.evento && !(s.pixel_id || ctx.pixel)) return `O objetivo ${o.rotulo} para site precisa do pixel do Meta (configure em Integrações). Sem pixel, use Tráfego ou o destino WhatsApp.`;
  const imin = s.idade_min ?? 18, imax = s.idade_max ?? 65;
  if (imin < 13 || imax > 65 || imin > imax) return 'Faixa de idade inválida (13 a 65, mínima menor que a máxima).';
  if ((s.paises || []).some((c) => !/^[A-Za-z]{2}$/.test(c))) return 'Países devem ser códigos de 2 letras (ex.: BR).';
  if (s.raio_km !== undefined && !(s.raio_km >= 17 && s.raio_km <= 80)) return 'O raio das cidades vai de 17 a 80 km.';
  if (s.inicio && s.termina_em && new Date(s.termina_em) <= new Date(s.inicio)) return 'O término precisa ser depois do início.';
  if (s.termina_em && new Date(s.termina_em).getTime() < Date.now()) return 'A data de término já passou.';
  if (!ctx.conta) return 'Falta o ID da conta de anúncios deste cliente (Integrações · Meta Ads).';
  if (!ctx.page) return 'Não achei a página do Facebook deste cliente: conecte o Facebook em Integrações e escolha a página.';
  if (['instagram_direct', 'instagram_facebook'].includes(dest) && !ctx.ig) return 'Para anunciar mensagens no Instagram Direct a página precisa ter o Instagram profissional vinculado.';
  return '';
}

// Conferência sem escrever nada no Meta: valida, resolve local e público e confirma a página
async function conferir(ctx, s) {
  const e = validar(s, ctx); if (e) throw erro(e);
  const avisos = [];
  const g = await resolverGeo(ctx, s);
  avisos.push(g ? `Local: ${g.resumo.join('; ')}` : `Local: país inteiro (${(s.paises?.length ? s.paises : ['BR']).join(',')}), nenhuma cidade ou estado escolhido`);
  const pg = await get(ctx, ctx.page, { fields: 'name' });
  avisos.push(`Página: ${pg.name || ctx.page}`, ctx.ig ? 'Instagram vinculado' : 'sem Instagram vinculado (só Facebook)', `Conta de anúncios: ${ctx.conta}`);
  const pub = await resolverPublico(ctx, s); if (pub.resumo.length) avisos.push(...pub.resumo);
  const imgsConf = criativoDe(s) === 'carrossel' ? s.imagens_urls : [s.imagem_url];
  for (const u of imgsConf.filter(ehMidia)) if (!ctx.carregarMidia || !(await ctx.carregarMidia(u.slice(6)))) throw erro('Uma das imagens enviadas não existe mais. Envie a imagem de novo no rascunho.');
  if (imgsConf.some(ehMidia)) avisos.push(`Imagens enviadas por você: ${imgsConf.filter(ehMidia).length} (sobem direto para o Meta)`);
  const dest = destinoDe(s);
  if (MSG[dest]) avisos.push(`Mensagens: a página${dest !== 'messenger' ? ' e o Instagram' : ''} precisam aceitar conversas (fluxo ainda não validado em conta real)`);
  if (dest === 'whatsapp') avisos.push('WhatsApp: exige o número do WhatsApp Business conectado à página (fluxo ainda não validado em conta real)');
  if (criativoDe(s) === 'carrossel') avisos.push('Carrossel (ainda não validado em conta real)');
  return { avisos, resumo: resumoDe(s) };
}

function resumoDe(s) {
  const local = s.localizacoes?.length ? s.localizacoes.join('; ') : (s.paises?.length ? s.paises : ['BR']).join(',');
  return `"${s.nome}" · ${OBJ[s.objetivo]?.rotulo || s.objetivo} · R$ ${s.orcamento_diario_brl}/dia · ${DESTINO_ROTULO[destinoDe(s)] || 'site'} · criativo ${criativoDe(s) === 'carrossel' ? `carrossel de ${s.imagens_urls.length} imagens` : 'imagem'} · público ${local}, ${s.idade_min ?? 18}–${s.idade_max ?? 65}${s.genero && s.genero !== 'todos' ? ' ' + s.genero : ''}`;
}

// ---------- Criação completa: criativo -> campanha -> conjunto -> anúncio, tudo PAUSADO ----------
async function subirCampanha(ctx, s) {
  const e0 = validar(s, ctx); if (e0) throw erro(e0);
  const conta = ctx.conta; const o = OBJ[s.objetivo]; const page = ctx.page; const ig = ctx.ig;
  const dest = destinoDe(s); const whats = dest === 'whatsapp'; const msg = MSG[dest]; const tipo = criativoDe(s);
  const criado = {};
  const etapa = async (nome, fn) => {
    try { return await fn(); }
    catch (e) {
      const feito = Object.entries(criado).filter(([k]) => k !== 'criativo');
      const err = erro(`Falhou na etapa "${nome}": ${e.message}.${feito.length ? ` Já criado (PAUSADO): ${feito.map(([k, v]) => `${k} ${v}`).join(', ')}. Nada foi ativado.` : ' Nada foi criado nesta campanha; pode tentar de novo.'}`, e.status || 502);
      // mesmas chaves que a tela e o banco usam, para mostrar o que ficou pausado no Meta
      err.criado = Object.fromEntries(Object.entries({ campanha_id: criado.campanha, conjunto_id: criado.conjunto, criativo_id: criado.criativo, anuncio_id: criado.anuncio }).filter(([, v]) => v));
      throw err;
    }
  };
  // 1) Local e público: falha cedo, antes de criar qualquer coisa
  const geoLoc = await etapa('localização do público', () => resolverGeo(ctx, s));
  const pub = await etapa('segmentação por interesses e públicos', () => resolverPublico(ctx, s));
  // 2) Criativo ANTES da campanha: se o Meta recusar, nada fica pela metade na conta
  const imgsOrig = tipo === 'carrossel' ? s.imagens_urls : [s.imagem_url];
  // imagens enviadas pelo assinante sobem para a biblioteca da conta (adimages) e viram image_hash
  const imgs = [];
  for (const u of imgsOrig) {
    if (!ehMidia(u)) { imgs.push({ picture: u }); continue; }
    imgs.push(await etapa('envio da imagem', async () => {
      const m = ctx.carregarMidia ? await ctx.carregarMidia(u.slice(6)) : null;
      if (!m) throw new Error('uma imagem enviada não foi encontrada; envie de novo no rascunho');
      const r = await post(ctx, `${conta}/adimages`, { bytes: m.dados.toString('base64'), name: m.nome || 'imagem' });
      const h = Object.values(r.images || {})[0]?.hash;
      if (!h) throw new Error('o Meta não devolveu o código da imagem');
      return { image_hash: h };
    }));
  }
  const linkPag = `https://www.facebook.com/${page}`;
  const link = whats ? 'https://api.whatsapp.com/send' : msg ? MSG_LINK : dest === 'post' ? linkPag : s.url_destino;
  const cta = whats ? { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } }
    : msg ? { type: msg.cta, value: { app_destination: msg.app } }
      : { type: dest === 'post' ? 'LEARN_MORE' : (s.cta || 'LEARN_MORE'), value: { link } };
  let spec;
  if (tipo === 'imagem' && dest === 'post') spec = { page_id: page, photo_data: { caption: s.texto_principal, ...(imgs[0].image_hash ? { image_hash: imgs[0].image_hash } : { url: imgs[0].picture }) } };
  else if (tipo === 'carrossel') spec = { page_id: page, link_data: { message: s.texto_principal, link, child_attachments: imgs.map((im) => ({ link, ...im, ...(s.titulo ? { name: s.titulo } : {}), ...(s.descricao ? { description: s.descricao } : {}) })), multi_share_optimized: true, call_to_action: cta } };
  else { const ld = { message: s.texto_principal, link, ...imgs[0], call_to_action: cta }; if (s.titulo) ld.name = s.titulo; if (s.descricao) ld.description = s.descricao; spec = { page_id: page, link_data: ld }; }
  const criar = (sp) => post(ctx, `${conta}/adcreatives`, { name: `${s.nome} | Criativo`, object_story_spec: JSON.stringify(sp) });
  let igUsado = !!ig;
  const cri = await etapa('criativo', async () => {
    if (!ig) return criar(spec);
    try { return await criar({ ...spec, instagram_user_id: ig }); }
    catch (e1) {
      if (MSG[dest] && dest !== 'messenger') throw e1; // mensagens no Instagram exigem a conta vinculada
      igUsado = false; // sem o Instagram liberado para esta conta de anúncios, roda com a identidade da página
      try { return await criar(spec); } catch (e2) { throw new Error(`${e2.message} (com o Instagram vinculado deu: ${e1.message})`); }
    }
  });
  criado.criativo = cri.id;
  // 3) Campanha -> conjunto -> anúncio
  const camp = await etapa('campanha', () => post(ctx, `${conta}/campaigns`, { name: s.nome, objective: s.objetivo, status: 'PAUSED', special_ad_categories: '[]', daily_budget: centavos(s.orcamento_diario_brl), bid_strategy: 'LOWEST_COST_WITHOUT_CAP' }));
  criado.campanha = camp.id;
  const targeting = { geo_locations: geoLoc ? geoLoc.geo : { countries: (s.paises?.length ? s.paises : ['BR']).map((c) => c.toUpperCase()) }, age_min: s.idade_min ?? 18, age_max: s.idade_max ?? 65, targeting_automation: { advantage_audience: 0 } };
  if (s.genero && s.genero !== 'todos') targeting.genders = [s.genero === 'masculino' ? 1 : 2];
  if (pub.interests.length) targeting.flexible_spec = [{ interests: pub.interests }];
  if (pub.inc.length) targeting.custom_audiences = pub.inc.map(({ id }) => ({ id }));
  if (pub.exc.length) targeting.excluded_custom_audiences = pub.exc.map(({ id }) => ({ id }));
  const conj = { name: `${s.nome} | Conjunto`, campaign_id: camp.id, status: 'PAUSED', billing_event: 'IMPRESSIONS', targeting: JSON.stringify(targeting), optimization_goal: whats || msg ? 'CONVERSATIONS' : o.goal };
  if (whats) { conj.destination_type = 'WHATSAPP'; conj.promoted_object = JSON.stringify({ page_id: page }); }
  else if (msg) { conj.destination_type = msg.destination_type; conj.promoted_object = JSON.stringify({ page_id: page }); }
  else if (dest === 'post') conj.destination_type = 'ON_POST';
  else if (o.evento) conj.promoted_object = JSON.stringify({ pixel_id: s.pixel_id || ctx.pixel, custom_event_type: o.evento });
  if (s.inicio) conj.start_time = new Date(s.inicio).toISOString();
  if (s.termina_em) conj.end_time = new Date(s.termina_em).toISOString();
  const set = await etapa('conjunto de anúncios', () => post(ctx, `${conta}/adsets`, conj));
  criado.conjunto = set.id;
  const ad = await etapa('anúncio', () => post(ctx, `${conta}/ads`, { name: `${s.nome} | Anúncio 1`, adset_id: set.id, creative: JSON.stringify({ creative_id: cri.id }), status: 'PAUSED' }));
  criado.anuncio = ad.id;
  return { campanha_id: camp.id, conjunto_id: set.id, criativo_id: cri.id, anuncio_id: ad.id, instagram_vinculado: igUsado, tipo_criativo: tipo };
}

// ---------- Ativar e pausar (nunca exclui) ----------
async function ativarEstrutura(ctx, id) {
  const c = await get(ctx, id, { fields: 'name,status' });
  const sets = await get(ctx, `${id}/adsets`, { fields: 'id,status', limit: '50' }); const ads = await get(ctx, `${id}/ads`, { fields: 'id,status', limit: '100' });
  if (!(ads.data || []).length) throw erro(`A campanha "${c.name}" não tem nenhum anúncio (o criativo falhou?). Ativar só gastaria sem entregar nada.`);
  const ativados = { conjuntos: [], anuncios: [] };
  await post(ctx, id, { status: 'ACTIVE' });
  for (const x of (sets.data || []).filter((x) => x.status === 'PAUSED')) { await post(ctx, x.id, { status: 'ACTIVE' }); ativados.conjuntos.push(x.id); }
  for (const x of (ads.data || []).filter((x) => x.status === 'PAUSED')) { await post(ctx, x.id, { status: 'ACTIVE' }); ativados.anuncios.push(x.id); }
  return { campanha_id: id, ...ativados };
}
const pausar = (ctx, id) => post(ctx, id, { status: 'PAUSED' });

// ---------- Rascunho gerado a partir do plano da Camila ----------
const SISTEMA_RASCUNHO = `Você transforma o plano de uma campanha de anúncios no Meta (Facebook e Instagram) em um RASCUNHO técnico para uma pessoa revisar antes de subir. Escreva em português do Brasil.
Regras:
1. Use SOMENTE o que está no pedido, no briefing e no plano. Nunca invente orçamento, links, cidades, preços, ofertas, datas ou promessas. Campo desconhecido fica null e vai para "pendencias".
2. "orcamento_diario_brl": número em reais POR DIA, só se o plano informar. Se houver só verba total e período, NÃO calcule: deixe null e explique em "pendencias".
3. "texto_principal": a variação 1 de copy do plano, pronta para ir ao ar, sem acrescentar fatos. "titulo" até 40 caracteres e "descricao" até 30, só se o plano trouxer.
4. "localizacoes": cidades ou estados EXATOS citados no plano, como "Recife" ou "João Pessoa, Paraíba". Sem localização citada, null.
5. "interesses": nomes de interesses do Meta ligados ao perfil do público descrito (ex.: "Estética facial"). Só o que decorre do plano.
6. "objetivo" um entre OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_ENGAGEMENT. "destino" um entre site, whatsapp, post, messenger, instagram_direct, instagram_facebook. "cta" um entre ${CTAS.join(', ')}. "genero" um entre todos, masculino, feminino.
7. Em "pendencias" liste tudo o que falta ou precisa de confirmação (imagem, link, pixel, orçamento, local) e avise que as variações 2 e 3 de copy continuam no plano.
Responda APENAS um objeto JSON com as chaves "campanha" (nome, objetivo, orcamento_diario_brl, texto_principal, titulo, descricao, cta, destino, url_destino, localizacoes, raio_km, interesses, publicos_personalizados, publicos_excluidos, idade_min, idade_max, genero, inicio, termina_em) e "pendencias" (lista de textos curtos).`;

async function gerarRascunho(pool, tarefaId, usuario) {
  const { chamarTexto } = require('./projetos');
  const { extrairJson } = require('./comandos');
  const { rows: [t] } = await pool.query(
    `SELECT t.*, c.nome AS cliente_nome FROM tasks t JOIN clients c ON c.id=t.client_id WHERE t.id=$1`, [tarefaId]);
  if (!t) throw erro('Tarefa não encontrada', 404);
  if (t.tipo !== 'trafego') throw erro('Só tarefas de tráfego têm campanha.');
  const saida = await chamarTexto({
    system: SISTEMA_RASCUNHO,
    user: `CLIENTE: ${t.cliente_nome}\nHOJE: ${new Date().toISOString().slice(0, 10)}\nTEMA: ${t.tema || ''}\n\nPEDIDO, BRIEFING E PLANO DA CAMILA:\n${txt(t.briefing, 9000)}`,
    maxTokens: 3000, timeoutMs: 90000,
  });
  const j = extrairJson(saida);
  if (!j || typeof j.campanha !== 'object') throw erro('Não consegui montar o rascunho da campanha. Tente de novo.', 502);
  const spec = normalizar(j.campanha);
  if (!spec.imagem_url && !spec.imagens_urls && /^https:\/\//i.test(t.publicar_imagem || '')) spec.imagem_url = t.publicar_imagem;
  const pend = [...lista(j.pendencias, 12, 300)];
  const falta = faltando(spec);
  if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
  const { rows: [ex] } = await pool.query(`SELECT id, status FROM campanhas WHERE task_id=$1 ORDER BY id DESC LIMIT 1`, [t.id]);
  if (ex && !['rascunho', 'erro'].includes(ex.status)) throw erro('Esta tarefa já tem uma campanha criada no Meta.', 409);
  if (ex) {
    const { rows: [c] } = await pool.query(`UPDATE campanhas SET spec=$1, pendencias=$2, status='rascunho', erro=NULL, updated_at=now() WHERE id=$3 RETURNING *`, [spec, JSON.stringify(pend), ex.id]);
    return c;
  }
  const { rows: [c] } = await pool.query(
    `INSERT INTO campanhas (task_id, client_id, spec, pendencias, status, criado_por) VALUES ($1,$2,$3,$4,'rascunho',$5) RETURNING *`,
    [t.id, t.client_id, spec, JSON.stringify(pend), usuario || null]);
  return c;
}

// Imagem anexada à tarefa DEPOIS do rascunho (por link, Drive ou upload): entra sozinha na campanha ainda não criada
async function sincronizarAnexos(pool, c) {
  if (!c || !['rascunho', 'erro'].includes(c.status) || !c.task_id) return c;
  const spec = c.spec || {};
  if (spec.imagem_url || (spec.imagens_urls && spec.imagens_urls.length)) return c;
  const { rows: [t] } = await pool.query('SELECT publicar_imagem FROM tasks WHERE id=$1', [c.task_id]);
  if (!t || !/^https:\/\//i.test(t.publicar_imagem || '')) return c;
  spec.imagem_url = t.publicar_imagem;
  const pend = (c.pendencias || []).filter((p) => !/imagem|arte|criativo/i.test(p)).filter((p) => !/^Falta preencher/.test(p));
  const falta = faltando(spec);
  if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
  const { rows: [n] } = await pool.query(
    `UPDATE campanhas SET spec=$1, pendencias=$2, updated_at=now() WHERE id=$3 AND status IN ('rascunho','erro') RETURNING *`,
    [spec, JSON.stringify(pend), c.id]);
  return n || c;
}

// Usado pela esteira logo depois do plano da Camila: cria o rascunho se ainda não existir. Nunca derruba a esteira.
async function rascunhoAutomatico(pool, tarefaId) {
  try {
    const { rows: [ex] } = await pool.query('SELECT 1 FROM campanhas WHERE task_id=$1 LIMIT 1', [tarefaId]);
    if (ex) return null;
    return await gerarRascunho(pool, tarefaId, 'Camila');
  } catch (e) { console.error('Rascunho de campanha falhou:', e.message); return null; }
}

// ---------- Rotas ----------
function registrar(app, { pool, wrap, soAdmin }) {
  const idDe = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw erro('Identificador inválido'); return n; };
  const clienteDe = (req) => { const n = Number(req.query.client_id); if (!Number.isInteger(n) || n <= 0) throw erro('Escolha o cliente'); return n; };
  const carregar = async (id) => { const { rows: [c] } = await pool.query('SELECT * FROM campanhas WHERE id=$1', [id]); if (!c) throw erro('Campanha não encontrada', 404); return sincronizarAnexos(pool, c); };
  const quem = (req) => req.user.nome || req.user.email;

  // Passos que travam (servidor reiniciado no meio) voltam a um estado seguro depois de 10 minutos
  const destravar = () => pool.query(
    `UPDATE campanhas SET status = CASE status WHEN 'criando' THEN 'erro' ELSE 'criada_pausada' END,
       erro = 'A operação foi interrompida. Confira no Gerenciador de Anúncios do Meta antes de tentar de novo.', updated_at=now()
     WHERE status IN ('criando','ativando') AND updated_at < now() - interval '10 minutes'`);

  app.get('/api/tasks/:id/campanha', wrap(async (req, res) => {
    await destravar();
    let { rows: [c] } = await pool.query('SELECT * FROM campanhas WHERE task_id=$1 ORDER BY id DESC LIMIT 1', [idDe(req)]);
    c = await sincronizarAnexos(pool, c);
    const { rows: [t] } = await pool.query('SELECT client_id FROM tasks WHERE id=$1', [req.params.id]);
    if (!t) throw erro('Tarefa não encontrada', 404);
    let ctx = null; try { ctx = await contexto(pool, t.client_id); } catch { /* sem configuração: a tela mostra o aviso */ }
    const base = ctx || { token: '', conta: cfg('META_AD_ACCOUNT_ID', t.client_id), teto: Number(cfg('META_MAX_DAILY_BUDGET_BRL', t.client_id)) || TETO_PADRAO_BRL, page: '', ig: '', pixel: '' };
    res.json({
      campanha: c || null,
      config: { token: !!cfg('META_ADS_TOKEN', t.client_id), conta: !!base.conta, pagina: !!base.page, pagina_nome: base.pageNome || null, instagram: !!base.ig, pixel: !!base.pixel, teto_brl: base.teto },
      admin: req.user.papel === 'admin',
    });
  }));

  app.post('/api/tasks/:id/campanha/gerar', wrap(async (req, res) => {
    res.json({ campanha: await gerarRascunho(pool, idDe(req), quem(req)) });
  }));

  app.put('/api/campanhas/:id', wrap(async (req, res) => {
    const c = await carregar(idDe(req));
    if (!['rascunho', 'erro'].includes(c.status)) throw erro('Esta campanha já foi criada no Meta e não pode mais ser editada aqui.', 409);
    const spec = normalizar(req.body?.spec || {});
    let teto = TETO_PADRAO_BRL; try { teto = (await contexto(pool, c.client_id)).teto; } catch { /* usa o padrão */ }
    const falta = faltando(spec, { teto });
    const pend = (c.pendencias || []).filter((p) => !/^Falta preencher/.test(p));
    if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
    const { rows: [n] } = await pool.query(
      `UPDATE campanhas SET spec=$1, pendencias=$2, status='rascunho', erro=NULL, updated_at=now() WHERE id=$3 AND status IN ('rascunho','erro') RETURNING *`,
      [spec, JSON.stringify(pend), c.id]);
    if (!n) throw erro('Esta campanha já foi criada no Meta e não pode mais ser editada aqui.', 409);
    res.json({ campanha: n });
  }));

  // Só leituras no Meta: confere o rascunho e mostra o que vai ser criado
  app.post('/api/campanhas/:id/conferir', wrap(async (req, res) => {
    const c = await carregar(idDe(req));
    const ctx = await contexto(pool, c.client_id, { exigirPagina: true });
    try { res.json({ ok: true, ...(await conferir(ctx, c.spec)) }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
  }));

  // Cria tudo PAUSADO. Só administrador; o clique é a aprovação (corpo precisa trazer confirmado: true)
  app.post('/api/campanhas/:id/subir', soAdmin, wrap(async (req, res) => {
    if (req.body?.confirmado !== true) throw erro('Confirme a criação da campanha.');
    const c0 = await carregar(idDe(req));
    const ctx = await contexto(pool, c0.client_id, { exigirPagina: true });
    const prob = validar(c0.spec, ctx); if (prob) throw erro(prob);
    // Reserva a campanha: um segundo clique ou outra aba não cria de novo
    const { rows: [c] } = await pool.query(
      `UPDATE campanhas SET status='criando', erro=NULL, criado_por=$2, updated_at=now() WHERE id=$1 AND status IN ('rascunho','erro') RETURNING *`, [c0.id, quem(req)]);
    if (!c) throw erro('Esta campanha já está sendo criada ou já foi criada.', 409);
    try {
      const ids = await subirCampanha(ctx, c.spec);
      // Uma tentativa anterior que falhou no meio deixa campanha PAUSADA no Meta: guarda o rastro para a pessoa limpar
      const sobra = [...(c0.ids?.restos_pausados || []), ...(c0.ids?.campanha_id ? [c0.ids.campanha_id] : [])];
      if (sobra.length) ids.restos_pausados = sobra;
      const { rows: [n] } = await pool.query(
        `UPDATE campanhas SET status='criada_pausada', ids=$2, criada_em=now(), updated_at=now() WHERE id=$1 RETURNING *`, [c.id, ids]);
      if (c.task_id) await pool.query(
        `UPDATE tasks SET status='agendado', esteira='aprovada', esteira_msg='Campanha criada PAUSADA no Meta: falta ativar', esteira_em=now(), aprovado_por=$2, aprovado_em=now(), updated_at=now()
         WHERE id=$1 AND esteira IN ('aguardando_aprovacao','aprovada')`, [c.task_id, quem(req)]);
      res.json({ campanha: n });
    } catch (e) {
      console.error('Falha ao subir campanha', c.id, e.message);
      const { rows: [n] } = await pool.query(`UPDATE campanhas SET status='erro', erro=$2, ids=$3, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, e.message, e.criado || {}]);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ erro: e.message, campanha: n });
    }
  }));

  // Ativa (começa a gastar). Só administrador, com confirmação e limite de ativações por dia
  app.post('/api/campanhas/:id/ativar', soAdmin, wrap(async (req, res) => {
    if (req.body?.confirmado !== true) throw erro('Confirme a ativação da campanha.');
    const c0 = await carregar(idDe(req));
    if (c0.status !== 'criada_pausada') throw erro('Só dá para ativar uma campanha criada e pausada.', 409);
    const { rows: [{ n }] } = await pool.query(
      `SELECT count(*)::int AS n FROM campanhas WHERE status IN ('ativada','ativando') AND ativada_em >= date_trunc('day', now() AT TIME ZONE 'America/Recife') AT TIME ZONE 'America/Recife'`);
    if (n >= ATIVACOES_POR_DIA) throw erro(`Limite de ${ATIVACOES_POR_DIA} ativações por dia atingido. Tente amanhã ou ative pelo Gerenciador de Anúncios.`, 429);
    const ctx = await contexto(pool, c0.client_id);
    const { rows: [c] } = await pool.query(
      `UPDATE campanhas SET status='ativando', ativada_por=$2, ativada_em=now(), erro=NULL, updated_at=now() WHERE id=$1 AND status='criada_pausada' RETURNING *`, [c0.id, quem(req)]);
    if (!c) throw erro('Esta campanha já está sendo ativada.', 409);
    try {
      const r = await ativarEstrutura(ctx, c.ids.campanha_id);
      const { rows: [n2] } = await pool.query(`UPDATE campanhas SET status='ativada', ids=ids || $2::jsonb, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, { ativados: { conjuntos: r.conjuntos, anuncios: r.anuncios } }]);
      if (c.task_id) await pool.query(`UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg='Campanha ativada no Meta', esteira_em=now(), updated_at=now() WHERE id=$1 AND esteira IN ('aguardando_aprovacao','aprovada')`, [c.task_id]);
      res.json({ campanha: n2 });
    } catch (e) {
      console.error('Falha ao ativar campanha', c.id, e.message);
      const { rows: [n2] } = await pool.query(`UPDATE campanhas SET status='criada_pausada', erro=$2, ativada_em=NULL, ativada_por=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, `Falha ao ativar: ${e.message}. Confira o estado no Gerenciador de Anúncios.`]);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ erro: e.message, campanha: n2 });
    }
  }));

  // Volta a campanha ativada para pausada
  app.post('/api/campanhas/:id/pausar', soAdmin, wrap(async (req, res) => {
    const c0 = await carregar(idDe(req));
    if (c0.status !== 'ativada') throw erro('Só dá para pausar uma campanha ativada.', 409);
    const ctx = await contexto(pool, c0.client_id);
    await pausar(ctx, c0.ids.campanha_id);
    const { rows: [n] } = await pool.query(`UPDATE campanhas SET status='criada_pausada', erro=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [c0.id]);
    res.json({ campanha: n });
  }));

  // Leituras auxiliares para a tela (sempre de um cliente)
  const leitura = (fn) => wrap(async (req, res) => { const ctx = await contexto(pool, clienteDe(req)); res.json(await fn(ctx, req)); });
  app.get('/api/meta/contas', leitura((ctx) => listarContas(ctx)));
  app.get('/api/meta/campanhas', leitura((ctx) => listarCampanhas(ctx)));
  app.get('/api/meta/publicos', leitura((ctx) => listarPublicos(ctx)));
  app.get('/api/meta/desempenho', leitura((ctx, req) => desempenho(ctx, { nivel: req.query.nivel || 'campaign', periodo: req.query.periodo || 'last_7d' })));
  app.get('/api/meta/interesses', leitura((ctx, req) => { if (!txt(req.query.q, 80)) throw erro('Digite o interesse'); return buscarInteresses(ctx, txt(req.query.q, 80)); }));
  app.get('/api/meta/localizacoes', leitura((ctx, req) => { if (!txt(req.query.q, 80)) throw erro('Digite a cidade ou o estado'); return buscarLocal(ctx, txt(req.query.q, 80), String(req.query.pais || 'BR').toUpperCase().slice(0, 2)); }));
}

module.exports = { sincronizarAnexos,
  registrar, rascunhoAutomatico, gerarRascunho,
  // exportados para teste
  normalizar, validar, faltando, conferir, subirCampanha, ativarEstrutura, pausar, resolverGeo, resolverPublico, contexto, OBJ, ATIVACOES_POR_DIA,
  // usados pelo módulo SaaS (assinantes), sempre com o contexto (token/conta) do próprio assinante
  listarContas, listarCampanhas, listarPublicos, desempenho, buscarInteresses, buscarLocal, SISTEMA_RASCUNHO, TETO_PADRAO_BRL, get, erro,
};
