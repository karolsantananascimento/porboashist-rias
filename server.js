const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool, init, salvarExperiencias, STATUSES, BLOG_CHECKLIST, hashSenha, conferirSenha } = require('./db');
const { lerExperiencias, urlExportacao } = require('./experiencias');
const { cifrar, decifrar } = require('./cofre');

const app = express();
app.set('trust proxy', 1);
app.use(require('compression')());
app.use((req, res, next) => { // cabeçalhos de segurança (sem CSP rígida, para não quebrar login do Google/Meta nem o GA4)
  if ((req.headers['x-forwarded-proto'] || req.protocol) === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}); // gzip em HTML, CSS, JS e JSON: páginas bem menores no celular
app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
});

// ---------- Sessão por usuário (cookie assinado) ----------
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'pbh_sessao';
const DURACAO = 60 * 60 * 24 * 30; // 30 dias

// A assinatura inclui parte do hash da senha: trocar a senha encerra as sessões antigas.
const assinar = (id, exp, senhaHash) =>
  crypto.createHmac('sha256', SECRET).update(`${id}.${exp}.${senhaHash.slice(-16)}`).digest('hex');

function criarSessao(res, user) {
  const exp = Math.floor(Date.now() / 1000) + DURACAO;
  const valor = `${user.id}.${exp}.${assinar(user.id, exp, user.senha_hash)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO}` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

// Modo suporte: o administrador entra na conta de um assinante. Cookie próprio, assinado, preso ao administrador e ao assinante, válido por 2 horas.
const COOKIE_SUPORTE = 'pbh_suporte';
const SUPORTE_DURACAO = 2 * 60 * 60;
const assinarSuporte = (alvo, adm, exp, senhaHashAdm) =>
  crypto.createHmac('sha256', SECRET).update(`suporte.${alvo}.${adm}.${exp}.${senhaHashAdm.slice(-16)}`).digest('hex');
const suporte = {
  iniciar(res, admin, alvoId) {
    const exp = Math.floor(Date.now() / 1000) + SUPORTE_DURACAO;
    res.setHeader('Set-Cookie', `${COOKIE_SUPORTE}=${alvoId}.${admin.id}.${exp}.${assinarSuporte(alvoId, admin.id, exp, admin.senha_hash)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SUPORTE_DURACAO}` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  },
  ler(req, admin) { // devolve o id do assinante em atendimento, ou null
    const [alvo, adm, exp, sig] = (getCookie(req, COOKIE_SUPORTE) || '').split('.');
    if (!alvo || !adm || !exp || !sig || Number(adm) !== admin.id || Number(exp) < Date.now() / 1000) return null;
    const esperado = assinarSuporte(alvo, adm, exp, admin.senha_hash);
    if (esperado.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return null;
    return Number(alvo);
  },
  encerrar(res) { res.setHeader('Set-Cookie', `${COOKIE_SUPORTE}=; Path=/; Max-Age=0`); },
};

async function usuarioDaSessao(req) {
  const [id, exp, sig] = (getCookie(req, COOKIE) || '').split('.');
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id=$1 AND ativo', [id]);
  if (!u) return null;
  const esperado = assinar(u.id, exp, u.senha_hash);
  if (esperado.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return null;
  return u;
}

const publico = (u) => ({
  id: u.id, email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo, trocar_senha: u.trocar_senha, absoluto: ehSuper(u),
  convite_pendente: !!u.convite_hash && new Date(u.convite_expira) > new Date(), created_at: u.created_at,
});

// ---------- Convites: link para a pessoa criar a própria senha ----------
const CONVITE_DIAS = 7;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

async function gerarConvite(userId, req) {
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `UPDATE users SET convite_hash=$1, convite_expira=now() + interval '${CONVITE_DIAS} days' WHERE id=$2`,
    [hashToken(token), userId]);
  return `${req.protocol}://${req.get('host')}/?convite=${token}`;
}

async function usuarioDoConvite(token) {
  if (!token) return null;
  const { rows: [u] } = await pool.query(
    'SELECT * FROM users WHERE convite_hash=$1 AND convite_expira > now() AND ativo', [hashToken(token)]);
  return u || null;
}

app.get('/api/convite/:token', wrap(async (req, res) => {
  const u = await usuarioDoConvite(req.params.token);
  if (!u) return res.status(404).json({ erro: 'Este link de acesso expirou ou já foi usado. Peça um novo a um administrador.' });
  res.json({ email: u.email, nome: u.nome });
}));

app.post('/api/convite', wrap(async (req, res) => {
  const u = await usuarioDoConvite(req.body.token);
  if (!u) return res.status(404).json({ erro: 'Este link de acesso expirou ou já foi usado. Peça um novo a um administrador.' });
  const senha = String(req.body.senha || '');
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres' });
  const nome = String(req.body.nome || '').trim() || u.nome;
  const { rows: [atual] } = await pool.query(
    `UPDATE users SET senha_hash=$1, trocar_senha=false, convite_hash=NULL, convite_expira=NULL, nome=$2 WHERE id=$3 RETURNING *`,
    [hashSenha(senha), nome, u.id]);
  criarSessao(res, atual);
  res.json({ usuario: publico(atual) });
}));
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Limite simples de tentativas de login por IP
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 8 && Date.now() - t.desde < 15 * 60 * 1000;
}
function registrarFalha(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > 15 * 60 * 1000) tentativas.set(ip, { n: 1, desde: Date.now() });
  else t.n++;
}

app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE email=$1 AND ativo', [email]);
  if (!u || !conferirSenha(req.body.senha || '', u.senha_hash)) {
    registrarFalha(ip);
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  }
  tentativas.delete(ip);
  criarSessao(res, u);
  res.json({ usuario: publico(u) });
}));

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', [`${COOKIE}=; Path=/; Max-Age=0`, `${COOKIE_SUPORTE}=; Path=/; Max-Age=0`]);
  res.json({ ok: true });
});

