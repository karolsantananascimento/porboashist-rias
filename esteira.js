// Esteira de produção: demanda -> time executa (Hugo, Luiz, Davi, Camila) -> aguarda aprovação -> aprovada -> publicação.
// Nada é publicado sem a aprovação e sem o clique de confirmação na tela de publicação.

const { cfg } = require('./config');
const MARCA_ARTE = '— ARTE (Luiz) —';
const MARCA_TIME = '— PLANO (Camila) —';
const texto = (v, max = 12000) => String(v ?? '').slice(0, max);

const FORMATO_HUGO = (t) => {
  if (t.tipo === 'blog') return 'Artigo de blog (SEO)';
  if (t.tipo === 'story') return 'Roteiro de stories';
  if (/carrossel/i.test(t.formato || '')) return 'Carrossel';
  if (/reels|v[ií]deo/i.test(t.formato || '')) return 'Roteiro de reels';
  return 'Post de feed (legenda + briefing)';
};
const FORMATO_LUIZ = (t) => (/stor|reels/i.test(`${t.tipo} ${t.formato || ''}`) ? 'Arte de stories/reels (1080x1920)' : /carrossel/i.test(t.formato || '') ? 'Capa de carrossel + lâminas' : 'Arte de feed (1080x1350)');

async function marcar(pool, id, esteira, msg) {
  await pool.query('UPDATE tasks SET esteira=$1, esteira_msg=$2, esteira_em=now(), updated_at=now() WHERE id=$3', [esteira, msg, id]);
}

// Roda o time sobre a tarefa. Não lança erro: registra em esteira/esteira_msg.
async function executar(pool, taskId, { ajuste, usuario } = {}) {
  const { chamarTexto, blocoContexto, AGENTES, REGRAS } = require('./projetos');
  try {
    if (!cfg('ANTHROPIC_API_KEY')) throw new Error('Os agentes não estão ativos: falta a chave do Claude em Integrações.');
    const { rows: [t] } = await pool.query('SELECT t.*, c.project_id FROM tasks t JOIN clients c ON c.id=t.client_id WHERE t.id=$1', [taskId]);
    if (!t) return;
    const chamar = async (agId, formato, pedido, anterior) => {
      const ag = AGENTES[agId];
      const ctx = await blocoContexto(pool, t.project_id, t.client_id, agId);
      const saida = await chamarTexto({
        system: `${ag.instrucoes}\n\n${REGRAS}`,
        user: `${ctx}\n\nFORMATO: ${formato}\nDATA/PRAZO: ${t.data ? String(t.data).slice(0, 10) : 'não definido'}\n\nPEDIDO:\n${pedido}${ajuste ? `\n\nAJUSTES PEDIDOS PELA EQUIPE (aplique na nova versão):\n${ajuste}` : ''}${anterior ? `\n\nVERSÃO ANTERIOR:\n${texto(anterior, 6000)}` : ''}\n\nTermine com a seção "Conferir antes de usar".`,
        maxTokens: 4000,
      });
      await pool.query(`INSERT INTO criacoes (project_id, client_id, agente, formato, pedido, saida, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,NULL)`,
        [t.project_id, t.client_id, agId, formato, texto(pedido, 4000), saida]);
      return saida;
    };
    const pedido = `${t.tema || ''}\n\n${(t.briefing || '').split(MARCA_ARTE)[0].split(MARCA_TIME)[0].trim()}`.trim();
    const limpo = (t.briefing || '').split(MARCA_ARTE)[0].split(MARCA_TIME)[0].trim();

    if (t.tipo === 'trafego') {
      await marcar(pool, t.id, 'executando', 'Camila montando o plano da campanha…');
      const plano = await chamar('camila', t.formato || 'Campanha Meta Ads', pedido, /PLANO \(Camila\)/.test(t.briefing || '') ? t.briefing : null);
      await pool.query('UPDATE tasks SET briefing=$1 WHERE id=$2', [`${limpo}\n\n${MARCA_TIME}\n${plano}`.trim(), t.id]);
    } else if (t.tipo === 'criacao') {
      const ag = t.responsavel === 'Davi' ? 'davi' : 'luiz';
      await marcar(pool, t.id, 'executando', `${AGENTES[ag].nome} trabalhando na peça…`);
      const out = await chamar(ag, ag === 'davi' ? 'Reels / TikTok (até 60s)' : FORMATO_LUIZ(t), pedido, /ARTE \(Luiz\)/.test(t.briefing || '') ? t.briefing : null);
      await pool.query('UPDATE tasks SET briefing=$1 WHERE id=$2', [`${limpo}\n\n${MARCA_ARTE}\n${out}`.trim(), t.id]);
    } else {
      await marcar(pool, t.id, 'executando', 'Hugo escrevendo o conteúdo…');
      const texto1 = await chamar('hugo', FORMATO_HUGO(t), pedido, t.legenda || null);
      if (t.tipo === 'story') await pool.query('UPDATE tasks SET briefing=$1 WHERE id=$2', [`${limpo}\n\n— ROTEIRO (Hugo) —\n${texto1}`.trim(), t.id]);
      else await pool.query('UPDATE tasks SET legenda=$1 WHERE id=$2', [texto1, t.id]);
      if (t.tipo !== 'blog') {
        await marcar(pool, t.id, 'executando', 'Luiz criando a direção de arte…');
        const arte = await chamar('luiz', FORMATO_LUIZ(t), `${pedido}\n\nTEXTO DO CONTEÚDO (Hugo):\n${texto(texto1, 3000)}`, /ARTE \(Luiz\)/.test(t.briefing || '') ? t.briefing : null);
        const atual = (await pool.query('SELECT briefing FROM tasks WHERE id=$1', [t.id])).rows[0].briefing || '';
        await pool.query('UPDATE tasks SET briefing=$1 WHERE id=$2', [`${atual.split(MARCA_ARTE)[0].trim()}\n\n${MARCA_ARTE}\n${arte}`.trim(), t.id]);
      }
    }
    await pool.query(`UPDATE tasks SET status='aprovacao', esteira='aguardando_aprovacao', esteira_msg='Pronto para a sua aprovação', esteira_em=now(), updated_at=now() WHERE id=$1`, [t.id]);
  } catch (e) {
    console.error('Esteira falhou:', e.message);
    await marcar(pool, taskId, 'erro', e.message || 'Falha ao executar').catch(() => {});
  }
}

