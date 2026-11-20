// Carregado com NODE_OPTIONS=--require no servidor de teste: simula Meta, Google, Claude e Stripe (nunca sai para a internet)
// e registra cada chamada em MOCK_LOG, para o teste conferir QUAL token foi usado em cada uma.
const fs = require('node:fs');
const realFetch = global.fetch;
const j = (b, s = 200) => ({ ok: s < 400, status: s, json: async () => b, text: async () => JSON.stringify(b) });
const log = (o) => fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(o) + '\n');

global.fetch = async (url, init = {}) => {
  const u = String(url); const m = init.method || 'GET';
  const h = init.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const body = init.body ? String(init.body) : '';
  if (u.startsWith('https://api.anthropic.com')) {
    log({ alvo: 'claude', u });
    return j({ content: [{ type: 'text', text: JSON.stringify({ campanha: { nome: 'Clínica · Tráfego', objetivo: 'OUTCOME_TRAFFIC', orcamento_diario_brl: 40, texto_principal: 'Agende sua avaliação', localizacoes: ['Recife'], interesses: ['Estética facial'], idade_min: 25, idade_max: 55, genero: 'feminino', cta: 'LEARN_MORE', url_destino: 'https://clinica.exemplo/lp', imagem_url: 'https://clinica.exemplo/a.jpg', campo_inventado: 'x' }, pendencias: ['Confirmar o orçamento.'] }) }] });
  }
  if (u.startsWith('https://graph.facebook.com')) {
    log({ alvo: 'meta', m, u, auth, body });
    if (m === 'POST') {
      const fim = u.split('/').pop();
      if (fim === 'adimages') return j({ images: { img: { hash: 'hash' + (global.__h = (global.__h || 0) + 1), url: 'https://scontent.example/x.jpg' } } });
      if (fim === 'advideos') return j({ id: 'vid' + (global.__v = (global.__v || 0) + 1) });
      if (fim === 'adcreatives') return j({ id: 'cr1' });
      if (fim === 'campaigns') return j({ id: 'camp1' });
      if (fim === 'adsets') return j({ id: 'set1' });
      if (fim === 'ads') return j({ id: 'ad1' });
      return j({ success: true });
    }
    if (/adgeolocation/.test(u)) return j({ data: [{ type: 'city', key: '2500', name: 'Recife', region: 'Pernambuco', country_code: 'BR' }] });
    if (/adinterest/.test(u)) return j({ data: [{ id: '6003', name: 'Estética facial' }] });
    if (/\/act_\d+\?/.test(u)) return j({ name: 'Conta do Assinante', account_status: 1, currency: 'BRL' });
    if (/\/55555\?/.test(u)) return j({ name: 'Página do Assinante' });
    if (/\/vid\d+\?/.test(u)) return j({ status: { video_status: 'ready' }, picture: 'https://scontent.example/thumb.jpg' });
    if (/\/camp1\/adsets/.test(u)) return j({ data: [{ id: 'set1', status: 'PAUSED' }] });
    if (/\/camp1\/ads/.test(u)) return j({ data: [{ id: 'ad1', status: 'PAUSED' }] });
    if (/\/camp1\?/.test(u)) return j({ name: 'Camp', status: 'PAUSED' });
    return j({ data: [] });
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) { log({ alvo: 'google-oauth', body }); return j({ access_token: 'gat-' + decodeURIComponent((/refresh_token=([^&]+)/.exec(body) || [])[1]), expires_in: 3600 }); }
  if (u.startsWith('https://analyticsdata.googleapis.com')) {
    log({ alvo: 'ga4', u, auth, body });
    const b = body ? JSON.parse(body) : {};
    const dim = b.dimensions?.[0]?.name;
    const v = (x) => ({ value: String(x) });
    if (/999/.test(u)) return j({ error: { message: 'sem acesso' } }, 403);
    if (dim === 'date') return j({ rows: [{ dimensionValues: [v('20261118')], metricValues: [v(40), v(3)] }, { dimensionValues: [v('20261119')], metricValues: [v(60), v(5)] }] });
    if (dim === 'sessionSourceMedium') return j({ rows: [{ dimensionValues: [v('google / cpc')], metricValues: [v(70), v(6), v(0.55)] }] });
    if (dim === 'pagePath') return j({ rows: [{ dimensionValues: [v('/')], metricValues: [v(120), v(80)] }] });
    return j({ rows: [{ metricValues: [v(100), v(80), v(50), v(8), v(0.6), v(95)] }] });
  }
  if (u.startsWith('https://googleads.googleapis.com')) {
    log({ alvo: 'google', m, u, auth, dev: h['developer-token'], body });
    const b = body ? JSON.parse(body) : {};
    if (/googleAds:search/.test(u)) {
      if (/FROM customer/.test(b.query)) return j({ results: [{ customer: { id: '1234567890', descriptiveName: 'Conta Google Teste', currencyCode: 'BRL', status: 'ENABLED' } }] });
      if (/campaign\.id = 22/.test(b.query)) return j({ results: [{ campaign: { id: '22' }, campaignBudget: { amountMicros: '50000000', resourceName: 'customers/1234567890/campaignBudgets/11' } }] });
      return j({ results: [{ campaign: { id: '22', name: 'Pesquisa', status: 'PAUSED', primaryStatus: 'PAUSED', biddingStrategyType: 'MAXIMIZE_CONVERSIONS' }, campaignBudget: { amountMicros: '50000000' }, metrics: { costMicros: '12000000', clicks: '10', impressions: '100', conversions: 2 } }] });
    }
    const fim = u.split('/').pop().split(':')[0];
    const rn = { campaignBudgets: 'customers/1234567890/campaignBudgets/11', campaigns: 'customers/1234567890/campaigns/22', adGroups: 'customers/1234567890/adGroups/33', adGroupCriteria: 'x', adGroupAds: 'customers/1234567890/adGroupAds/33~44' }[fim] || 'x';
    return j({ results: [{ resourceName: rn }] });
  }
  if (u.startsWith('https://api.stripe.com')) { log({ alvo: 'stripe', u, body }); return j({ url: 'https://checkout.stripe.com/c/pay/teste' }); }
  return realFetch(url, init);
};
