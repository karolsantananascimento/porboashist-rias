// Teste de integração do gestor de tráfego: rotas reais + Postgres real + Meta e Claude simulados.
// Rodar com um Postgres vazio: DATABASE_URL=postgresql://usuario@localhost:5432/pbh node test/campanhas-integracao.js
process.env.ACESSOS_KEY = process.env.ACESSOS_KEY || Buffer.alloc(32, 7).toString('base64');
process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'teste@exemplo.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'temporaria123';
if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL (Postgres local de teste)'); process.exit(2); }

const http = require('node:http');
const express = require('express');
const { pool, init } = require('../db');
const config = require('../config');
const { salvarConexao } = require('../integracoes');
const campanhas = require('../campanhas');

let n = 0; let falhas = 0;
const ok = (c, nome) => { n++; if (c) console.log('  ✓', nome); else { falhas++; console.log('  ✗', nome); } };

// ---- Meta e Claude simulados (o resto do fetch passa direto) ----
const realFetch = global.fetch;
let posts = []; let falharEm = null; let respostaClaude;
const j = (b, s = 200) => ({ ok: s < 400, status: s, json: async () => b });
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com')) return j({ content: [{ type: 'text', text: respostaClaude }] });
  if (!u.startsWith('https://graph.facebook.com')) return realFetch(url, init);
  const m = init.method || 'GET';
  if (m === 'POST') {
    const corpo = Object.fromEntries(new URLSearchParams(init.body));
    posts.push({ u, corpo });
    const fim = u.split('/').pop();
    if (falharEm && fim === falharEm) return j({ error: { message: 'x', error_user_msg: `Meta recusou ${fim}` } }, 400);
    await new Promise((r) => setTimeout(r, 40)); // dá tempo de um segundo clique chegar
    if (fim === 'adcreatives') return j({ id: 'c1' });
    if (fim === 'campaigns') return j({ id: '777' });
    if (fim === 'adsets') return j({ id: 's1' });
    if (fim === 'ads') return j({ id: 'a1' });
    return j({ success: true });
  }
  if (/search\?/.test(u) && /adgeolocation/.test(u)) return j({ data: [{ type: 'city', key: '2500', name: 'Recife', region: 'Pernambuco', country_code: 'BR' }] });
  if (/search\?/.test(u) && /adinterest/.test(u)) return j({ data: [{ id: '6003', name: 'Estética facial' }] });
  if (/\/12345\?/.test(u)) return j({ name: 'Página Teste' });
  if (/\/777\/adsets/.test(u)) return j({ data: [{ id: 's1', status: 'PAUSED' }] });
  if (/\/777\/ads/.test(u)) return j({ data: [{ id: 'a1', status: 'PAUSED' }] });
  if (/\/777\?/.test(u)) return j({ name: 'Camp', status: 'PAUSED' });
  return j({ data: [] });
};

// ---- Servidor mínimo com as rotas reais ----
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch((e) => res.status(e.status || 500).json({ erro: e.message }));
const soAdmin = (req, res, next) => (req.user.papel === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administradores' }));
const app = express(); app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1, nome: 'Teste', email: 'teste@exemplo.com', papel: req.headers['x-papel'] || 'admin' }; next(); });
campanhas.registrar(app, { pool, wrap, soAdmin });
let porta;
const req = (metodo, caminho, corpo, papel) => new Promise((resolve, reject) => {
  const dados = corpo ? JSON.stringify(corpo) : null;
  const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: { 'content-type': 'application/json', ...(papel ? { 'x-papel': papel } : {}), ...(dados ? { 'content-length': Buffer.byteLength(dados) } : {}) } }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, corpo: b ? JSON.parse(b) : {} }));
  });
  r.on('error', reject); if (dados) r.write(dados); r.end();
});
const contar = (fim) => posts.filter((p) => p.u.endsWith('/' + fim)).length;