function registrar(app, { pool, wrap }) {
  // Fila: tarefas em execução, aguardando aprovação, com erro ou aprovadas e ainda não publicadas
  app.get('/api/esteira', wrap(async (req, res) => {
    await pool.query(`UPDATE tasks SET esteira='erro', esteira_msg='A execução demorou demais. Tente de novo.' WHERE esteira='executando' AND esteira_em < now() - interval '10 minutes'`);
    const w = []; const v = [];
    if (req.query.client_id) { v.push(req.query.client_id); w.push(`t.client_id=$${v.length}`); }
    else if (req.query.project_id) { v.push(req.query.project_id); w.push(`c.project_id=$${v.length}`); }
    const { rows } = await pool.query(
      `SELECT t.*, c.nome AS cliente_nome, c.project_id FROM tasks t JOIN clients c ON c.id=t.client_id
       WHERE t.esteira IN ('executando','aguardando_aprovacao','erro','aprovada') ${w.length ? 'AND ' + w.join(' AND ') : ''}
       ORDER BY (t.esteira='aguardando_aprovacao') DESC, t.esteira_em DESC LIMIT 40`, v);
    res.json(rows);
  }));

  // Pede ajustes e roda o time de novo
  app.post('/api/tasks/:id/ajustar', wrap(async (req, res) => {
    const ajuste = texto(req.body.ajuste, 2000).trim();
    if (!ajuste) return res.status(400).json({ erro: 'Diga o que ajustar' });
    const { rows: [t] } = await pool.query('SELECT id FROM tasks WHERE id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    await marcar(pool, t.id, 'executando', 'Time aplicando os ajustes…');
    executar(pool, t.id, { ajuste, usuario: req.user.email });
    res.json({ ok: true });
  }));

  app.post('/api/tasks/:id/executar', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query('SELECT id FROM tasks WHERE id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    await marcar(pool, t.id, 'executando', 'Time começando…');
    executar(pool, t.id, { usuario: req.user.email });
    res.json({ ok: true });
  }));

  // Aprovação: segue para publicação (agendado). A publicação em si é confirmada na tela.
  app.post('/api/tasks/:id/aprovar', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `UPDATE tasks SET status='agendado', esteira='aprovada', esteira_msg='Aprovada: pronta para publicar', esteira_em=now(),
         aprovado_por=$1, aprovado_em=now(), updated_at=now()
       WHERE id=$2 AND esteira='aguardando_aprovacao' RETURNING *`, [req.user.nome || req.user.email, req.params.id]);
    if (!t) return res.status(400).json({ erro: 'Esta tarefa não está aguardando aprovação' });
    res.json(t);
  }));

  // Marca como publicada manualmente (conteúdo publicado fora do sistema, campanha no ar, arte entregue)
  app.post('/api/tasks/:id/concluir', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg='Concluída', esteira_em=now(), updated_at=now()
       WHERE id=$1 AND esteira='aprovada' RETURNING *`, [req.params.id]);
    if (!t) return res.status(400).json({ erro: 'A tarefa precisa estar aprovada' });
    res.json(t);
  }));
}

module.exports = { registrar, executar };
