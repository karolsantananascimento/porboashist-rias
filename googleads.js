// Google Ads para os assinantes do SaaS (portado do Agente de Tráfego / gestoragente).
// Tudo roda com as credenciais do PRÓPRIO assinante (ctx), nunca com as do administrador.
// Travas: campanhas novas nascem PAUSADAS, orçamento diário limitado por um teto, nada é excluído.

const crypto = require('crypto');

const VERSAO = process.env.GOOGLE_ADS_API_VERSION || 'v21';
const TETO_PADRAO_BRL = 100;
const PERIODOS = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const brl = (micros) => Number(micros || 0) / 1_000_000;
const micros = (v) => Math.round(Number(v) * 1_000_000);
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// Monta o contexto a partir das chaves do assinante (função cfg já restrita ao escopo dele)
function contexto(le) {
  const falta = [];
  const c = {
    devToken: le('GOOGLE_ADS_DEVELOPER_TOKEN'), clientId: le('GOOGLE_ADS_CLIENT_ID'), clientSecret: le('GOOGLE_ADS_CLIENT_SECRET'),
    refresh: le('GOOGLE_ADS_REFRESH_TOKEN'), customer: soDigitos(le('GOOGLE_ADS_CUSTOMER_ID')), login: soDigitos(le('GOOGLE_ADS_LOGIN_CUSTOMER_ID')),
    teto: Number(le('GOOGLE_ADS_MAX_DAILY_BUDGET_BRL')) || TETO_PADRAO_BRL,
  };
  if (!c.devToken) falta.push('Developer token');
  if (!c.clientId) falta.push('Client ID');
  if (!c.clientSecret) falta.push('Client secret');
  if (!c.refresh) falta.push('Refresh token');
  if (!c.customer) falta.push('ID da conta de anúncios');
  if (falta.length) throw erro(`O Google Ads ainda não está configurado. Faltam: ${falta.join(', ')}. Preencha em Chaves de API.`);
  if (c.customer.length !== 10) throw erro('O ID da conta do Google Ads tem 10 dígitos (ex.: 123-456-7890).');
  return c;
}

const tokens = new Map(); // sha256(client|refresh) -> { valor, exp }
async function accessToken(ctx) {
  const k = crypto.createHash('sha256').update(`${ctx.clientId}|${ctx.refresh}`).digest('hex');
  const t = tokens.get(k);
  if (t && Date.now() < t.exp) return t.valor;
  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: ctx.clientId, client_secret: ctx.clientSecret, refresh_token: ctx.refresh, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw erro('Não consegui falar com o Google agora. Tente de novo.', 504); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw erro(`O Google recusou as credenciais (${d.error_description || d.error || 'HTTP ' + r.status}). Confira Client ID, Client secret e Refresh token.`, 502);
  }
  if (tokens.size > 500) tokens.clear();
  tokens.set(k, { valor: d.access_token, exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 60) * 1000 });
  return d.access_token;
}

async function chamar(ctx, caminho, corpo, { customer = ctx.customer } = {}) {
  const token = await accessToken(ctx);
  const headers = { authorization: `Bearer ${token}`, 'developer-token': ctx.devToken, 'content-type': 'application/json' };
  if (ctx.login) headers['login-customer-id'] = ctx.login;
  let r;
  try {
    r = await fetch(`https://googleads.googleapis.com/${VERSAO}/customers/${customer}/${caminho}`, {
      method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(30000) });
  } catch (e) { throw erro(e.name === 'TimeoutError' ? 'O Google Ads demorou demais. Tente de novo.' : 'Não consegui falar com o Google Ads agora.', 504); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = d.error || {};
    const det = (e.details || []).flatMap((x) => (x.errors || []).map((y) => y.message)).filter(Boolean).slice(0, 2).join(' · ');
    throw erro(`${e.message || 'O Google Ads recusou o pedido'}${det ? ` — ${det}` : ''} (HTTP ${r.status})`, 502);
  }
  return d;
}

const gaql = async (ctx, query) => (await chamar(ctx, 'googleAds:search', { query })).results || [];

