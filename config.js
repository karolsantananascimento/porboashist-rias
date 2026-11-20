// Chaves e credenciais das APIs, editáveis pelo painel. Ficam criptografadas no banco (ACESSOS_KEY).
// Cada cliente pode ter as suas chaves (Meta, LinkedIn); o que ele não tiver cai nas chaves padrão
// (escopo 0) e, por fim, na variável de ambiente.

const { cifrar, decifrar } = require('./cofre');

const CHAVES = {
  ANTHROPIC_API_KEY: { grupo: 'ia', rotulo: 'Chave da API do Claude (agentes)', secreto: true, porCliente: false },
  META_APP_ID: { grupo: 'meta', rotulo: 'Meta · ID do app', secreto: false, porCliente: true },
  META_APP_SECRET: { grupo: 'meta', rotulo: 'Meta · Chave secreta do app', secreto: true, porCliente: true },
  META_VERIFY_TOKEN: { grupo: 'meta', rotulo: 'Meta · Token de verificação do webhook (opcional)', secreto: false, porCliente: true },
  // Meta Ads (gestor de tráfego): o login das páginas não tem permissão de anúncios, então a conta de anúncios usa um token próprio
  META_ADS_TOKEN: { grupo: 'meta', rotulo: 'Meta Ads · Token de acesso (permissão ads_management)', secreto: true, porCliente: true },
  META_AD_ACCOUNT_ID: { grupo: 'meta', rotulo: 'Meta Ads · ID da conta de anúncios (act_...)', secreto: false, porCliente: true },
  META_PIXEL_ID: { grupo: 'meta', rotulo: 'Meta Ads · Pixel (opcional, para Leads/Vendas no site)', secreto: false, porCliente: true },
  META_MAX_DAILY_BUDGET_BRL: { grupo: 'meta', rotulo: 'Meta Ads · Teto de orçamento diário por campanha, em R$ (padrão 100)', secreto: false, porCliente: true },
  META_PAGE_ID: { grupo: 'meta', rotulo: 'Meta Ads · ID da página do Facebook', secreto: false, porCliente: true },
  META_IG_ID: { grupo: 'meta', rotulo: 'Meta Ads · ID da conta do Instagram profissional (opcional)', secreto: false, porCliente: true },
  GOOGLE_ADS_DEVELOPER_TOKEN: { grupo: 'googleads', rotulo: 'Google Ads · Developer token', secreto: true, porCliente: true },
  GOOGLE_ADS_CLIENT_ID: { grupo: 'googleads', rotulo: 'Google Ads · Client ID (OAuth)', secreto: false, porCliente: true },
  GOOGLE_ADS_CLIENT_SECRET: { grupo: 'googleads', rotulo: 'Google Ads · Client secret (OAuth)', secreto: true, porCliente: true },
  GOOGLE_ADS_REFRESH_TOKEN: { grupo: 'googleads', rotulo: 'Google Ads · Refresh token', secreto: true, porCliente: true },
  GOOGLE_ADS_CUSTOMER_ID: { grupo: 'googleads', rotulo: 'Google Ads · ID da conta de anúncios (10 dígitos)', secreto: false, porCliente: true },
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: { grupo: 'googleads', rotulo: 'Google Ads · ID da conta gerenciadora/MCC (opcional)', secreto: false, porCliente: true },
  GOOGLE_ADS_MAX_DAILY_BUDGET_BRL: { grupo: 'googleads', rotulo: 'Google Ads · Teto de orçamento diário por campanha, em R$ (padrão 100)', secreto: false, porCliente: true },
  LINKEDIN_CLIENT_ID: { grupo: 'linkedin', rotulo: 'LinkedIn · Client ID', secreto: false, porCliente: true },
  LINKEDIN_CLIENT_SECRET: { grupo: 'linkedin', rotulo: 'LinkedIn · Client Secret', secreto: true, porCliente: true },
  GA4_PROPERTY_ID: { grupo: 'analytics', rotulo: 'Google Analytics 4 · ID da propriedade', secreto: false, porCliente: true },
  GA4_REFRESH_TOKEN: { grupo: 'analytics', rotulo: 'Google Analytics 4 · Refresh token', secreto: true, porCliente: true },
  GOOGLE_CLIENT_ID: { grupo: 'google', rotulo: 'Google · ID do cliente OAuth', secreto: false, porCliente: true },
  GOOGLE_CLIENT_SECRET: { grupo: 'google', rotulo: 'Google · Chave secreta do cliente OAuth', secreto: true, porCliente: true },
};