app.get('/api/sessao', wrap(async (req, res) => {
  const u = await usuarioDaSessao(req);
  res.json({ autenticado: !!u, usuario: u ? publico(u) : null });
}));
app.get('/healthz', (req, res) => res.send('ok'));
// SaaS do gestor de tráfego: cadastro de assinantes, preço e webhook do Stripe (públicos, sem sessão)
const saas = require('./saas');
saas.registrarPublico(app, { pool, wrap, criarSessao });

app.use('/api', wrap(async (req, res, next) => {
  const u = await usuarioDaSessao(req);
  if (!u) return res.status(401).json({ erro: 'Não autenticado' });
  // Assinantes do SaaS só enxergam a própria área: tudo o mais na API é do sistema interno
  if (u.papel === 'assinante' && !/^\/(saas|minha-senha|meu-perfil)(\/|$)/.test(req.path)) {
    return res.status(403).json({ erro: 'Acesso restrito à área do assinante' });
  }
  req.user = u;
  next();
}));
// Retorno do login das redes sociais (navegação do navegador, não chamada de API)
app.use('/oauth', wrap(async (req, res, next) => {
  const u = await usuarioDaSessao(req);
  if (!u) return res.redirect('/');
  if (u.papel === 'assinante') return res.redirect('/assinante');
  req.user = u;
  next();
}));
// Administrador absoluto: só esta conta cria, promove, rebaixa, desativa ou exclui administradores, e ninguém mexe nela
const SUPER_ADMIN = String(process.env.SUPER_ADMIN_EMAIL || 'knasck@gmail.com').trim().toLowerCase();
const ehSuper = (u) => !!u && String(u.email || '').toLowerCase() === SUPER_ADMIN;
const SO_SUPER = { erro: 'Só o administrador absoluto pode gerenciar administradores.' };
const soAdmin = (req, res, next) => (req.user.papel === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administradores' }));

// ---------- Minha conta ----------
app.post('/api/minha-senha', wrap(async (req, res) => {
  const { atual, nova } = req.body;
  if (!conferirSenha(atual || '', req.user.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta' });
  if (!nova || nova.length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres' });
  const { rows: [u] } = await pool.query(
    'UPDATE users SET senha_hash=$1, trocar_senha=false WHERE id=$2 RETURNING *', [hashSenha(nova), req.user.id]);
  criarSessao(res, u);
  res.json({ usuario: publico(u) });
}));

app.put('/api/meu-perfil', wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('UPDATE users SET nome=$1 WHERE id=$2 RETURNING *',
    [String(req.body.nome || '').trim() || null, req.user.id]);
  res.json({ usuario: publico(u) });
}));

// ---------- Usuários ----------
app.get('/api/users', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM users WHERE papel <> 'assinante' ORDER BY ativo DESC, nome NULLS LAST, email`);
  res.json(rows.map(publico));
}));

app.post('/api/users', soAdmin, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailValido(email)) return res.status(400).json({ erro: 'E-mail inválido' });
  const papel = req.body.papel === 'admin' ? 'admin' : 'membro';
  if (papel === 'admin' && !ehSuper(req.user)) return res.status(403).json(SO_SUPER);
  try {
    // Senha aleatória inutilizável até a pessoa criar a dela pelo link
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, nome, senha_hash, papel, trocar_senha) VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [email, String(req.body.nome || '').trim() || null, hashSenha(crypto.randomBytes(24).toString('hex')), papel]);
    const link = await gerarConvite(u.id, req);
    const { rows: [atual] } = await pool.query('SELECT * FROM users WHERE id=$1', [u.id]);
    res.json({ usuario: publico(atual), link });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ erro: 'Já existe um usuário com esse e-mail' });
    throw e;
  }
}));

async function adminsAtivos(excetoId) {
  const { rows } = await pool.query(`SELECT count(*)::int n FROM users WHERE papel='admin' AND ativo AND id<>$1`, [excetoId]);
  return rows[0].n;
}

app.put('/api/users/:id', soAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: [alvo] } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (alvo.papel === 'assinante') return res.status(400).json({ erro: 'Assinantes são gerenciados em Assinantes (SaaS)' });
  const papel = req.body.papel === 'admin' ? 'admin' : req.body.papel === 'membro' ? 'membro' : alvo.papel;
  const ativo = typeof req.body.ativo === 'boolean' ? req.body.ativo : alvo.ativo;
  if (ehSuper(alvo) && (papel !== 'admin' || !ativo)) return res.status(403).json({ erro: 'O administrador absoluto não pode ser rebaixado nem desativado.' });
  if ((alvo.papel === 'admin' || papel === 'admin') && (papel !== alvo.papel || ativo !== alvo.ativo) && !ehSuper(req.user)) return res.status(403).json(SO_SUPER);
  const perdeAdmin = alvo.papel === 'admin' && alvo.ativo && (papel !== 'admin' || !ativo);
  if (perdeAdmin && (await adminsAtivos(id)) === 0) return res.status(400).json({ erro: 'É preciso manter pelo menos um administrador ativo' });
  const nome = 'nome' in req.body ? (String(req.body.nome || '').trim() || null) : alvo.nome;
  const { rows: [u] } = await pool.query('UPDATE users SET nome=$1, papel=$2, ativo=$3 WHERE id=$4 RETURNING *', [nome, papel, ativo, id]);
  res.json({ usuario: publico(u) });
}));

app.post('/api/users/:id/convite', soAdmin, wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
  const link = await gerarConvite(u.id, req);
  const { rows: [atual] } = await pool.query('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ usuario: publico(atual), link });
}));

app.delete('/api/users/:id', soAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário' });
  const { rows: [alvo] } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  if (alvo && alvo.papel === 'assinante') return res.status(400).json({ erro: 'Assinantes são gerenciados em Assinantes (SaaS)' });
  if (ehSuper(alvo)) return res.status(403).json({ erro: 'O administrador absoluto não pode ser excluído.' });
  if (alvo && alvo.papel === 'admin' && !ehSuper(req.user)) return res.status(403).json(SO_SUPER);
  if (alvo && alvo.papel === 'admin' && alvo.ativo && (await adminsAtivos(id)) === 0) return res.status(400).json({ erro: 'É preciso manter pelo menos um administrador ativo' });
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// ---------- Clientes ----------
const CLIENT_FIELDS = ['project_id', 'nome', 'marcas', 'site', 'whatsapp', 'instagram', 'meta_posts', 'meta_stories_dia', 'meta_blog', 'observacoes', 'planilha_url'];

app.get('/api/clients', wrap(async (req, res) => {
  const { rows } = req.query.project_id
    ? await pool.query('SELECT * FROM clients WHERE project_id=$1 ORDER BY nome', [req.query.project_id])
    : await pool.query('SELECT * FROM clients ORDER BY nome');
  res.json(rows);
}));

app.post('/api/clients', wrap(async (req, res) => {
  const b = req.body;
  if (!b.nome) return res.status(400).json({ erro: 'Informe o nome do cliente' });
  const { rows } = await pool.query(
    `INSERT INTO clients (nome, marcas, site, whatsapp, instagram, meta_posts, meta_stories_dia, meta_blog, observacoes, project_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.nome, JSON.stringify(b.marcas || []), b.site, b.whatsapp, b.instagram,
      b.meta_posts ?? 12, b.meta_stories_dia ?? 1, b.meta_blog ?? 4, b.observacoes, b.project_id || null]
  );
  res.json(rows[0]);
}));

