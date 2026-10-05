const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { pool, init, STATUSES, BLOG_CHECKLIST } = require('./db');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---------- Acesso com senha única da equipe ----------
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const token = () => crypto.createHmac('sha256', SECRET).update('pbh:' + PASSWORD).digest('hex');
const COOKIE = 'pbh_sessao';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const authed = (req) => !PASSWORD || getCookie(req, COOKIE) === token();

app.post('/api/login', (req, res) => {
  const ok = PASSWORD && typeof req.body.senha === 'string' &&
    req.body.senha.length === PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(req.body.senha), Buffer.from(PASSWORD));
  if (!PASSWORD || ok) {
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
    return res.json({ ok: true });
  }
  res.status(401).json({ erro: 'Senha incorreta' });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/api/sessao', (req, res) => res.json({ autenticado: authed(req), protegido: !!PASSWORD }));
app.get('/healthz', (req, res) => res.send('ok'));

app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ erro: 'Não autenticado' })));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ erro: e.message });
});

// ---------- Clientes ----------
const CLIENT_FIELDS = ['nome', 'marcas', 'site', 'whatsapp', 'instagram', 'meta_posts', 'meta_stories_dia', 'meta_blog', 'observacoes'];

app.get('/api/clients', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY nome');
  res.json(rows);
}));

app.post('/api/clients', wrap(async (req, res) => {
  const b = req.body;
  if (!b.nome) return res.status(400).json({ erro: 'Informe o nome do cliente' });
  const { rows } = await pool.query(
    `INSERT INTO clients (nome, marcas, site, whatsapp, instagram, meta_posts, meta_stories_dia, meta_blog, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.nome, JSON.stringify(b.marcas || []), b.site, b.whatsapp, b.instagram,
      b.meta_posts ?? 12, b.meta_stories_dia ?? 1, b.meta_blog ?? 4, b.observacoes]
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

app.delete('/api/clients/:id', wrap(async (req, res) => {
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
  'status', 'responsavel', 'prioridade', 'palavra_chave', 'checklist'];

function clean(f, v) {
  if (f === 'checklist') return JSON.stringify(Array.isArray(v) ? v : []);
  if (f === 'status' && !STATUSES.includes(v)) return 'pauta';
  return v === '' ? null : v;
}

app.get('/api/tasks', wrap(async (req, res) => {
  const where = []; const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', '$' + vals.length)); };
  if (req.query.client_id) add('client_id=?', req.query.client_id);
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

// ---------- Materiais (fotos e vídeos) ----------
app.get('/api/materials', wrap(async (req, res) => {
  const { rows } = req.query.client_id
    ? await pool.query('SELECT * FROM materials WHERE client_id=$1 ORDER BY categoria, id', [req.query.client_id])
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

// ---------- Backup ----------
app.get('/api/backup', wrap(async (req, res) => {
  const [c, t, m] = await Promise.all(['clients', 'tasks', 'materials']
    .map((tb) => pool.query(`SELECT * FROM ${tb} ORDER BY id`)));
  res.setHeader('Content-Disposition', `attachment; filename="por-boas-historias-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ versao: 1, gerado_em: new Date().toISOString(), clients: c.rows, tasks: t.rows, materials: m.rows });
}));

app.post('/api/restaurar', wrap(async (req, res) => {
  const b = req.body;
  if (!b || !Array.isArray(b.clients) || !Array.isArray(b.tasks)) return res.status(400).json({ erro: 'Arquivo de backup inválido' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE materials, tasks, clients RESTART IDENTITY CASCADE');
    const restore = async (tb, rows) => {
      for (const r of rows) {
        const cols = Object.keys(r);
        await c.query(`INSERT INTO ${tb} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
          cols.map((k) => (r[k] !== null && typeof r[k] === 'object' && !(r[k] instanceof Date) ? JSON.stringify(r[k]) : r[k])));
      }
      await c.query(`SELECT setval(pg_get_serial_sequence('${tb}','id'), GREATEST((SELECT max(id) FROM ${tb}),1))`);
    };
    await restore('clients', b.clients);
    await restore('tasks', b.tasks);
    await restore('materials', b.materials || []);
    await c.query('COMMIT');
    res.json({ ok: true, clientes: b.clients.length, tarefas: b.tasks.length });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

// ---------- Interface ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log(`Por Boas Histórias rodando na porta ${PORT}`)))
  .catch((e) => { console.error('Falha ao iniciar o banco:', e); process.exit(1); });
