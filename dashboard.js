// Dashboard de KPIs (pacote BI + relatórios): junta o desempenho do Meta e do Google numa visão só.
// Funções puras: recebem as linhas já lidas das plataformas e devolvem totais, KPIs por plataforma e por campanha.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const arred = (v, c = 2) => (v === null ? null : Math.round(v * 10 ** c) / 10 ** c);

// Eventos do Meta que contam como conversão. Os tipos de um mesmo grupo se sobrepõem (a mesma compra aparece em mais de um),
// então dentro do grupo vale o maior valor e os grupos são somados.
const GRUPOS_META = [
  ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'],
  ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  ['onsite_conversion.messaging_conversation_started_7d'],
  ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'],
];
function conversoesMeta(actions) {
  const por = new Map((Array.isArray(actions) ? actions : []).map((a) => [a.action_type, num(a.value)]));
  return GRUPOS_META.reduce((t, g) => t + Math.max(0, ...g.map((k) => por.get(k) || 0)), 0);
}

const deMeta = (rows) => (rows || []).map((r) => ({
  plataforma: 'meta', id: String(r.campaign_id || r.ad_id || ''), nome: r.campaign_name || r.ad_name || 'Sem nome',
  gasto: num(r.spend), impressoes: num(r.impressions), cliques: num(r.clicks), conversoes: conversoesMeta(r.actions),
}));
const deGoogle = (rows) => (rows || []).map((r) => ({
  plataforma: 'google', id: String(r.id || ''), nome: r.nome || 'Sem nome',
  gasto: num(r.gasto_brl), impressoes: num(r.impressoes), cliques: num(r.cliques), conversoes: num(r.conversoes),
}));

function kpis(lista) {
  const t = lista.reduce((a, x) => ({ gasto: a.gasto + x.gasto, impressoes: a.impressoes + x.impressoes, cliques: a.cliques + x.cliques, conversoes: a.conversoes + x.conversoes }), { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0 });
  return {
    gasto: arred(t.gasto), impressoes: t.impressoes, cliques: t.cliques, conversoes: arred(t.conversoes, 1),
    ctr: t.impressoes ? arred((t.cliques / t.impressoes) * 100) : null,           // % de quem viu e clicou
    cpc: t.cliques ? arred(t.gasto / t.cliques) : null,                            // custo por clique
    cpm: t.impressoes ? arred((t.gasto / t.impressoes) * 1000) : null,             // custo por mil impressões
    taxa_conversao: t.cliques ? arred((t.conversoes / t.cliques) * 100) : null,   // % dos cliques que viram conversão
    custo_conversao: t.conversoes ? arred(t.gasto / t.conversoes) : null,          // custo por conversão
  };
}

function montar({ meta = [], google = [] } = {}) {
  const m = deMeta(meta); const g = deGoogle(google); const todas = [...m, ...g];
  return {
    total: kpis(todas),
    plataformas: { meta: kpis(m), google: kpis(g) },
    campanhas: todas.map((x) => ({ plataforma: x.plataforma, id: x.id, nome: x.nome, ...kpis([x]) })).sort((a, b) => b.gasto - a.gasto).slice(0, 50),
  };
}

// período aceito no painel -> nome em cada plataforma
const PERIODOS = {
  last_7d: { meta: 'last_7d', google: 'LAST_7_DAYS', nome: 'Últimos 7 dias' },
  last_14d: { meta: 'last_14d', google: 'LAST_14_DAYS', nome: 'Últimos 14 dias' },
  last_30d: { meta: 'last_30d', google: 'LAST_30_DAYS', nome: 'Últimos 30 dias' },
  this_month: { meta: 'this_month', google: 'THIS_MONTH', nome: 'Este mês' },
  last_month: { meta: 'last_month', google: 'LAST_MONTH', nome: 'Mês passado' },
};

module.exports = { montar, kpis, conversoesMeta, PERIODOS };