app.put('/api/clients/:id', wrap(async (req, res) => {
  const sets = []; const vals = [];
  for (const f of CLIENT_FIELDS) {
    if (f in req.body) {
      vals.push(f === 'marcas' ? JSON.stringify(req.body[f] || []) : req.body[f]);
      sets.push(`${f}=$${vals.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar' });
  vals.push(req.params.id);
  const { rows } = await pool.query(`UPDATE clients SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
  res.json(rows[0]);
}));

app.delete('/api/clients/:id', soAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Gera a estrutura de um mês: posts distribuídos, stories diários e artigos de blog
app.post('/api/clients/:id/gerar-mes', wrap(async (req, res) => {
  const mes = req.body.mes; // 'AAAA-MM'
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return res.status(400).json({ erro: 'Mês inválido' });
  const { rows: [cl] } = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
  if (!cl) return res.status(404).json({ erro: 'Cliente não encontrado' });

  const [y, m] = mes.split('-').map(Number);
  const dias = new Date(y, m, 0).getDate();
  const d2 = (d) => `${mes}-${String(d).padStart(2, '0')}`;
  const { rows: exist } = await pool.query(
    `SELECT tipo, count(*)::int n FROM tasks WHERE client_id=$1 AND to_char(data,'YYYY-MM')=$2 GROUP BY tipo`,
    [cl.id, mes]);
  const has = Object.fromEntries(exist.map((r) => [r.tipo, r.n]));
  const criados = { post: 0, story: 0, blog: 0 };
  const ins = (tipo, formato, data, tema, checklist = []) => pool.query(
    'INSERT INTO tasks (client_id,tipo,formato,data,tema,checklist) VALUES ($1,$2,$3,$4,$5,$6)',
    [cl.id, tipo, formato, data, tema, JSON.stringify(checklist)]);

  if (!has.post) {
    for (let i = 0; i < cl.meta_posts; i++) {
      await ins('post', null, d2(Math.min(dias, 1 + Math.floor((i * dias) / cl.meta_posts))), null);
      criados.post++;
    }
  }
  if (!has.story && cl.meta_stories_dia > 0) {
    for (let d = 1; d <= dias; d++) {
      for (let k = 0; k < cl.meta_stories_dia; k++) { await ins('story', 'story', d2(d), 'Stories do dia'); criados.story++; }
    }
  }
  if (!has.blog) {
    for (let i = 0; i < cl.meta_blog; i++) {
      await ins('blog', 'artigo', d2(Math.min(dias, 1 + Math.floor(((i + 0.5) * dias) / cl.meta_blog))),
        'Artigo de blog (SEO) — definir pauta', BLOG_CHECKLIST.map((texto) => ({ texto, feito: false })));
      criados.blog++;
    }
  }
  res.json({ criados, jaExistiam: has });
}));

// ---------- Tarefas ----------
const TASK_FIELDS = ['client_id', 'tipo', 'formato', 'data', 'editorial', 'tema', 'legenda', 'briefing', 'links',
  'status', 'responsavel', 'prioridade', 'palavra_chave', 'checklist', 'arte_url'];

function clean(f, v) {
  if (f === 'checklist') return JSON.stringify(Array.isArray(v) ? v : []);
  if (f === 'status' && !STATUSES.includes(v)) return 'pauta';
  return v === '' ? null : v;
}

app.get('/api/tasks', wrap(async (req, res) => {
  const where = []; const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', '$' + vals.length)); };
  if (req.query.client_id) add('client_id=?', req.query.client_id);
  else if (req.query.project_id) add('client_id IN (SELECT id FROM clients WHERE project_id=?)', req.query.project_id);
  if (req.query.mes) add("(to_char(data,'YYYY-MM')=? OR data IS NULL)", req.query.mes);
  if (req.query.tipo) add('tipo=?', req.query.tipo);
  if (req.query.status) add('status=?', req.query.status);
  const { rows } = await pool.query(
    `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY data NULLS LAST, tipo, id`, vals);
  res.json(rows);
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const b = req.body;
  if (!b.client_id) return res.status(400).json({ erro: 'Escolha o cliente' });
  const cols = TASK_FIELDS.filter((f) => f in b);
  const { rows } = await pool.query(
    `INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
    cols.map((f) => clean(f, b[f])));
  res.json(rows[0]);
}));

app.put('/api/tasks/:id', wrap(async (req, res) => {
  const cols = TASK_FIELDS.filter((f) => f in req.body);
  if (!cols.length) return res.status(400).json({ erro: 'Nada para atualizar' });
  const vals = cols.map((f) => clean(f, req.body[f]));
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE tasks SET ${cols.map((f, i) => `${f}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`,
    vals);
  if (!rows[0]) return res.status(404).json({ erro: 'Tarefa não encontrada' });
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Programação / experiências (planilha do cliente) ----------
app.get('/api/experiencias', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, t.status AS task_status, t.data AS task_data FROM experiencias e LEFT JOIN tasks t ON t.id=e.task_id
     WHERE e.client_id=$1 ORDER BY e.ordem`, [req.query.client_id]);
  res.json(rows);
}));

app.post('/api/clients/:id/sincronizar-planilha', wrap(async (req, res) => {
  const { rows: [cl] } = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
  if (!cl) return res.status(404).json({ erro: 'Cliente não encontrado' });
  const url = urlExportacao(cl.planilha_url);
  if (!url) return res.status(400).json({ erro: 'Cadastre o link da planilha do Google em Clientes' });
  let texto;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    texto = await r.text();
    if (!r.ok || /^\s*<!doctype html|^\s*<html/i.test(texto)) throw new Error('privada');
  } catch {
    return res.status(400).json({
      erro: 'Não consegui ler a planilha. No Google Sheets, compartilhe como "Qualquer pessoa com o link pode ver" e tente de novo.',
    });
  }
  let lista;
  try { lista = lerExperiencias(texto); } catch (e) { return res.status(400).json({ erro: e.message }); }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await salvarExperiencias(c, cl.id, lista);
    await c.query('UPDATE clients SET planilha_sync=now() WHERE id=$1', [cl.id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  res.json({ ok: true, experiencias: lista.length });
}));

app.put('/api/experiencias/vincular', wrap(async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  await pool.query('UPDATE experiencias SET task_id=$1 WHERE id = ANY($2)', [req.body.task_id || null, ids]);
  res.json({ ok: true });
}));

// ---------- Links rápidos do cliente ----------
const urlValida = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim());

app.get('/api/clients/:id/links', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM links WHERE client_id=$1 ORDER BY categoria NULLS LAST, ordem, id', [req.params.id]);
  res.json(rows);
}));

app.post('/api/links', wrap(async (req, res) => {
  const b = req.body;
  if (!b.client_id || !b.titulo || !urlValida(b.url)) return res.status(400).json({ erro: 'Informe título e um link começando com https://' });
  const { rows: [l] } = await pool.query(
    'INSERT INTO links (client_id, titulo, url, categoria, observacao) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.client_id, b.titulo.trim(), b.url.trim(), b.categoria || null, b.observacao || null]);
  res.json(l);
}));

app.put('/api/links/:id', wrap(async (req, res) => {
  const b = req.body;
  if (!b.titulo || !urlValida(b.url)) return res.status(400).json({ erro: 'Informe título e um link começando com https://' });
  const { rows: [l] } = await pool.query(
    'UPDATE links SET titulo=$1, url=$2, categoria=$3, observacao=$4 WHERE id=$5 RETURNING *',
    [b.titulo.trim(), b.url.trim(), b.categoria || null, b.observacao || null, req.params.id]);
  res.json(l);
}));

app.delete('/api/links/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM links WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Acessos (logins e senhas dos clientes) ----------
const podeVer = (req, a) => !a.restrito || req.user.papel === 'admin';
const acessoPublico = (a) => ({
  id: a.id, client_id: a.client_id, servico: a.servico, url: a.url, usuario: a.usuario,
  tem_senha: !!a.senha_enc, observacao: a.observacao, restrito: a.restrito, updated_at: a.updated_at,
});

app.get('/api/clients/:id/acessos', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM acessos WHERE client_id=$1 ORDER BY ordem, id', [req.params.id]);
  const visiveis = rows.filter((a) => podeVer(req, a));
  res.json({ acessos: visiveis.map(acessoPublico), ocultos: rows.length - visiveis.length });
}));

app.get('/api/acessos/:id/senha', wrap(async (req, res) => {
  const { rows: [a] } = await pool.query('SELECT * FROM acessos WHERE id=$1', [req.params.id]);
  if (!a || !podeVer(req, a)) return res.status(404).json({ erro: 'Acesso não encontrado' });
  console.log(`Senha visualizada: acesso ${a.id} (${a.servico}) por ${req.user.email}`);
  res.json({ senha: decifrar(a.senha_enc) });
}));

app.post('/api/acessos', soAdmin, wrap(async (req, res) => {
  const b = req.body;
  if (!b.client_id || !b.servico) return res.status(400).json({ erro: 'Informe o serviço' });
  const { rows: [a] } = await pool.query(
    `INSERT INTO acessos (client_id, servico, url, usuario, senha_enc, observacao, restrito)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.client_id, b.servico.trim(), b.url || null, b.usuario || null, cifrar(b.senha), b.observacao || null, b.restrito !== false]);
  res.json(acessoPublico(a));
}));

app.put('/api/acessos/:id', soAdmin, wrap(async (req, res) => {
  const b = req.body;
  const { rows: [atual] } = await pool.query('SELECT * FROM acessos WHERE id=$1', [req.params.id]);
  if (!atual) return res.status(404).json({ erro: 'Acesso não encontrado' });
  // Senha só muda quando uma nova é enviada; string vazia com limpar_senha remove
  const senha = b.limpar_senha ? null : (b.senha ? cifrar(b.senha) : atual.senha_enc);
  const { rows: [a] } = await pool.query(
    `UPDATE acessos SET servico=$1, url=$2, usuario=$3, senha_enc=$4, observacao=$5, restrito=$6, updated_at=now()
     WHERE id=$7 RETURNING *`,
    [b.servico || atual.servico, b.url || null, b.usuario || null, senha, b.observacao || null, b.restrito !== false, atual.id]);
  res.json(acessoPublico(a));
}));

app.delete('/api/acessos/:id', soAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM acessos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Materiais (fotos e vídeos) ----------
app.get('/api/materials', wrap(async (req, res) => {
  const { rows } = req.query.client_id
    ? await pool.query('SELECT * FROM materials WHERE client_id=$1 ORDER BY categoria, id', [req.query.client_id])
    : req.query.project_id
      ? await pool.query('SELECT * FROM materials WHERE client_id IN (SELECT id FROM clients WHERE project_id=$1) ORDER BY categoria, id', [req.query.project_id])
      : await pool.query('SELECT * FROM materials ORDER BY categoria, id');
  res.json(rows);
}));

app.post('/api/materials', wrap(async (req, res) => {
  const b = req.body;
  if (!b.client_id || !b.url) return res.status(400).json({ erro: 'Informe cliente e link' });
  const { rows } = await pool.query(
    'INSERT INTO materials (client_id,categoria,descricao,url,evitar) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.client_id, b.categoria || null, b.descricao || null, b.url, !!b.evitar]);
  res.json(rows[0]);
}));

app.put('/api/materials/:id', wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    'UPDATE materials SET categoria=$1, descricao=$2, url=$3, evitar=$4 WHERE id=$5 RETURNING *',
    [b.categoria || null, b.descricao || null, b.url, !!b.evitar, req.params.id]);
  res.json(rows[0]);
}));

app.delete('/api/materials/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM materials WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Quadros da home (pautas) ----------
const COLUNAS_PAUTA = ['fazer', 'andamento', 'finalizado'];
const linkOpcional = (u) => { const s = String(u || '').trim(); return !s || /^https?:\/\/\S+$/i.test(s); };

app.get('/api/pautas', wrap(async (req, res) => {
  const { rows } = req.query.client_id
    ? await pool.query('SELECT * FROM pautas_home WHERE client_id=$1 ORDER BY ordem, id', [req.query.client_id])
    : req.query.project_id
      ? await pool.query('SELECT * FROM pautas_home WHERE client_id IN (SELECT id FROM clients WHERE project_id=$1) ORDER BY ordem, id', [req.query.project_id])
      : await pool.query('SELECT * FROM pautas_home ORDER BY ordem, id');
  res.json(rows);
}));

app.post('/api/pautas', wrap(async (req, res) => {
  const b = req.body;
  if (!b.client_id || !String(b.nome || '').trim()) return res.status(400).json({ erro: 'Informe o cliente e o nome da pauta' });
  if (!linkOpcional(b.link_pauta) || !linkOpcional(b.link_imagens)) return res.status(400).json({ erro: 'Os links precisam começar com https://' });
  const coluna = COLUNAS_PAUTA.includes(b.coluna) ? b.coluna : 'fazer';
  const { rows: [p] } = await pool.query(
    `INSERT INTO pautas_home (client_id, coluna, nome, link_pauta, link_imagens, descricao, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(ordem),0)+1 FROM pautas_home WHERE client_id=$1 AND coluna=$2)) RETURNING *`,
    [b.client_id, coluna, b.nome.trim(), (b.link_pauta || '').trim() || null, (b.link_imagens || '').trim() || null, b.descricao || null]);
  res.json(p);
}));

app.put('/api/pautas/:id', wrap(async (req, res) => {
  const b = req.body;
  const { rows: [atual] } = await pool.query('SELECT * FROM pautas_home WHERE id=$1', [req.params.id]);
  if (!atual) return res.status(404).json({ erro: 'Pauta não encontrada' });
  const n = { ...atual, ...b };
  if (!String(n.nome || '').trim()) return res.status(400).json({ erro: 'Informe o nome da pauta' });
  if (!linkOpcional(n.link_pauta) || !linkOpcional(n.link_imagens)) return res.status(400).json({ erro: 'Os links precisam começar com https://' });
  if (!COLUNAS_PAUTA.includes(n.coluna)) return res.status(400).json({ erro: 'Coluna inválida' });
  const mudouColuna = n.coluna !== atual.coluna;
  const { rows: [p] } = await pool.query(
    `UPDATE pautas_home SET coluna=$1, nome=$2, link_pauta=$3, link_imagens=$4, descricao=$5, client_id=$6,
       ordem = CASE WHEN $7 THEN (SELECT COALESCE(MAX(ordem),0)+1 FROM pautas_home WHERE client_id=$6 AND coluna=$1) ELSE ordem END,
       updated_at=now() WHERE id=$8 RETURNING *`,
    [n.coluna, n.nome.trim(), (n.link_pauta || '').trim() || null, (n.link_imagens || '').trim() || null, n.descricao || null, n.client_id, mudouColuna, req.params.id]);
  res.json(p);
}));

app.delete('/api/pautas/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM pautas_home WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Agente de conteúdo ----------
require('./agente')(app, { pool, wrap });

// ---------- Projetos, equipe de agentes, mensagens e empregos ----------
const projetos = require('./projetos');
projetos(app, { pool, wrap, soAdmin });
projetos.webhook(app, { pool, wrap });
require('./integracoes').registrar(app, { pool, wrap, soAdmin });
require('./esteira').registrar(app, { pool, wrap });
require('./campanhas').registrar(app, { pool, wrap, soAdmin });
saas.registrar(app, { pool, wrap, soAdmin, gerarConvite, suporte });
require('./midia').registrar(app, { pool, wrap });
require('./google').registrar(app, { pool, wrap });
require('./midia').registrarPublico(app, { pool, wrap });
require('./relatorios').registrar(app, { pool, wrap });
const solic = require('./solicitacoes');
solic.registrar(app, { pool, wrap, soAdmin });
solic.registrarPublico(app, { pool, wrap });
require('./comandos').registrar(app, { pool, wrap });
require('./blog').registrar(app, { pool, wrap, soAdmin });

// ---------- Backup ----------
app.get('/api/backup', wrap(async (req, res) => {
  const [c, t, m, l, p] = await Promise.all(['clients', 'tasks', 'materials', 'links', 'pautas_home']
    .map((tb) => pool.query(`SELECT * FROM ${tb} ORDER BY id`)));
  res.setHeader('Content-Disposition', `attachment; filename="por-boas-historias-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ versao: 1, gerado_em: new Date().toISOString(), clients: c.rows, tasks: t.rows, materials: m.rows, links: l.rows, pautas: p.rows });
}));

