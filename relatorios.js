// Relatórios automáticos por período: números do que foi planejado, aprovado, publicado e pedido,
// com um resumo escrito pela IA (quando a chave estiver ativa) ou por regra simples.

const { cfg } = require('./config');
const dataOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const contar = (rows, chave) => Object.fromEntries(rows.map((r) => [r[chave] || 'outro', r.n]));

async function gerar(pool, { project_id, client_id, de, ate }) {
  const { rows: clientes } = client_id
    ? await pool.query('SELECT id, nome, meta_posts FROM clients WHERE id=$1', [client_id])
    : await pool.query('SELECT id, nome, meta_posts FROM clients WHERE project_id=$1 ORDER BY nome', [project_id]);
  const ids = clientes.map((c) => c.id);
  if (!ids.length) return null;
  const { rows: [proj] } = await pool.query('SELECT nome FROM projects WHERE id=$1', [project_id]);
  const naoPlaceholder = `NOT (t.tipo='story' AND t.legenda IS NULL AND t.briefing IS NULL)`;
  const ref = 'COALESCE(t.data, t.created_at::date)'; // pauta sem data conta pela data em que foi criada
  const base = `FROM tasks t WHERE t.client_id = ANY($1) AND ${ref} BETWEEN $2 AND $3 AND ${naoPlaceholder}`;
  const q = (sql, extra = []) => pool.query(sql, [ids, de, ate, ...extra]).then((r) => r.rows);

  const [porTipo, porStatus, [tot], atrasadas, publicadasPosts, entregas, aprovadas, esteiraAgora, sol, solStatus, criacoes] = await Promise.all([
    q(`SELECT t.tipo, count(*)::int n ${base} GROUP BY 1`),
    q(`SELECT t.status, count(*)::int n ${base} GROUP BY 1`),
    q(`SELECT count(*)::int total, count(*) FILTER (WHERE t.status='publicado')::int publicadas ${base}`),
    q(`SELECT count(*)::int n ${base} AND t.tipo<>'story' AND t.data < current_date AND t.status<>'publicado'`),
    q(`SELECT t.client_id, count(*)::int n ${base} AND t.tipo='post' AND t.status='publicado' GROUP BY 1`),
    q(`SELECT t.id, t.tema, t.tipo, t.formato, ${ref} AS data, t.status, t.esteira, c.nome AS cliente FROM tasks t JOIN clients c ON c.id=t.client_id
       WHERE t.client_id = ANY($1) AND ${ref} BETWEEN $2 AND $3 AND ${naoPlaceholder} ORDER BY ${ref}, t.id LIMIT 40`),
    pool.query(`SELECT count(*)::int n FROM tasks WHERE client_id = ANY($1) AND aprovado_em::date BETWEEN $2 AND $3`, [ids, de, ate]).then((r) => r.rows),
    pool.query(`SELECT esteira, count(*)::int n FROM tasks WHERE client_id = ANY($1) AND esteira IN ('executando','aguardando_aprovacao','aprovada') GROUP BY 1`, [ids]).then((r) => r.rows),
    pool.query(`SELECT count(*)::int n FROM solicitacoes WHERE (client_id = ANY($1) OR (client_id IS NULL AND project_id=$4)) AND created_at::date BETWEEN $2 AND $3`, [ids, de, ate, project_id]).then((r) => r.rows),
    pool.query(`SELECT status, count(*)::int n FROM solicitacoes WHERE (client_id = ANY($1) OR (client_id IS NULL AND project_id=$4)) AND created_at::date BETWEEN $2 AND $3 GROUP BY 1`, [ids, de, ate, project_id]).then((r) => r.rows),
    pool.query(`SELECT agente, count(*)::int n FROM criacoes WHERE (client_id = ANY($1) OR (client_id IS NULL AND project_id=$4)) AND created_at::date BETWEEN $2 AND $3 GROUP BY 1`, [ids, de, ate, project_id]).then((r) => r.rows),
  ]);
  const { rows: redes } = await pool.query(
    `SELECT plataforma, status, count(*)::int n FROM publicacoes WHERE created_at::date BETWEEN $1 AND $2 GROUP BY 1,2`, [de, ate]);
  const postsPub = Object.fromEntries(publicadasPosts.map((r) => [r.client_id, r.n]));

  const dados = {
    escopo: client_id ? clientes[0].nome : (proj ? proj.nome : 'Projeto'),
    periodo: { de, ate },
    planejado: { total: tot.total, publicadas: tot.publicadas, atrasadas: atrasadas[0].n, por_tipo: contar(porTipo, 'tipo'), por_status: contar(porStatus, 'status') },
    esteira: { aprovadas_no_periodo: aprovadas[0].n, agora: contar(esteiraAgora, 'esteira') },
    solicitacoes: { recebidas: sol[0].n, por_status: contar(solStatus, 'status') },
    time: contar(criacoes, 'agente'),
    redes: redes.map((r) => ({ plataforma: r.plataforma, status: r.status, n: r.n })),
    clientes: clientes.map((c) => ({ nome: c.nome, meta_posts_mes: c.meta_posts, posts_publicados: postsPub[c.id] || 0 })),
    entregas: entregas.map((e) => ({ tema: e.tema, cliente: e.cliente, tipo: e.tipo, formato: e.formato, data: e.data, status: e.status })),
  };
  return dados;
}

