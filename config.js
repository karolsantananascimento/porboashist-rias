// Chaves e credenciais das APIs, editáveis pelo painel de Integrações.
// Ficam criptografadas no banco (ACESSOS_KEY). O valor do painel vale mais que a variável de ambiente.

const { cifrar, decifrar } = require('./cofre');

const CHAVES = {
  ANTHROPIC_API_KEY: { grupo: 'ia', rotulo: 'Chave da API do Claude (agentes)', secreto: true },
  META_APP_ID: { grupo: 'meta', rotulo: 'Meta · ID do app', secreto: false },
  META_APP_SECRET: { grupo: 'meta', rotulo: 'Meta · Chave secreta do app', secreto: true },
  META_VERIFY_TOKEN: { grupo: 'meta', rotulo: 'Meta · Token de verificação do webhook (opcional)', secreto: false },
  LINKEDIN_CLIENT_ID: { grupo: 'linkedin', rotulo: 'LinkedIn · Client ID', secreto: false },
  LINKEDIN_CLIENT_SECRET: { grupo: 'linkedin', rotulo: 'LinkedIn · Client Secret', secreto: true },
};

const cache = new Map();

async function carregar(pool) {
  cache.clear();
  const { rows } = await pool.query('SELECT chave, valor_enc FROM configuracoes');
  for (const r of rows) {
    try { const v = decifrar(r.valor_enc); if (v) cache.set(r.chave, v); } catch { /* chave de cifra mudou: ignora */ }
  }
}

// Painel primeiro, variável de ambiente depois
const cfg = (nome) => cache.get(nome) || process.env[nome] || '';

async function definir(pool, nome, valor) {
  if (!CHAVES[nome]) throw Object.assign(new Error('Chave desconhecida'), { status: 400 });
  const v = String(valor || '').trim();
  if (!v) throw Object.assign(new Error('Cole o valor da chave'), { status: 400 });
  if (v.length > 600) throw Object.assign(new Error('Valor longo demais'), { status: 400 });
  await pool.query(
    `INSERT INTO configuracoes (chave, valor_enc, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (chave) DO UPDATE SET valor_enc=EXCLUDED.valor_enc, updated_at=now()`, [nome, cifrar(v)]);
  cache.set(nome, v);
}

async function remover(pool, nome) {
  if (!CHAVES[nome]) throw Object.assign(new Error('Chave desconhecida'), { status: 400 });
  await pool.query('DELETE FROM configuracoes WHERE chave=$1', [nome]);
  cache.delete(nome);
}

// Nunca devolve segredos inteiros para a tela: só os 4 últimos caracteres
function listar() {
  return Object.entries(CHAVES).map(([chave, c]) => {
    const noPainel = cache.get(chave); const env = process.env[chave];
    const valor = noPainel || env || '';
    return {
      chave, grupo: c.grupo, rotulo: c.rotulo, secreto: c.secreto,
      definido: !!valor, origem: noPainel ? 'painel' : env ? 'ambiente' : null,
      previa: !valor ? '' : c.secreto ? '••••' + valor.slice(-4) : valor,
    };
  });
}

module.exports = { CHAVES, carregar, cfg, definir, remover, listar };