const cache = new Map(); // `${clienteId}|${chave}`

async function carregar(pool) {
  cache.clear();
  const { rows } = await pool.query('SELECT chave, client_id, valor_enc FROM configuracoes');
  for (const r of rows) {
    try { const v = decifrar(r.valor_enc); if (v) cache.set(`${r.client_id}|${r.chave}`, v); } catch { /* chave de cifra mudou: ignora */ }
  }
}

// Cliente primeiro, depois a chave padrão, depois a variável de ambiente
const cfg = (nome, clienteId = 0) =>
  (clienteId && cache.get(`${clienteId}|${nome}`)) || cache.get(`0|${nome}`) || process.env[nome] || '';

function validar(nome, clienteId) {
  const c = CHAVES[nome];
  if (!c) throw Object.assign(new Error('Chave desconhecida'), { status: 400 });
  if (clienteId && !c.porCliente) throw Object.assign(new Error('Esta chave vale para todo o sistema e fica em APIs padrão'), { status: 400 });
}

async function definir(pool, nome, valor, clienteId = 0) {
  validar(nome, clienteId);
  const v = String(valor || '').trim();
  if (!v) throw Object.assign(new Error('Cole o valor da chave'), { status: 400 });
  if (v.length > 600) throw Object.assign(new Error('Valor longo demais'), { status: 400 });
  await pool.query(
    `INSERT INTO configuracoes (chave, client_id, valor_enc, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (chave, client_id) DO UPDATE SET valor_enc=EXCLUDED.valor_enc, updated_at=now()`, [nome, clienteId, cifrar(v)]);
  cache.set(`${clienteId}|${nome}`, v);
}

async function remover(pool, nome, clienteId = 0) {
  validar(nome, clienteId);
  await pool.query('DELETE FROM configuracoes WHERE chave=$1 AND client_id=$2', [nome, clienteId]);
  cache.delete(`${clienteId}|${nome}`);
}

// SaaS: lê SOMENTE o que o próprio assinante guardou. Nunca cai nas chaves padrão do administrador nem nas variáveis
// de ambiente (senão um assinante gastaria na conta de anúncios de outra pessoa).
const cfgProprio = (nome, escopo) => (escopo ? cache.get(`${escopo}|${nome}`) || '' : '');

function listarProprio(escopo, chaves) {
  return chaves.map((chave) => {
    const c = CHAVES[chave]; const v = cfgProprio(chave, escopo);
    return { chave, grupo: c.grupo, rotulo: c.rotulo, secreto: c.secreto, definido: !!v, previa: !v ? '' : c.secreto ? '••••' + v.slice(-4) : v };
  });
}

// Nunca devolve segredos inteiros para a tela: só os 4 últimos caracteres
function listar(clienteId = 0) {
  return Object.entries(CHAVES).filter(([, c]) => !clienteId || c.porCliente).map(([chave, c]) => {
    const proprio = cache.get(`${clienteId}|${chave}`);
    const padrao = clienteId ? (cache.get(`0|${chave}`) || '') : '';
    const env = process.env[chave] || '';
    const valor = proprio || padrao || env;
    return {
      chave, grupo: c.grupo, rotulo: c.rotulo, secreto: c.secreto,
      definido: !!valor, origem: proprio ? (clienteId ? 'cliente' : 'painel') : padrao ? 'padrao' : env ? 'ambiente' : null,
      previa: !valor ? '' : c.secreto ? '••••' + valor.slice(-4) : valor,
    };
  });
}

// Todos os escopos que têm credenciais da Meta (para validar o webhook, que chega sem saber o cliente)
function escoposMeta() {
  const s = new Set([0]);
  for (const k of cache.keys()) { const [cid, chave] = k.split('|'); if (chave.startsWith('META_')) s.add(Number(cid)); }
  return [...s];
}

module.exports = { CHAVES, carregar, cfg, cfgProprio, definir, remover, listar, listarProprio, escoposMeta };