// Resumo por regra simples (sem IA)
function resumoSimples(d) {
  const p = d.planejado; const linhas = [];
  linhas.push(`No período, ${p.total} entregas estavam planejadas para ${d.escopo}; ${p.publicadas} foram publicadas.`);
  if (p.atrasadas) linhas.push(`${p.atrasadas} entregas estão atrasadas (data passada e ainda não publicadas).`);
  const ag = d.esteira.agora.aguardando_aprovacao || 0;
  if (ag) linhas.push(`${ag} entregas aguardam aprovação agora.`);
  if (d.esteira.aprovadas_no_periodo) linhas.push(`${d.esteira.aprovadas_no_periodo} entregas foram aprovadas no período.`);
  if (d.solicitacoes.recebidas) linhas.push(`${d.solicitacoes.recebidas} solicitações recebidas.`);
  return linhas.join(' ');
}

function registrar(app, { pool, wrap }) {
  app.post('/api/relatorios', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.project_id) return res.status(400).json({ erro: 'Escolha o projeto' });
    if (!dataOk(b.de) || !dataOk(b.ate) || b.de > b.ate) return res.status(400).json({ erro: 'Período inválido' });
    if ((Date.parse(b.ate) - Date.parse(b.de)) / 86400000 > 366) return res.status(400).json({ erro: 'O período pode ter no máximo 1 ano' });
    const dados = await gerar(pool, { project_id: Number(b.project_id), client_id: b.client_id ? Number(b.client_id) : null, de: b.de, ate: b.ate });
    if (!dados) return res.status(400).json({ erro: 'Este projeto ainda não tem clientes' });

    let resumo = resumoSimples(dados); let ia = false;
    if (cfg('ANTHROPIC_API_KEY')) {
      try {
        const { chamarTexto } = require('./projetos');
        resumo = await chamarTexto({
          system: 'Você escreve o resumo executivo de um relatório de marketing de agência, em português do Brasil, em 6 a 10 linhas corridas (sem tabelas). Use SOMENTE os números fornecidos; nunca invente resultados, alcance, engajamento ou vendas (esses dados não existem aqui). Destaque o que foi entregue, gargalos (atrasos, aprovações pendentes) e 3 próximos passos objetivos.',
          user: JSON.stringify(dados), maxTokens: 900, timeoutMs: 45000,
        });
        ia = true;
      } catch (e) { console.warn('Relatório sem IA:', e.message); }
    }
    const { rows: [r] } = await pool.query(
      `INSERT INTO relatorios (project_id, client_id, de, ate, dados, resumo, usuario) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.project_id, b.client_id || null, b.de, b.ate, JSON.stringify(dados), resumo, req.user.nome || req.user.email]);
    res.json({ ...r, ia });
  }));

  app.get('/api/relatorios', wrap(async (req, res) => {
    const w = []; const v = [];
    if (req.query.client_id) { v.push(req.query.client_id); w.push(`client_id=$${v.length}`); }
    else if (req.query.project_id) { v.push(req.query.project_id); w.push(`project_id=$${v.length}`); }
    const { rows } = await pool.query(`SELECT * FROM relatorios ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 15`, v);
    res.json(rows);
  }));

  app.delete('/api/relatorios/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM relatorios WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));
}

module.exports = { registrar, gerar };