(async () => {
  await init(); await config.carregar(pool);
  await new Promise((r) => { const s = app.listen(0, () => { porta = s.address().port; r(); }); });

  // cliente de teste
  let { rows: [cl] } = await pool.query(`SELECT c.id FROM clients c JOIN projects p ON p.id=c.project_id WHERE p.tipo IS DISTINCT FROM 'empregos' ORDER BY c.id LIMIT 1`);
  if (!cl) { const { rows: [p] } = await pool.query(`INSERT INTO projects (nome) VALUES ('Teste') RETURNING id`); ({ rows: [cl] } = await pool.query(`INSERT INTO clients (nome, project_id) VALUES ('Cliente teste', $1) RETURNING id`, [p.id])); }
  const cid = cl.id;
  await pool.query('DELETE FROM campanhas');
  await config.definir(pool, 'META_ADS_TOKEN', 'tk-teste', cid); await config.definir(pool, 'META_AD_ACCOUNT_ID', '1', cid);
  await salvarConexao(pool, 'meta', cid, { paginas: [{ id: '12345', nome: 'Página Teste', token: 'pt', ig_id: '999' }], pagina_id: '12345' });
  const nova = async (briefing = 'Campanha de teste') => (await pool.query(`INSERT INTO tasks (client_id, tipo, tema, briefing, status, esteira) VALUES ($1,'trafego','Campanha teste',$2,'aprovacao','aguardando_aprovacao') RETURNING id`, [cid, briefing])).rows[0].id;
  const tarefa = await nova();

  console.log('Rascunho');
  let r = await req('GET', `/api/tasks/${tarefa}/campanha`);
  ok(r.status === 200 && r.corpo.campanha === null && r.corpo.config.token && r.corpo.config.pagina && r.corpo.config.teto_brl === 100, 'sem rascunho ainda; configuração lida do cliente');
  respostaClaude = JSON.stringify({ campanha: { nome: 'Disco · Clínicas', objetivo: 'OUTCOME_TRAFFIC', orcamento_diario_brl: null, texto_principal: 'Texto 1', localizacoes: ['Recife'], interesses: ['Estética facial'], idade_min: 25, idade_max: 55, genero: 'feminino', cta: 'LEARN_MORE', campo_inventado: 'x' }, pendencias: ['Falta o orçamento diário.'] });
  r = await req('POST', `/api/tasks/${tarefa}/campanha/gerar`);
  const c1 = r.corpo.campanha;
  ok(r.status === 200 && c1.status === 'rascunho' && c1.spec.nome === 'Disco · Clínicas' && !('campo_inventado' in c1.spec) && !('orcamento_diario_brl' in c1.spec), 'rascunho gerado só com campos conhecidos; orçamento não inventado');
  ok(c1.pendencias.some((p) => /orçamento/.test(p)) && c1.pendencias.some((p) => /Falta preencher/.test(p)), 'pendências listam o que falta');
  r = await req('PUT', `/api/campanhas/${c1.id}`, { spec: { ...c1.spec, orcamento_diario_brl: 500, imagem_url: 'https://x.com/a.jpg', url_destino: 'https://x.com/lp' } });
  ok(r.status === 200 && r.corpo.campanha.pendencias.some((p) => /teto/.test(p)), 'edição recalcula pendências (orçamento acima do teto)');
  r = await req('POST', `/api/campanhas/${c1.id}/conferir`);
  ok(r.corpo.ok === false && /teto/.test(r.corpo.erro), 'conferir recusa orçamento acima do teto');
  r = await req('PUT', `/api/campanhas/${c1.id}`, { spec: { ...c1.spec, orcamento_diario_brl: 50, imagem_url: 'https://x.com/a.jpg', url_destino: 'https://x.com/lp' } });
  ok(r.corpo.campanha.pendencias.every((p) => !/Falta preencher/.test(p)), 'com tudo preenchido não sobra pendência');
  posts = []; r = await req('POST', `/api/campanhas/${c1.id}/conferir`);
  ok(r.corpo.ok === true && r.corpo.avisos.length >= 3 && posts.length === 0, 'conferir ok e sem nenhuma escrita no Meta');

  console.log('Travas de quem pode subir');
  r = await req('POST', `/api/campanhas/${c1.id}/subir`, { confirmado: true }, 'membro');
  ok(r.status === 403, 'membro não sobe campanha');
  r = await req('POST', `/api/campanhas/${c1.id}/subir`, {});
  ok(r.status === 400 && /Confirme/.test(r.corpo.erro) && contar('campaigns') === 0, 'sem confirmação não cria nada');

  console.log('Subir pausada (clique duplo)');
  posts = [];
  const [a, b] = await Promise.all([req('POST', `/api/campanhas/${c1.id}/subir`, { confirmado: true }), req('POST', `/api/campanhas/${c1.id}/subir`, { confirmado: true })]);
  const stats = [a.status, b.status].sort();
  ok(stats[0] === 200 && stats[1] === 409, 'dois cliques simultâneos: um cria, o outro é barrado (200 + 409)');
  ok(contar('campaigns') === 1 && contar('adsets') === 1 && contar('ads') === 1 && contar('adcreatives') === 1, 'o Meta recebeu exatamente UMA campanha, UM conjunto, UM anúncio, UM criativo');
  const { rows: [c2] } = await pool.query('SELECT * FROM campanhas WHERE id=$1', [c1.id]);
  ok(c2.status === 'criada_pausada' && c2.ids.campanha_id === '777' && c2.ids.anuncio_id === 'a1' && c2.criada_em, 'estado criada_pausada com os IDs do Meta');
  const { rows: [t2] } = await pool.query('SELECT esteira, status, aprovado_por FROM tasks WHERE id=$1', [tarefa]);
  ok(t2.esteira === 'aprovada' && /Teste/.test(t2.aprovado_por), 'tarefa passa a aprovada por quem subiu');
  r = await req('PUT', `/api/campanhas/${c1.id}`, { spec: { nome: 'outro' } });
  ok(r.status === 409, 'campanha já criada não pode ser editada');
  r = await req('POST', `/api/tasks/${tarefa}/campanha/gerar`);
  ok(r.status === 409, 'gerar rascunho de novo não sobrescreve campanha criada');

  console.log('Ativar (clique duplo, limite diário) e pausar');
  r = await req('POST', `/api/campanhas/${c1.id}/ativar`, {}, 'admin');
  ok(r.status === 400, 'ativar exige confirmação');
  r = await req('POST', `/api/campanhas/${c1.id}/ativar`, { confirmado: true }, 'membro');
  ok(r.status === 403, 'membro não ativa');
  posts = [];
  const [x, y] = await Promise.all([req('POST', `/api/campanhas/${c1.id}/ativar`, { confirmado: true }), req('POST', `/api/campanhas/${c1.id}/ativar`, { confirmado: true })]);
  ok([x.status, y.status].sort().join() === '200,409', 'duas ativações simultâneas: uma passa, a outra é barrada');
  ok(posts.filter((p) => p.corpo.status === 'ACTIVE').length === 3, 'ativou campanha, conjunto e anúncio uma única vez (3 chamadas)');
  const { rows: [c3] } = await pool.query('SELECT status, ativada_por FROM campanhas WHERE id=$1', [c1.id]);
  const { rows: [t3] } = await pool.query('SELECT esteira, status FROM tasks WHERE id=$1', [tarefa]);
  ok(c3.status === 'ativada' && t3.esteira === 'publicada', 'campanha ativada e tarefa concluída');
  r = await req('POST', `/api/campanhas/${c1.id}/pausar`, {}, 'admin');
  ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada' && posts.pop().corpo.status === 'PAUSED', 'pausar volta para pausada no Meta');

  console.log('Limite de ativações por dia');
  const { rows: [cx] } = await pool.query(`SELECT id FROM campanhas WHERE id=$1`, [c1.id]);
  for (let i = 0; i < campanhas.ATIVACOES_POR_DIA; i++) await pool.query(`INSERT INTO campanhas (client_id, spec, status, ativada_em) VALUES ($1,'{}','ativada', now())`, [cid]);
  r = await req('POST', `/api/campanhas/${cx.id}/ativar`, { confirmado: true });
  ok(r.status === 429 && /Limite/.test(r.corpo.erro), `a ${campanhas.ATIVACOES_POR_DIA + 1}ª ativação do dia é barrada (429)`);
  await pool.query(`DELETE FROM campanhas WHERE spec = '{}'::jsonb`);

  console.log('Falha no meio da criação');
  const t4 = await nova(); respostaClaude = JSON.stringify({ campanha: { nome: 'Falha', objetivo: 'OUTCOME_TRAFFIC', orcamento_diario_brl: 30, texto_principal: 'T', imagem_url: 'https://x.com/a.jpg', url_destino: 'https://x.com/lp', localizacoes: ['Recife'] }, pendencias: [] });
  const c4 = (await req('POST', `/api/tasks/${t4}/campanha/gerar`)).corpo.campanha;
  falharEm = 'adsets'; posts = [];
  r = await req('POST', `/api/campanhas/${c4.id}/subir`, { confirmado: true });
  const { rows: [c5] } = await pool.query('SELECT status, erro, ids FROM campanhas WHERE id=$1', [c4.id]);
  ok(r.status === 400 || r.status === 502, 'erro do Meta chega à tela com status de erro');
  ok(c5.status === 'erro' && /conjunto de anúncios.*Meta recusou adsets/.test(c5.erro) && c5.ids.campanha_id === '777' && /PAUSADO/.test(c5.erro), 'guarda o erro e o que ficou criado (PAUSADO)');
  ok(posts.every((p) => p.corpo.status !== 'ACTIVE'), 'nada foi ativado na falha');
  falharEm = null; posts = [];
  r = await req('POST', `/api/campanhas/${c4.id}/subir`, { confirmado: true });
  ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada', 'depois de corrigir, dá para tentar de novo');
  ok(JSON.stringify(r.corpo.campanha.ids.restos_pausados) === '["777"]', 'a campanha pausada que sobrou da tentativa com erro fica registrada');

  console.log('Travas de sistema');
  const t5 = await nova();
  const { rows: [c6] } = await pool.query(`INSERT INTO campanhas (task_id, client_id, spec, status, updated_at) VALUES ($1,$2,'{}','criando', now() - interval '20 minutes') RETURNING id`, [t5, cid]);
  r = await req('GET', `/api/tasks/${t5}/campanha`);
  ok(r.corpo.campanha.status === 'erro' && /interrompida/.test(r.corpo.campanha.erro), 'operação travada há mais de 10 minutos volta para erro, sem ficar presa');
  respostaClaude = JSON.stringify({ campanha: { nome: 'Auto' }, pendencias: [] });
  const t6 = await nova();
  const a1 = await campanhas.rascunhoAutomatico(pool, t6); const a2 = await campanhas.rascunhoAutomatico(pool, t6);
  const { rows: [{ q }] } = await pool.query('SELECT count(*)::int q FROM campanhas WHERE task_id=$1', [t6]);
  ok(a1 && a2 === null && q === 1, 'rascunho automático da esteira não duplica');
  respostaClaude = 'não é json'; const t7 = await nova();
  ok((await campanhas.rascunhoAutomatico(pool, t7)) === null, 'se a IA falhar, o rascunho automático não derruba a esteira');
  r = await req('GET', `/api/meta/campanhas`); ok(r.status === 400, 'leituras auxiliares exigem o cliente');

  console.log(`\n${n - falhas}/${n} verificações passaram`);
  await pool.end(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
