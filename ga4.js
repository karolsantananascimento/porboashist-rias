// Google Analytics 4 (somente leitura) para os assinantes do SaaS.
// Usa as credenciais do PRÓPRIO assinante: o mesmo Client ID/secret OAuth do Google Ads + um refresh token com o escopo analytics.readonly.

const crypto = require('crypto');

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const PERIODOS = { 7: '7daysAgo', 14: '14daysAgo', 30: '30daysAgo', 90: '90daysAgo' };

function contexto(le) {
  const c = {
    propriedade: String(le('GA4_PROPERTY_ID') || '').replace(/\D/g, ''), refresh: le('GA4_REFRESH_TOKEN'),
    clientId: le('GOOGLE_ADS_CLIENT_ID'), clientSecret: le('GOOGLE_ADS_CLIENT_SECRET'),
  };
  const falta = [];
  if (!c.propriedade) falta.push('ID da propriedade do Analytics');
  if (!c.refresh) falta.push('Refresh token do Analytics');
  if (!c.clientId) falta.push('Client ID (grupo Google Ads)');
  if (!c.clientSecret) falta.push('Client secret (grupo Google Ads)');
  if (falta.length) throw erro(`O Google Analytics ainda não está configurado. Faltam: ${falta.join(', ')}. Preencha em Chaves de API.`);
  return c;
}

const tokens = new Map();
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
  if (!r.ok || !d.access_token) throw erro(`O Google recusou as credenciais do Analytics (${d.error_description || d.error || 'HTTP ' + r.status}). Confira o refresh token.`, 502);
  if (tokens.size > 500) tokens.clear();
  tokens.set(k, { valor: d.access_token, exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 60) * 1000 });
  return d.access_token;
}

async function relatorio(ctx, corpo) {
  const token = await accessToken(ctx);
  let r;
  try {
    r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${ctx.propriedade}:runReport`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(25000),
    });
  } catch { throw erro('Não consegui falar com o Google Analytics agora. Tente de novo.', 504); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = d.error?.message || `HTTP ${r.status}`;
    throw erro(r.status === 403 ? `Sem permissão nesta propriedade do Analytics (${m}). Confira se o login que gerou o token tem acesso e se a API "Google Analytics Data" está ativada.` : `Analytics: ${m}`, 502);
  }
  return d;
}

const n = (v) => Number(v || 0);
const linhas = (d) => (d.rows || []).map((r) => ({ dim: (r.dimensionValues || []).map((x) => x.value), met: (r.metricValues || []).map((x) => n(x.value)) }));

async function testar(ctx) {
  const d = await relatorio(ctx, { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] });
  return { propriedade: ctx.propriedade, sessoes_7d: n(d.rows?.[0]?.metricValues?.[0]?.value) };
}

// Resumo + série diária + origens + páginas
async function resumo(ctx, dias = 7) {
  const ini = PERIODOS[dias] || PERIODOS[7];
  const dateRanges = [{ startDate: ini, endDate: 'today' }];
  const [tot, serie, origem, pag] = await Promise.all([
    relatorio(ctx, { dateRanges, metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'keyEvents' }, { name: 'engagementRate' }, { name: 'averageSessionDuration' }] }),
    relatorio(ctx, { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    relatorio(ctx, { dateRanges, dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }, { name: 'engagementRate' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
    relatorio(ctx, { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 }),
  ]);
  const t = linhas(tot)[0]?.met || [];
  return {
    dias: PERIODOS[dias] ? dias : 7,
    totais: { sessoes: t[0] || 0, usuarios: t[1] || 0, novos: t[2] || 0, conversoes: t[3] || 0, engajamento: t[4] || 0, duracao: t[5] || 0 },
    serie: linhas(serie).map((r) => ({ data: r.dim[0], sessoes: r.met[0], conversoes: r.met[1] })),
    origens: linhas(origem).map((r) => ({ origem: r.dim[0], sessoes: r.met[0], conversoes: r.met[1], engajamento: r.met[2] })),
    paginas: linhas(pag).map((r) => ({ pagina: r.dim[0], visualizacoes: r.met[0], usuarios: r.met[1] })),
  };
}

module.exports = { contexto, testar, resumo };
