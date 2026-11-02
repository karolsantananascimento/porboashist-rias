// Esteira de produção por papel:
//   1. Conteudista (Hugo) pesquisa, planeja e escreve a legenda + o briefing do criativo
//   2. Head de Criação (Luiz para arte/carrossel, Davi para vídeo/motion) cria a peça — opcional em texto de LinkedIn/Reddit/blog
//   3. Aprovação humana (botão)
//   4. Social media (Lara): agenda (o agendador publica no horário) ou publica na hora quando a pessoa clica em "Publicar agora"
// Nada vai ao ar sem a aprovação humana: agendar ou publicar exige o clique de uma pessoa.

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

const SO_TEXTO = /linkedin|reddit|texto livre|artigo|thread/i;
// A criação é opcional em texto de LinkedIn/Reddit e blog, a menos que o pedido peça arte ou vídeo
function precisaCriacao(t) {
  if (t.tipo === 'blog') return false;
  const alvo = `${t.formato || ''} ${t.tema || ''}`;
  const pedeArte = /\b(arte|imagem|criativo|carrossel|v[ií]deo|reels|motion|thumbnail)\b/i.test(`${t.tema || ''} ${t.briefing || ''}`);
  if (SO_TEXTO.test(alvo) && !pedeArte) return false;
  return true;
}
const VIDEO_MOTION = /reels|v[ií]deo|motion|anima[cç][aã]o/i;

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
      await marcar(pool, t.id, 'executando', 'Hugo (Conteudista) pesquisando, planejando e escrevendo…');
      const texto1 = await chamar('hugo', FORMATO_HUGO(t), pedido, t.legenda || null);
      if (t.tipo === 'story') await pool.query('UPDATE tasks SET briefing=$1 WHERE id=$2', [`${limpo}\n\n— ROTEIRO (Hugo) —\n${texto1}`.trim(), t.id]);
      else await pool.query('UPDATE tasks SET legenda=$1 WHERE id=$2', [texto1, t.id]);
      if (precisaCriacao(t)) {
        const video = VIDEO_MOTION.test(`${t.formato || ''} ${t.tipo || ''}`);
        const ag = video ? 'davi' : 'luiz';
        await marcar(pool, t.id, 'executando', `${AGENTES[ag].nome} (Head de Criação) criando ${video ? 'o vídeo/motion' : 'a peça'}…`);
        const arte = await chamar(ag, video ? 'Reels / TikTok (até 60s)' : FORMATO_LUIZ(t), `${pedido}\n\nTEXTO E BRIEFING DO CRIATIVO (Hugo):\n${texto(texto1, 3500)}`, /ARTE \(Luiz\)/.test(t.briefing || '') ? t.briefing : null);
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
       WHERE t.esteira IN ('executando','aguardando_aprovacao','erro','aprovada','agendada','publicando') ${w.length ? 'AND ' + w.join(' AND ') : ''}
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

  // Aprovação humana. Sem corpo: só aprova (a publicação é feita depois, com o botão "Publicar agora").
  // Com modo 'agendar': aprova e passa para a Social media agendar (o agendador publica no horário escolhido).
  app.post('/api/tasks/:id/aprovar', wrap(async (req, res) => {
    const b = req.body || {};
    const por = req.user.nome || req.user.email;
    if (b.modo === 'agendar') {
      const alvos = (Array.isArray(b.plataformas) ? b.plataformas : []).filter((p) => ['facebook', 'instagram', 'linkedin'].includes(p));
      const txt = String(b.texto || '').trim().slice(0, 3000);
      const imagem = String(b.imagem_url || '').trim();
      const quando = new Date(b.agendar_para);
      if (!alvos.length) return res.status(400).json({ erro: 'Escolha onde publicar' });
      if (!txt) return res.status(400).json({ erro: 'Escreva o texto da publicação' });
      if (Number.isNaN(quando.getTime()) || quando.getTime() < Date.now() + 60000) return res.status(400).json({ erro: 'Escolha um horário no futuro' });
      if (imagem && !/^https:\/\/\S+$/i.test(imagem)) return res.status(400).json({ erro: 'O link da imagem precisa começar com https://' });
      if (alvos.includes('instagram') && !imagem) return res.status(400).json({ erro: 'O Instagram exige uma imagem (link https://)' });
      const { rows: [t0] } = await pool.query(`SELECT client_id FROM tasks WHERE id=$1 AND esteira='aguardando_aprovacao'`, [req.params.id]);
      if (!t0) return res.status(400).json({ erro: 'Esta tarefa não está aguardando aprovação' });
      const { lerConexao } = require('./integracoes');
      const meta = alvos.some((p) => p !== 'linkedin') ? await lerConexao(pool, 'meta', t0.client_id) : true;
      const li = alvos.includes('linkedin') ? await lerConexao(pool, 'linkedin', t0.client_id) : true;
      if (!meta || !li) return res.status(400).json({ erro: 'Uma das redes escolhidas não está conectada para este cliente (Acessos e APIs)' });
      const { rows: [t] } = await pool.query(
        `UPDATE tasks SET status='agendado', esteira='agendada', esteira_msg=$1, esteira_em=now(), agendada_para=$2, plataformas=$3,
           publicar_texto=$4, publicar_imagem=$5, aprovado_por=$6, aprovado_em=now(), updated_at=now()
         WHERE id=$7 AND esteira='aguardando_aprovacao' RETURNING *`,
        [`Lara agendou para ${quando.toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' })}`, quando.toISOString(), alvos.join(','), txt, imagem || null, por, req.params.id]);
      if (!t) return res.status(400).json({ erro: 'Esta tarefa não está aguardando aprovação' });
      return res.json(t);
    }
    const { rows: [t] } = await pool.query(
      `UPDATE tasks SET status='agendado', esteira='aprovada', esteira_msg='Aprovada: pronta para publicar', esteira_em=now(),
         aprovado_por=$1, aprovado_em=now(), updated_at=now()
       WHERE id=$2 AND esteira='aguardando_aprovacao' RETURNING *`, [por, req.params.id]);
    if (!t) return res.status(400).json({ erro: 'Esta tarefa não está aguardando aprovação' });
    res.json(t);
  }));

  // Cancela o agendamento: volta para "aprovada" (dá para publicar na hora ou reagendar pelo botão Publicar)
  app.post('/api/tasks/:id/desagendar', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `UPDATE tasks SET esteira='aprovada', esteira_msg='Agendamento cancelado: pronta para publicar', esteira_em=now(), agendada_para=NULL, updated_at=now()
       WHERE id=$1 AND esteira='agendada' RETURNING *`, [req.params.id]);
    if (!t) return res.status(400).json({ erro: 'Esta tarefa não está agendada' });
    res.json(t);
  }));

  // Lara (social media) sugere texto final por rede e o melhor horário. Só sugere: quem decide é a pessoa.
  app.post('/api/tasks/:id/social-sugestao', wrap(async (req, res) => {
    const { chamarTexto, blocoContexto, AGENTES, REGRAS } = require('./projetos');
    const { rows: [t] } = await pool.query('SELECT t.*, c.project_id FROM tasks t JOIN clients c ON c.id=t.client_id WHERE t.id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    const ctx = await blocoContexto(pool, t.project_id, t.client_id, 'lara');
    const redes = String(req.body?.plataformas || 'instagram').slice(0, 80);
    const saida = await chamarTexto({
      system: `${AGENTES.lara.instrucoes}\n\n${REGRAS}`,
      user: `${ctx}\n\nREDES ESCOLHIDAS: ${redes}\nHOJE: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' })}\nPRAZO DA TAREFA: ${t.data ? String(t.data).slice(0, 10) : 'não definido'}\n\nPEÇA APROVADA:\n${texto(t.legenda || t.briefing || '', 6000)}\n\nResponda neste formato exato:\nTEXTO:\n<texto final que vai ao ar>\nMELHOR HORÁRIO:\n<dia e hora no fuso de Recife + 1 frase de justificativa>`,
      maxTokens: 1800,
    });
    const m = saida.match(/TEXTO:\s*([\s\S]*?)\s*MELHOR HOR[ÁA]RIO:\s*([\s\S]*)$/i);
    res.json({ texto: m ? m[1].trim() : saida.trim(), horario: m ? m[2].trim() : '' });
  }));

  // Marca como publicada manualmente (conteúdo publicado fora do sistema, campanha no ar, arte entregue)
  app.post('/api/tasks/:id/concluir', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg='Concluída', esteira_em=now(), updated_at=now()
       WHERE id=$1 AND esteira IN ('aprovada','agendada') RETURNING *`, [req.params.id]);
    if (!t) return res.status(400).json({ erro: 'A tarefa precisa estar aprovada' });
    res.json(t);
  }));
}

// Agendador: a cada minuto publica o que uma pessoa aprovou e agendou. Reserva a tarefa antes (esteira='publicando') para não publicar duas vezes.
async function publicarAgendadas(pool) {
  const { rows } = await pool.query(
    `UPDATE tasks SET esteira='publicando', esteira_msg='Lara publicando…', esteira_em=now()
     WHERE id IN (SELECT id FROM tasks WHERE esteira='agendada' AND agendada_para <= now() ORDER BY agendada_para LIMIT 5 FOR UPDATE SKIP LOCKED)
     RETURNING id, client_id, plataformas, publicar_texto, publicar_imagem`);
  const { publicar } = require('./integracoes');
  for (const t of rows) {
    try {
      const res = await publicar(t.client_id, String(t.plataformas || '').split(',').filter(Boolean), t.publicar_texto, t.publicar_imagem || '', null);
      const ok = res.filter((r) => r.status === 'publicado').map((r) => r.plataforma);
      const falhas = res.filter((r) => r.status !== 'publicado').map((r) => `${r.plataforma}: ${r.erro}`);
      if (ok.length) await pool.query(`UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg=$1, esteira_em=now(), updated_at=now() WHERE id=$2`,
        [`Lara publicou em ${ok.join(', ')}${falhas.length ? ` (falhou: ${falhas.join('; ')})` : ''}`, t.id]);
      else await pool.query(`UPDATE tasks SET esteira='aprovada', esteira_msg=$1, esteira_em=now(), agendada_para=NULL, updated_at=now() WHERE id=$2`, [`A publicação agendada falhou: ${falhas.join('; ')}`.slice(0, 500), t.id]);
    } catch (e) {
      console.error('Agendador falhou:', e.message);
      await pool.query(`UPDATE tasks SET esteira='aprovada', esteira_msg=$1, esteira_em=now(), agendada_para=NULL, updated_at=now() WHERE id=$2`, [`A publicação agendada falhou: ${e.message}`.slice(0, 500), t.id]).catch(() => {});
    }
  }
}
function iniciarAgendador(pool) {
  // se o servidor reiniciou no meio de uma publicação, devolve para a pessoa decidir (não publica de novo sozinho)
  pool.query(`UPDATE tasks SET esteira='aprovada', esteira_msg='A publicação foi interrompida. Confira nas redes antes de publicar de novo.', agendada_para=NULL WHERE esteira='publicando'`).catch(() => {});
  const t = setInterval(() => publicarAgendadas(pool).catch((e) => console.error('Agendador:', e.message)), 60000);
  t.unref();
}

module.exports = { registrar, executar, iniciarAgendador, publicarAgendadas, precisaCriacao };