// ---------- Teste de conexão (só leitura) ----------
async function testar(ctx) {
  const r = await gaql(ctx, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1');
  const c = r[0]?.customer || {};
  return { conta: c.descriptiveName || ctx.customer, id: String(c.id || ctx.customer), moeda: c.currencyCode || null, status: c.status || null };
}

// ---------- Leituras ----------
async function listarCampanhas(ctx, periodo = 'LAST_7_DAYS') {
  if (!PERIODOS.includes(periodo)) throw erro('Período inválido.');
  const rows = await gaql(ctx,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.bidding_strategy_type,
            campaign_budget.amount_micros, metrics.cost_micros, metrics.clicks, metrics.impressions,
            metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion
     FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING ${periodo}`);
  return rows.map((r) => ({
    id: String(r.campaign.id), nome: r.campaign.name, status: r.campaign.status, situacao: r.campaign.primaryStatus,
    estrategia_lance: r.campaign.biddingStrategyType, orcamento_dia_brl: brl(r.campaignBudget?.amountMicros),
    gasto_brl: brl(r.metrics?.costMicros), cliques: Number(r.metrics?.clicks || 0), impressoes: Number(r.metrics?.impressions || 0),
    cpc_medio_brl: brl(r.metrics?.averageCpc), conversoes: Number(r.metrics?.conversions || 0), custo_por_conversao_brl: brl(r.metrics?.costPerConversion),
  }));
}

const idCampanha = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw erro('Identificador de campanha inválido.'); return n; };
const campRn = (ctx, id) => `customers/${ctx.customer}/campaigns/${idCampanha(id)}`;

async function orcamentoAtual(ctx, campanhaId) {
  const rows = await gaql(ctx, `SELECT campaign.id, campaign_budget.amount_micros, campaign_budget.resource_name FROM campaign WHERE campaign.id = ${idCampanha(campanhaId)}`);
  if (!rows[0]) throw erro('Campanha não encontrada nesta conta.', 404);
  return { resourceName: rows[0].campaignBudget.resourceName, valor: brl(rows[0].campaignBudget.amountMicros) };
}

// ---------- Escritas (sempre com confirmação na rota) ----------
async function mudarStatus(ctx, campanhaId, status) {
  if (!['PAUSED', 'ENABLED'].includes(status)) throw erro('Status inválido.');
  await chamar(ctx, 'campaigns:mutate', { operations: [{ update: { resourceName: campRn(ctx, campanhaId), status }, updateMask: 'status' }] });
  return { campanha_id: String(campanhaId), status };
}

async function ajustarOrcamento(ctx, campanhaId, novo) {
  const v = Number(novo);
  if (!(v > 0)) throw erro('Informe o novo orçamento diário em reais.');
  if (v > ctx.teto) throw erro(`O orçamento diário de R$ ${v} passa do seu teto de R$ ${ctx.teto} por campanha. Para subir o teto, altere em Chaves de API.`);
  const atual = await orcamentoAtual(ctx, campanhaId);
  if (atual.valor > 0 && v > atual.valor * 1.2) {
    throw erro(`Aumento de R$ ${atual.valor.toFixed(2)} para R$ ${v} passa de +20% por ação. Máximo agora: R$ ${(atual.valor * 1.2).toFixed(2)}.`);
  }
  await chamar(ctx, 'campaignBudgets:mutate', { operations: [{ update: { resourceName: atual.resourceName, amountMicros: String(micros(v)) }, updateMask: 'amount_micros' }] });
  return { campanha_id: String(campanhaId), de_brl: atual.valor, para_brl: v };
}

function validarPesquisa(s) {
  const nome = String(s.nome || '').trim();
  if (nome.length < 3) return 'Informe o nome da campanha.';
  if (!(Number(s.orcamento_diario_brl) > 0)) return 'Informe o orçamento diário em reais.';
  if (!['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS'].includes(s.estrategia)) return 'Escolha a estratégia de lance: Maximizar conversões ou Maximizar cliques.';
  const t = (s.titulos || []).map((x) => String(x).trim()).filter(Boolean);
  const d = (s.descricoes || []).map((x) => String(x).trim()).filter(Boolean);
  if (t.length < 3 || t.length > 15) return 'Informe de 3 a 15 títulos.';
  if (t.some((x) => x.length > 30)) return 'Cada título tem no máximo 30 caracteres.';
  if (d.length < 2 || d.length > 4) return 'Informe de 2 a 4 descrições.';
  if (d.some((x) => x.length > 90)) return 'Cada descrição tem no máximo 90 caracteres.';
  if (!/^https:\/\/[^\s]+$/i.test(String(s.url_final || ''))) return 'A página de destino precisa começar com https://.';
  const kw = [...(s.palavras_exatas || []), ...(s.palavras_frase || [])].map((x) => String(x).trim()).filter(Boolean);
  if (!kw.length) return 'Informe ao menos uma palavra-chave.';
  if (kw.some((x) => x.length > 80)) return 'Cada palavra-chave tem no máximo 80 caracteres.';
  return '';
}

// Campanha de Pesquisa completa (orçamento, campanha, grupo, palavras e anúncio responsivo), tudo PAUSADO
async function criarPesquisa(ctx, s) {
  const prob = validarPesquisa(s); if (prob) throw erro(prob);
  if (Number(s.orcamento_diario_brl) > ctx.teto) throw erro(`O orçamento diário de R$ ${s.orcamento_diario_brl} passa do seu teto de R$ ${ctx.teto} por campanha.`);
  const criado = {};
  const etapa = async (nome, fn) => {
    try { return await fn(); } catch (e) {
      const feito = Object.entries(criado).map(([k, v]) => `${k} ${v}`);
      const er = erro(`Falhou na etapa "${nome}": ${e.message}.${feito.length ? ` Já criado (PAUSADO): ${feito.join(', ')}. Nada foi ativado.` : ' Nada foi criado.'}`, e.status || 502);
      er.criado = { ...criado }; throw er;
    }
  };
  const nome = String(s.nome).trim();
  const orc = await etapa('orçamento', () => chamar(ctx, 'campaignBudgets:mutate', { operations: [{ create: {
    name: `${nome} · orçamento ${Date.now()}`, amountMicros: String(micros(s.orcamento_diario_brl)), deliveryMethod: 'STANDARD', explicitlyShared: false } }] }));
  criado.orcamento = orc.results[0].resourceName;
  const campanha = { name: nome, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: criado.orcamento,
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' };
  if (s.estrategia === 'MAXIMIZE_CONVERSIONS') campanha.maximizeConversions = {};
  else campanha.targetSpend = Number(s.teto_cpc_brl) > 0 ? { cpcBidCeilingMicros: String(micros(s.teto_cpc_brl)) } : {};
  const camp = await etapa('campanha', () => chamar(ctx, 'campaigns:mutate', { operations: [{ create: campanha }] }));
  criado.campanha = camp.results[0].resourceName;
  const grupo = await etapa('grupo de anúncios', () => chamar(ctx, 'adGroups:mutate', { operations: [{ create: {
    name: `${nome} · grupo`, campaign: criado.campanha, status: 'ENABLED', type: 'SEARCH_STANDARD' } }] }));
  criado.grupo = grupo.results[0].resourceName;
  const kws = [
    ...(s.palavras_exatas || []).map((t) => ({ text: String(t).trim(), matchType: 'EXACT' })),
    ...(s.palavras_frase || []).map((t) => ({ text: String(t).trim(), matchType: 'PHRASE' })),
  ].filter((k) => k.text);
  await etapa('palavras-chave', () => chamar(ctx, 'adGroupCriteria:mutate', { operations: kws.map((keyword) => ({ create: { adGroup: criado.grupo, status: 'ENABLED', keyword } })) }));
  const ad = await etapa('anúncio', () => chamar(ctx, 'adGroupAds:mutate', { operations: [{ create: { adGroup: criado.grupo, status: 'PAUSED', ad: {
    finalUrls: [s.url_final],
    responsiveSearchAd: { headlines: s.titulos.map((t) => ({ text: String(t).trim() })), descriptions: s.descricoes.map((t) => ({ text: String(t).trim() })) } } } }] }));
  criado.anuncio = ad.results[0].resourceName;
  const id = (criado.campanha.match(/campaigns\/(\d+)/) || [])[1] || null;
  return { campanha_id: id, ...criado };
}

module.exports = { contexto, testar, listarCampanhas, mudarStatus, ajustarOrcamento, criarPesquisa, validarPesquisa, PERIODOS, TETO_PADRAO_BRL };