app.post('/api/restaurar', soAdmin, wrap(async (req, res) => {
  const b = req.body;
  if (!b || !Array.isArray(b.clients) || !Array.isArray(b.tasks)) return res.status(400).json({ erro: 'Arquivo de backup inválido' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Acessos e experiências não vão no backup: guarda antes e devolve depois (mesmos ids de cliente)
    const { rows: acessosAntes } = await c.query('SELECT * FROM acessos');
    const { rows: expAntes } = await c.query('SELECT * FROM experiencias');
    const { rows: linksAntes } = await c.query('SELECT * FROM links');
    const { rows: contextoAntes } = await c.query('SELECT * FROM contexto_cliente');
    const { rows: geradosAntes } = await c.query('SELECT * FROM conteudos_gerados');
    const { rows: pautasAntes } = await c.query('SELECT * FROM pautas_home');
    await c.query('TRUNCATE materials, tasks, clients RESTART IDENTITY CASCADE');
    const restore = async (tb, rows) => {
      for (const r of rows) {
        const cols = Object.keys(r);
        await c.query(`INSERT INTO ${tb} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
          cols.map((k) => (r[k] !== null && typeof r[k] === 'object' && !(r[k] instanceof Date) ? JSON.stringify(r[k]) : r[k])));
      }
      if (tb === 'contexto_cliente') return; // chave é client_id, sem sequência
      await c.query(`SELECT setval(pg_get_serial_sequence('${tb}','id'), GREATEST((SELECT max(id) FROM ${tb}),1))`);
    };
    await restore('clients', b.clients);
    await restore('tasks', b.tasks);
    await restore('materials', b.materials || []);
    await restore('links', Array.isArray(b.links) ? b.links : linksAntes.filter((x) => new Set(b.clients.map((y) => y.id)).has(x.client_id)));
    const ids = new Set(b.clients.map((x) => x.id));
    const tarefas = new Set(b.tasks.map((x) => x.id));
    await restore('acessos', acessosAntes.filter((a) => ids.has(a.client_id)));
    await restore('experiencias', expAntes.filter((e) => ids.has(e.client_id))
      .map((e) => ({ ...e, task_id: tarefas.has(e.task_id) ? e.task_id : null })));
    await restore('pautas_home', (Array.isArray(b.pautas) ? b.pautas : pautasAntes).filter((x) => ids.has(x.client_id)));
    await restore('contexto_cliente', contextoAntes.filter((x) => ids.has(x.client_id)));
    await restore('conteudos_gerados', geradosAntes.filter((x) => ids.has(x.client_id))
      .map((x) => ({ ...x, task_id: tarefas.has(x.task_id) ? x.task_id : null })));
    await c.query('COMMIT');
    res.json({ ok: true, clientes: b.clients.length, tarefas: b.tasks.length });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

// Erros de leitura do corpo (arquivo grande demais, JSON quebrado): resposta limpa, sem detalhes internos
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const grande = err.type === 'entity.too.large';
  res.status(grande ? 413 : (err.status || 500)).json({ erro: grande ? 'O arquivo é grande demais (máximo de 3,5 MB)' : 'Requisição inválida' });
});

// ---------- Interface ----------
// Site de vendas da MidIAut (raiz /, com planos R$ 370 / 760 / 950 + pacote BI); os endereços antigos continuam apontando para ele
require('./blog').registrarPublico(app, { pool, wrap });
// A página de vendas sai com endereços absolutos (canonical, og:url, og:image) e o FAQ também em dados estruturados, para o Google e as redes sociais
const cssVendas = fs.readFileSync(path.join(__dirname, 'public', 'midiaut.css'), 'utf8');
const htmlVendas = fs.readFileSync(path.join(__dirname, 'public', 'midiaut.html'), 'utf8')
  .replace('<link rel="stylesheet" href="/midiaut.css">', () => `<style>${cssVendas}</style>`); // CSS dentro do HTML: a página pinta sem esperar outro arquivo
const faqVendas = [...htmlVendas.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map((m) => ({ '@type': 'Question', name: m[1].replace(/<[^>]+>/g, ''), acceptedAnswer: { '@type': 'Answer', text: m[2].replace(/<[^>]+>/g, '') } }));
const paginaVendas = (req, res) => {
  const base = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const dados = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqVendas }, { '@context': 'https://schema.org', '@type': 'Organization', name: 'MidIAut', url: `${base}/`, logo: `${base}/brand/midiaut/icone-512.png` }, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'MidIAut', url: `${base}/`, inLanguage: 'pt-BR' }];
  res.type('html').send(htmlVendas.replaceAll('{{BASE}}', base).replace('</head>', `<script type="application/ld+json">${JSON.stringify(dados).replace(/</g, '\\u003c')}</script>\n</head>`));
};
// ---- Descoberta por agentes de IA: /llms.txt (resumo em Markdown) e manifesto ARD (/.well-known/ard.json) ----
const baseDoPedido = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
app.get('/llms.txt', (req, res) => {
  const b = baseDoPedido(req);
  res.type('text/markdown; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(`# MidIAut

> MidIAut é uma plataforma brasileira de gestão de tráfego pago com IA. Ela monta campanhas de Meta Ads (Facebook e Instagram) e Google Ads a partir de uma descrição em linguagem natural; a pessoa revisa tudo e decide quando ativar. Nenhuma campanha vai ao ar sem aprovação.

## Para começar

- [Página inicial](${b}/): visão geral, funcionalidades, planos e perguntas frequentes.
- [Criar conta grátis ou entrar](${b}/entrar): o plano Grátis não exige cartão.
- [Blog](${b}/blog): artigos sobre tráfego pago, Google Ads e Meta Ads com IA.

## O que a MidIAut faz

- Cria rascunhos de campanha no Meta Ads e no Google Ads com IA; as campanhas nascem pausadas e só são ativadas pela pessoa.
- Valida a configuração antes de criar e aponta pendências.
- Mostra investimento, impressões, cliques e conversões dos últimos sete dias, conforme os dados das contas conectadas.
- Atende empresários que anunciam por conta própria, gestores de tráfego com vários clientes e agências.

## Planos (valores em reais, por mês)

- Grátis: R$ 0, 1 campanha por mês e 3 rascunhos com IA.
- Solo: R$ 370, 10 campanhas por mês.
- Agência: R$ 760, 3 clientes e 30 campanhas por mês.
- Escala: R$ 950, 5 clientes e 50 campanhas por mês.
- Pacote de BI: R$ 50 por mês, opcional em qualquer plano.
- Teste de 7 dias sem cartão nos planos pagos.

## Descoberta

- [Mapa do site](${b}/sitemap.xml)
- [Manifesto ARD](${b}/.well-known/ard.json)
`);
});
const manifestoARD = (req) => ({
  specVersion: '1.0',
  host: { displayName: 'MidIAut', identifier: 'midiaut.space' },
  entries: [{
    identifier: 'urn:air:midiaut.space:docs:visao-geral',
    displayName: 'MidIAut: visão geral, funcionalidades e planos',
    description: 'Resumo em Markdown da plataforma de gestão de tráfego pago com IA (Meta Ads e Google Ads), com links e planos.',
    type: 'text/markdown',
    url: `${baseDoPedido(req)}/llms.txt`,
    representativeQueries: [
      'ferramenta de IA para criar campanhas no Meta Ads e Google Ads',
      'quanto custa uma plataforma de gestão de tráfego pago com IA',
      'software para gestor de tráfego atender vários clientes',
    ],
  }],
});
app.get(['/.well-known/ard.json', '/.well-known/ai-catalog.json'], (req, res) => res.type('application/json').set('Cache-Control', 'public, max-age=3600').json(manifestoARD(req)));
app.get('/midiaut', (req, res) => res.redirect(301, '/'));
// A raiz do site é a página de vendas; o painel interno fica em /sistema (convites antigos com ?convite= continuam abrindo o painel)
// Verificação leve para monitor externo (mantém o plano grátis do Render acordado). Não toca no banco.
app.get('/health', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true }); });
app.get('/', (req, res, next) => (req.query.convite ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : paginaVendas(req, res, next)));
app.get(['/midiaut.html', '/gestoragent', '/gestoragente', '/assinar', '/agente', '/agente-de-trafego'], (req, res) => res.redirect(301, '/'));
app.get(['/cadastro', '/entrar'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/assinante', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assinante.html')));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, arq) => { // imagens, vídeo e fontes ficam em cache por 7 dias; HTML, CSS e JS sempre revalidam (304 barato)
    if (/\.(png|jpe?g|webp|svg|ico|mp4|woff2?|ttf)$/i.test(arq)) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));
app.get(/^\/.well-known\/|\.[a-z0-9]{2,5}$/i, (req, res) => res.status(404).type('text/plain').send('Não encontrado')); // arquivo inexistente: 404 de verdade, não a página do painel
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
init()
  .then(() => pool.query("UPDATE users SET papel='admin', ativo=true WHERE lower(email)=$1 AND papel<>'assinante' AND (papel<>'admin' OR NOT ativo)", [SUPER_ADMIN]))
  .then(() => require('./config').carregar(pool))
  .then(() => require('./blog').semear(pool))
  .then(() => app.listen(PORT, () => { console.log(`A Melhor Mídia do Brasil rodando na porta ${PORT}`); require('./esteira').iniciarAgendador(pool); }))
  .catch((e) => { console.error('Falha ao iniciar o banco:', e); process.exit(1); });
