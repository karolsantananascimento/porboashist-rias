// A Melhor Mídia do Brasil: projetos, equipe de agentes (Hugo, Luiz, Davi, Camila, Felipe e Bianca),
// mensagens da Meta, vagas de emprego e status das integrações.
// Nada é publicado, enviado ou candidatado sem um clique de uma pessoa.

const { cfg } = require('./config');
const crypto = require('crypto');
const { tokenDaPagina, verifyToken } = require('./integracoes');

const MODELO = process.env.AGENTE_MODELO || 'claude-sonnet-5-5';
const LIMITE_POR_HORA = Number(process.env.AGENTE_LIMITE_HORA || 40);
const texto = (v, max = 6000) => String(v ?? '').slice(0, max);
const val = (v) => (v && String(v).trim()) || null;

// ---------- A equipe ----------
const REGRAS = `REGRAS INEGOCIÁVEIS
1. Escreva em português do Brasil, com naturalidade, pronto para uso, sem conversa introdutória.
2. Nunca invente fatos: preços, números, depoimentos, promoções, prazos, datas, resultados ou características. Use só o que estiver no CONTEXTO e no pedido.
3. Quando faltar uma informação importante, escreva [CONFIRMAR: o que falta] no ponto certo e liste tudo ao final em "Conferir antes de usar".
4. Siga a identidade, o tom de voz e as regras do projeto/cliente. Não copie personagens, marcas ou obras existentes.`;

const AGENTES = {
  hugo: {
    nome: 'Hugo', cargo: 'Redator e planejador de conteúdo', icone: '✍️', area: 'Conteúdo',
    descricao: 'Escreve legendas, carrosséis, roteiros de reels e stories, posts de LinkedIn e artigos de blog com SEO.',
    formatos: ['Post de feed (legenda + briefing)', 'Carrossel', 'Roteiro de reels', 'Roteiro de stories', 'Post de LinkedIn', 'Artigo de blog (SEO)', 'Texto livre'],
    instrucoes: `Você é Hugo, redator e planejador de conteúdo. Entregue a peça completa conforme o formato pedido.
- Post de feed: 3 opções de gancho; legenda com gancho nas primeiras linhas, parágrafos curtos e CTA; 4 a 8 hashtags; depois o BRIEFING CRIATIVO (o que vai na arte, imagem desejada, direção de arte).
- Carrossel: capa, de 5 a 8 lâminas com o texto exato de cada uma e fechamento com CTA, mais a legenda.
- Reels/Stories: cena a cena (tela, texto na tela, fala, interação).
- LinkedIn: abertura forte, argumento com exemplo concreto, fechamento com pergunta. Sem emojis em excesso.
- Blog: palavra-chave principal, title (até 60 caracteres), meta description (até 155), H1/H2/H3, de 700 a 1000 palavras, sugestão de links internos.`,
  },
  luiz: {
    nome: 'Luiz', cargo: 'Designer e diretor de arte', icone: '🎨', area: 'Artes',
    descricao: 'Cria a direção de arte e o briefing de cada peça (feed, stories, capas, anúncios) e entrega um prompt pronto para gerar a imagem ou montar no Canva.',
    formatos: ['Arte de feed (1080x1350)', 'Capa de carrossel + lâminas', 'Arte de stories/reels (1080x1920)', 'Criativo de anúncio', 'Capa de vídeo/thumbnail', 'Identidade / moodboard'],
    instrucoes: `Você é Luiz, designer e diretor de arte. Entregue: conceito da peça; medidas; hierarquia visual; texto EXATO de cada elemento; paleta e tipografia seguindo a marca do projeto; composição por lâmina; imagens necessárias (cite materiais só se constarem no contexto); e um PROMPT PRONTO em um bloco único para gerar a imagem ou montar no Canva. Se houver um GUIA DE MARCA no contexto, ele manda: use só a paleta, as fontes e o vocabulário dele e termine com a seção "Conformidade com o guia" (checklist). Se a marca não estiver definida, diga o que falta em vez de inventar.`,
  },
  davi: {
    nome: 'Davi', cargo: 'Editor de vídeo', icone: '🎬', area: 'Vídeos',
    descricao: 'Monta o roteiro, a decupagem e o passo a passo de edição de reels, vídeos institucionais e anúncios em vídeo.',
    formatos: ['Reels / TikTok (até 60s)', 'Vídeo institucional', 'Anúncio em vídeo (até 30s)', 'Corte de vídeo longo', 'Legendas e capa do vídeo'],
    instrucoes: `Você é Davi, editor de vídeo. Entregue: formato e duração; roteiro cena a cena em tabela (tempo, imagem a captar ou usar, fala, texto na tela, corte/transição); trilha e efeitos sugeridos (tipo, sem citar músicas protegidas); legendas por trecho; capa; e um passo a passo de edição para CapCut ou Premiere. Se o usuário já tem o material gravado, organize a ordem dos cortes.`,
  },
  camila: {
    nome: 'Camila', cargo: 'Gestora de tráfego', icone: '📈', area: 'Campanhas',
    descricao: 'Planeja campanhas de anúncios no Meta, Google e LinkedIn: público, estrutura, copies, criativos, métricas e checklist para subir.',
    formatos: ['Campanha Meta Ads', 'Campanha Google Ads (Search/Display/YouTube)', 'Campanha LinkedIn Ads', 'Remarketing', 'Campanha de captação de leads (WhatsApp)'],
    instrucoes: `Você é Camila, gestora de tráfego. Entregue o plano da campanha: objetivo e KPI; público; estrutura (campanha > conjuntos/grupos > anúncios); verba e distribuição (use só a verba informada; se não houver, proponha uma faixa claramente marcada como hipótese); 3 variações de copy (título, texto, CTA); criativos necessários (para o Luiz/Davi); eventos e rastreamento; regras de otimização; checklist para subir. Não prometa resultados.`,
  },
  felipe: {
    nome: 'Felipe Macedo', cargo: 'Atendimento e pré-vendas (SDR)', icone: '💬', area: 'Mensagens',
    descricao: 'Lê as mensagens do Instagram e do Facebook e sugere respostas no tom da marca, qualificando o contato. Você aprova antes de enviar.',
    formatos: [],
    instrucoes: `Você é Felipe Macedo, atendimento e pré-vendas. Responda como pessoa, de forma curta e cordial, no tom da marca. Faça no máximo uma pergunta de qualificação por vez. Nunca prometa preço, prazo ou condição que não esteja no contexto: nesse caso diga que vai confirmar e sinalize "PRECISA DE HUMANO". Entregue só o texto da resposta e, em uma linha separada começando com "Nota:", qualquer alerta para a equipe.`,
  },
  bianca: {
    nome: 'Bianca', cargo: 'Caçadora de vagas e propostas', icone: '💼', area: 'Empregos',
    descricao: 'Busca vagas e projetos (Workana, LinkedIn e outros), avalia a aderência ao seu perfil e monta a proposta e as respostas de cadastro com as suas informações.',
    formatos: [],
    instrucoes: '',
  },
};

const publicoAgente = (a, id, ativo) => ({ id, nome: a.nome, cargo: a.cargo, icone: a.icone, area: a.area, descricao: a.descricao, formatos: a.formatos, ativo });

// ---------- Chamada à API do Claude (texto livre) ----------
async function chamarTexto({ system, user, maxTokens = 3500, tools, timeoutMs = 110000 }) {
  const chave = cfg('ANTHROPIC_API_KEY');
  if (!chave) { const e = new Error('Os agentes ainda não estão ativos: falta configurar ANTHROPIC_API_KEY no Render.'); e.status = 503; throw e; }
  let r;
  try {
    r = await fetch(process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], ...(tools ? { tools } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = new Error(err.name === 'TimeoutError' ? 'A IA demorou demais. Tente de novo.' : 'Não consegui falar com a IA agora. Tente de novo.');
    e.status = 504; throw e;
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Erro da API do Claude', r.status, dados?.error?.message);
    const e = new Error(r.status === 401 ? 'A chave da API do Claude é inválida. Confira ANTHROPIC_API_KEY no Render.'
      : r.status === 429 || r.status === 529 ? 'A IA está ocupada no momento. Tente de novo em instantes.'
        : 'A IA não conseguiu gerar agora. Tente de novo.');
    e.status = 502; throw e;
  }
  const saida = (dados.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!saida) { const e = new Error('A IA não devolveu texto. Tente de novo.'); e.status = 502; throw e; }
  return saida;
}

const usos = new Map();
function dentroDoLimite(userId) {
  const agora = Date.now();
  const lista = (usos.get(userId) || []).filter((t) => agora - t < 3600 * 1000);
  if (lista.length >= LIMITE_POR_HORA) { usos.set(userId, lista); return false; }
  lista.push(agora); usos.set(userId, lista);
  return true;
}

// ---------- Guia de marca (a "skill" do designer) ----------
// Cliente com guia/kit próprio usa o dele. Cliente que é a própria marca do projeto herda o do projeto.
// Cliente de outra marca SEM guia nunca herda a identidade do projeto.
async function guiaDe(pool, projectId, clientId) {
  const { rows: [proj] } = projectId ? await pool.query('SELECT nome, canva_kit_id, canva_kit_nome, guia_design FROM projects WHERE id=$1', [projectId]) : { rows: [] };
  const { rows: [cl] } = clientId ? await pool.query('SELECT nome, canva_kit_id, canva_kit_nome, guia_design, marca_propria FROM clients WHERE id=$1', [clientId]) : { rows: [] };
  if (cl && (val(cl.guia_design) || cl.canva_kit_id)) return { origem: 'cliente', nome: cl.nome, kit_id: cl.canva_kit_id, kit_nome: cl.canva_kit_nome, guia: cl.guia_design };
  if (cl && !cl.marca_propria) return { origem: 'sem_guia', nome: cl.nome };
  if (proj && (val(proj.guia_design) || proj.canva_kit_id)) return { origem: 'projeto', nome: proj.nome, kit_id: proj.canva_kit_id, kit_nome: proj.canva_kit_nome, guia: proj.guia_design };
  return null;
}

async function blocoGuia(pool, projectId, clientId) {
  const g = await guiaDe(pool, projectId, clientId);
  if (!g) return 'GUIA DE MARCA: nenhum cadastrado. Não invente cores, fontes ou logo; marque [CONFIRMAR: identidade visual da marca].';
  if (g.origem === 'sem_guia') return `GUIA DE MARCA: o cliente "${g.nome}" ainda não tem guia de marca cadastrado. NÃO use a identidade visual do projeto nem invente cores, fontes ou logo: entregue apenas a estrutura da peça e marque [CONFIRMAR: paleta, fontes e logo do cliente].`;
  return [`GUIA DE MARCA "${g.nome}" (padrão obrigatório: siga ao pé da letra, cite as cores em hex e termine com "Conformidade com o guia"):`, g.guia || '(sem texto; siga o kit abaixo)',
    g.kit_id ? `KIT DE MARCA NO CANVA: ${g.kit_nome || ''} (brand_kit_id ${g.kit_id}). Peças criadas no Canva devem usar este kit.` : 'KIT NO CANVA: nenhum vinculado.'].join('\n');
}

async function kitDe(pool, projectId, clientId) {
  const g = await guiaDe(pool, projectId, clientId);
  return g && g.kit_id ? { id: g.kit_id, nome: g.kit_nome, origem: g.origem } : null;
}

// ---------- Contexto do projeto/cliente ----------
async function blocoContexto(pool, projectId, clientId, agente) {
  const partes = [];
  if (projectId) {
    const { rows: [p] } = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
    if (p) partes.push(`PROJETO: ${p.nome}\n${[p.descricao, p.contexto].filter(Boolean).join('\n')}`);
  }
  if (clientId) {
    const { rows: [cl] } = await pool.query('SELECT * FROM clients WHERE id=$1', [clientId]);
    if (cl) {
      const { rows: [ctx] } = await pool.query('SELECT * FROM contexto_cliente WHERE client_id=$1', [clientId]);
      const c = ctx || {};
      partes.push([
        `CLIENTE: ${cl.nome}`,
        cl.marcas?.length ? `Marcas: ${cl.marcas.join(', ')}` : null,
        cl.site ? `Site: ${cl.site}` : null, cl.instagram ? `Instagram: ${cl.instagram}` : null,
        val(c.tom_de_voz) && `Tom de voz: ${c.tom_de_voz}`, val(c.publico) && `Público: ${c.publico}`,
        val(c.pilares) && `Pilares:\n${c.pilares}`,
        val(c.conhecimento) && `BASE DE CONHECIMENTO (fatos confirmados):\n${c.conhecimento}`,
        val(c.regras) && `Regras (obrigatórias):\n${c.regras}`,
        (val(c.rodape) || val(cl.observacoes)) && `Rodapé padrão e observações:\n${val(c.rodape) || cl.observacoes}`,
      ].filter(Boolean).join('\n'));
    }
  }
  if (['luiz', 'davi'].includes(agente)) partes.push(await blocoGuia(pool, projectId, clientId));
  return partes.length ? partes.join('\n\n') : 'CONTEXTO: nenhum projeto selecionado. Use o que estiver no pedido e marque o que faltar.';
}

const ordemJson = (s) => {
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i < 0 || j < i) return [];
  try { const r = JSON.parse(s.slice(i, j + 1)); return Array.isArray(r) ? r : []; } catch { return []; }
};

// ---------- Rotas ----------
module.exports = function registrarProjetos(app, { pool, wrap, soAdmin }) {
  const ativo = () => !!cfg('ANTHROPIC_API_KEY');

  // Projetos (cards da tela inicial)
  app.get('/api/projects', wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.*,
        (SELECT count(*)::int FROM clients c WHERE c.project_id=p.id) AS clientes,
        (SELECT coalesce(json_agg(c.nome ORDER BY c.nome), '[]') FROM clients c WHERE c.project_id=p.id) AS nomes_clientes,
        (SELECT count(*)::int FROM tasks t JOIN clients c ON c.id=t.client_id WHERE c.project_id=p.id AND t.tipo<>'story' AND t.status<>'publicado') AS abertas,
        (SELECT count(*)::int FROM tasks t JOIN clients c ON c.id=t.client_id WHERE c.project_id=p.id AND t.tipo<>'story' AND t.status<>'publicado' AND t.data < current_date) AS atrasadas,
        (SELECT count(*)::int FROM tasks t JOIN clients c ON c.id=t.client_id WHERE c.project_id=p.id AND t.tipo='post' AND to_char(t.data,'YYYY-MM')=to_char(current_date,'YYYY-MM')) AS posts_mes,
        (SELECT count(*)::int FROM solicitacoes s WHERE s.project_id=p.id AND s.status IN ('nova','andamento')) AS solicitacoes_abertas,
        (SELECT count(*)::int FROM vagas v WHERE p.tipo='empregos' AND v.status IN ('nova','salva')) AS vagas_abertas,
        (SELECT count(*)::int FROM vagas v WHERE p.tipo='empregos' AND v.status='candidatado') AS vagas_candidatadas
      FROM projects p ORDER BY p.ordem, p.id`);
    res.json(rows);
  }));

  app.post('/api/projects', soAdmin, wrap(async (req, res) => {
    const nome = String(req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do projeto' });
    try {
      const { rows: [p] } = await pool.query(
        `INSERT INTO projects (nome, cor, descricao, contexto, ordem) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordem),0)+1 FROM projects)) RETURNING *`,
        [nome, /^#[0-9a-f]{6}$/i.test(req.body.cor || '') ? req.body.cor : '#b3202a', texto(req.body.descricao, 600), texto(req.body.contexto, 6000)]);
      res.json(p);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ erro: 'Já existe um projeto com esse nome' });
      throw e;
    }
  }));

  app.put('/api/projects/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: [atual] } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!atual) return res.status(404).json({ erro: 'Projeto não encontrado' });
    const nome = String(b.nome ?? atual.nome).trim() || atual.nome;
    const cor = /^#[0-9a-f]{6}$/i.test(b.cor || '') ? b.cor : atual.cor;
    const { rows: [p] } = await pool.query(
      'UPDATE projects SET nome=$1, cor=$2, descricao=$3, contexto=$4, canva_kit_id=$5, canva_kit_nome=$6, guia_design=$8 WHERE id=$7 RETURNING *',
      [nome, cor, 'descricao' in b ? texto(b.descricao, 600) : atual.descricao, 'contexto' in b ? texto(b.contexto, 6000) : atual.contexto,
        'canva_kit_id' in b ? (texto(b.canva_kit_id, 40) || null) : atual.canva_kit_id,
        'canva_kit_nome' in b ? (texto(b.canva_kit_nome, 80) || null) : atual.canva_kit_nome, atual.id,
        'guia_design' in b ? (texto(b.guia_design, 12000) || null) : atual.guia_design]);
    res.json(p);
  }));

  // Guia de marca do cliente (a "skill" que o designer segue)
  app.put('/api/clients/:id/guia', wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: [c] } = await pool.query(
      `UPDATE clients SET canva_kit_id=$1, canva_kit_nome=$2, guia_design=$3, marca_propria=$4 WHERE id=$5 RETURNING id, canva_kit_id, canva_kit_nome, guia_design, marca_propria`,
      [texto(b.canva_kit_id, 40) || null, texto(b.canva_kit_nome, 80) || null, texto(b.guia_design, 12000) || null, !!b.marca_propria, req.params.id]);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(c);
  }));

  // Equipe
  app.get('/api/agentes', (req, res) => res.json(Object.entries(AGENTES).map(([id, a]) => publicoAgente(a, id, ativo()))));

  // Criar: Hugo, Luiz, Davi e Camila
  app.post('/api/criar', wrap(async (req, res) => {
    const b = req.body || {};
    const ag = AGENTES[b.agente];
    if (!ag || !ag.formatos.length) return res.status(400).json({ erro: 'Agente inválido para criação' });
    const pedido = texto(b.pedido, 4000).trim();
    if (!pedido) return res.status(400).json({ erro: 'Descreva o que você quer criar' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de gerações por hora atingido. Tente mais tarde.' });
    const contexto = await blocoContexto(pool, b.project_id, b.client_id, b.agente);
    const saida = await chamarTexto({
      system: `${ag.instrucoes}\n\n${REGRAS}`,
      user: `${contexto}\n\nFORMATO: ${texto(b.formato, 120) || 'a critério do agente'}\nPLATAFORMA/CANAL: ${texto(b.plataforma, 80) || 'não informado'}\n\nPEDIDO:\n${pedido}\n\nTermine com a seção "Conferir antes de usar".`,
      maxTokens: 4000,
    });
    const { rows: [c] } = await pool.query(
      `INSERT INTO criacoes (project_id, client_id, agente, formato, pedido, saida, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.project_id || null, b.client_id || null, b.agente, texto(b.formato, 120) || null, pedido, saida, req.user.id]);
    res.json({ ...c, kit: await kitDe(pool, c.project_id, c.client_id) });
  }));

  app.get('/api/criacoes', wrap(async (req, res) => {
    const w = []; const v = [];
    if (req.query.project_id) { v.push(req.query.project_id); w.push(`project_id=$${v.length}`); }
    if (req.query.agente) { v.push(req.query.agente); w.push(`agente=$${v.length}`); }
    const { rows } = await pool.query(`SELECT * FROM criacoes ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 60`, v);
    const cache = new Map();
    for (const r of rows) {
      const k = `${r.project_id}:${r.client_id}`;
      if (!cache.has(k)) cache.set(k, await kitDe(pool, r.project_id, r.client_id));
      r.kit = cache.get(k);
    }
    res.json(rows);
  }));

  app.put('/api/criacoes/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: [c] } = await pool.query(
      `UPDATE criacoes SET saida=COALESCE($1, saida), status=CASE WHEN $2 IN ('rascunho','aprovado') THEN $2 ELSE status END,
         arte_url=CASE WHEN $3::boolean THEN $4 ELSE arte_url END WHERE id=$5 RETURNING *`,
      ['saida' in b ? texto(b.saida, 40000) : null, b.status || null, 'arte_url' in b,
        /^https:\/\/\S+$/i.test(String(b.arte_url || '').trim()) ? String(b.arte_url).trim() : null, req.params.id]);
    if (!c) return res.status(404).json({ erro: 'Criação não encontrada' });
    res.json(c);
  }));

  app.delete('/api/criacoes/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM criacoes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // Transforma uma criação em tarefa do calendário
  app.post('/api/criacoes/:id/tarefa', wrap(async (req, res) => {
    const { rows: [c] } = await pool.query('SELECT * FROM criacoes WHERE id=$1', [req.params.id]);
    if (!c) return res.status(404).json({ erro: 'Criação não encontrada' });
    const clientId = Number(req.body.client_id || c.client_id);
    if (!clientId) return res.status(400).json({ erro: 'Escolha o cliente da tarefa' });
    const tipo = c.agente === 'hugo' && /blog/i.test(c.formato || '') ? 'blog' : 'post';
    const formato = /reels|v[ií]deo/i.test(c.formato || '') ? 'reels' : /carrossel/i.test(c.formato || '') ? 'carrossel' : tipo === 'blog' ? 'artigo' : 'estático';
    const tema = texto((c.pedido || '').split('\n')[0], 140);
    const campo = c.agente === 'hugo' ? 'legenda' : 'briefing';
    const data = /^\d{4}-\d{2}-\d{2}$/.test(req.body.data || '') ? req.body.data : null;
    const { rows: [t] } = await pool.query(
      `INSERT INTO tasks (client_id, tipo, formato, data, tema, ${campo}, status, arte_url) VALUES ($1,$2,$3,$4,$5,$6,'conteudo',$7) RETURNING *`,
      [clientId, tipo, formato, data, tema, c.saida, c.arte_url || null]);
    res.json(t);
  }));

  // ---------- Mensagens (Felipe) ----------
  app.get('/api/mensagens', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM mensagens ORDER BY (status='nova') DESC, created_at DESC LIMIT 80`);
    res.json(rows);
  }));

  app.post('/api/mensagens', wrap(async (req, res) => {
    const t = texto(req.body.texto, 3000).trim();
    if (!t) return res.status(400).json({ erro: 'Cole o texto da mensagem' });
    const { rows: [m] } = await pool.query(
      `INSERT INTO mensagens (project_id, canal, remetente_nome, texto) VALUES ($1,'manual',$2,$3) RETURNING *`,
      [req.body.project_id || null, texto(req.body.remetente_nome, 120) || null, t]);
    res.json(m);
  }));

  app.post('/api/mensagens/:id/sugerir', wrap(async (req, res) => {
    const { rows: [m] } = await pool.query('SELECT * FROM mensagens WHERE id=$1', [req.params.id]);
    if (!m) return res.status(404).json({ erro: 'Mensagem não encontrada' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de gerações por hora atingido.' });
    const projectId = req.body.project_id || m.project_id || null;
    if (projectId && projectId !== m.project_id) await pool.query('UPDATE mensagens SET project_id=$1 WHERE id=$2', [projectId, m.id]);
    const contexto = await blocoContexto(pool, projectId, req.body.client_id || null);
    const sugestao = await chamarTexto({
      system: `${AGENTES.felipe.instrucoes}\n\n${REGRAS}`,
      user: `${contexto}\n\nCANAL: ${m.canal}\nMENSAGEM RECEBIDA${m.remetente_nome ? ` DE ${m.remetente_nome}` : ''}:\n${m.texto}\n\n${req.body.ajuste ? `AJUSTE PEDIDO PELA EQUIPE: ${texto(req.body.ajuste, 400)}\n` : ''}Escreva a resposta.`,
      maxTokens: 800,
    });
    const { rows: [novo] } = await pool.query('UPDATE mensagens SET resposta=$1 WHERE id=$2 RETURNING *', [sugestao, m.id]);
    res.json(novo);
  }));

  app.post('/api/mensagens/:id/enviar', wrap(async (req, res) => {
    const { rows: [m] } = await pool.query('SELECT * FROM mensagens WHERE id=$1', [req.params.id]);
    if (!m) return res.status(404).json({ erro: 'Mensagem não encontrada' });
    const resposta = texto(req.body.resposta, 1900).trim();
    if (!resposta) return res.status(400).json({ erro: 'Escreva ou gere a resposta antes de enviar' });
    let enviado = false;
    if (m.canal !== 'manual' && m.remetente_id) {
      const token = await tokenDaPagina(pool);
      if (!token) return res.status(400).json({ erro: 'Conecte o Facebook/Instagram em Integrações para enviar daqui. Por enquanto, copie a resposta e envie manualmente.' });
      const r = await fetch('https://graph.facebook.com/v21.0/me/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipient: { id: m.remetente_id }, messaging_type: 'RESPONSE', message: { text: resposta } }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (!r || !r.ok) {
        console.error('Erro ao enviar mensagem Meta', r?.status, d?.error?.message);
        return res.status(502).json({ erro: `A Meta recusou o envio${d?.error?.message ? `: ${d.error.message}` : ''}. Janela de 24 h vencida ou token sem permissão?` });
      }
      enviado = true;
    }
    const { rows: [novo] } = await pool.query(
      `UPDATE mensagens SET resposta=$1, status='respondida', respondida_em=now() WHERE id=$2 RETURNING *`, [resposta, m.id]);
    res.json({ mensagem: novo, enviado });
  }));

  app.put('/api/mensagens/:id', wrap(async (req, res) => {
    const status = ['nova', 'respondida', 'ignorada'].includes(req.body.status) ? req.body.status : null;
    const { rows: [m] } = await pool.query(
      `UPDATE mensagens SET status=COALESCE($1,status), resposta=COALESCE($2,resposta), project_id=COALESCE($3,project_id) WHERE id=$4 RETURNING *`,
      [status, 'resposta' in req.body ? texto(req.body.resposta, 1900) : null, req.body.project_id || null, req.params.id]);
    res.json(m);
  }));

  app.delete('/api/mensagens/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM mensagens WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // ---------- Empregos (Bianca) ----------
  app.get('/api/perfil', wrap(async (req, res) => {
    const { rows: [p] } = await pool.query('SELECT dados FROM perfil_profissional WHERE id=1');
    res.json(p ? p.dados : {});
  }));

  app.put('/api/perfil', wrap(async (req, res) => {
    const campos = ['nome', 'email', 'telefone', 'cidade', 'linkedin', 'portfolio', 'headline', 'resumo', 'experiencias', 'formacao', 'idiomas', 'pretensao', 'disponibilidade', 'observacoes'];
    const dados = Object.fromEntries(campos.map((k) => [k, texto(req.body[k], 4000)]));
    await pool.query(
      `INSERT INTO perfil_profissional (id, dados, updated_at) VALUES (1,$1,now()) ON CONFLICT (id) DO UPDATE SET dados=EXCLUDED.dados, updated_at=now()`,
      [JSON.stringify(dados)]);
    res.json(dados);
  }));

  app.get('/api/vagas', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM vagas ORDER BY (status='descartada'), created_at DESC LIMIT 200`);
    res.json(rows);
  }));

  const urlOk = (u) => !u || /^https?:\/\/\S+$/i.test(String(u).trim());

  app.post('/api/vagas', wrap(async (req, res) => {
    const b = req.body || {};
    if (!String(b.titulo || '').trim()) return res.status(400).json({ erro: 'Informe o título da vaga' });
    if (!urlOk(b.url)) return res.status(400).json({ erro: 'O link precisa começar com https://' });
    const { rows: [v] } = await pool.query(
      `INSERT INTO vagas (plataforma, titulo, empresa, url, descricao, orcamento, status) VALUES ($1,$2,$3,$4,$5,$6,'salva') RETURNING *`,
      [texto(b.plataforma, 60) || null, texto(b.titulo, 200).trim(), texto(b.empresa, 200) || null, val(b.url), texto(b.descricao, 12000) || null, texto(b.orcamento, 120) || null]);
    res.json(v);
  }));

  app.put('/api/vagas/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: [a] } = await pool.query('SELECT * FROM vagas WHERE id=$1', [req.params.id]);
    if (!a) return res.status(404).json({ erro: 'Vaga não encontrada' });
    if ('url' in b && !urlOk(b.url)) return res.status(400).json({ erro: 'O link precisa começar com https://' });
    const n = { ...a, ...b };
    const status = ['nova', 'salva', 'candidatado', 'descartada'].includes(n.status) ? n.status : a.status;
    const { rows: [v] } = await pool.query(
      `UPDATE vagas SET plataforma=$1, titulo=$2, empresa=$3, url=$4, descricao=$5, orcamento=$6, status=$7, proposta=$8, updated_at=now() WHERE id=$9 RETURNING *`,
      [n.plataforma, texto(n.titulo, 200), n.empresa, val(n.url), texto(n.descricao, 12000), n.orcamento, status, texto(n.proposta, 12000), a.id]);
    res.json(v);
  }));

  app.delete('/api/vagas/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM vagas WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // Bianca avalia a vaga e escreve a proposta com os dados do perfil
  app.post('/api/vagas/:id/analisar', wrap(async (req, res) => {
    const { rows: [v] } = await pool.query('SELECT * FROM vagas WHERE id=$1', [req.params.id]);
    if (!v) return res.status(404).json({ erro: 'Vaga não encontrada' });
    if (!val(v.descricao)) return res.status(400).json({ erro: 'Cole a descrição da vaga para a Bianca poder analisar' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de gerações por hora atingido.' });
    const { rows: [p] } = await pool.query('SELECT dados FROM perfil_profissional WHERE id=1');
    const perfil = Object.entries(p?.dados || {}).filter(([, x]) => val(x)).map(([k, x]) => `${k}: ${x}`).join('\n');
    const saida = await chamarTexto({
      system: `Você é Bianca, caçadora de vagas e propostas. Escreva em português do Brasil, em primeira pessoa quando for a proposta.
REGRAS: use SOMENTE os dados do PERFIL abaixo. Nunca invente experiência, resultado, número, cliente, certificação, idioma ou pretensão. Campo que não consta no perfil vira [PREENCHER: campo]. Seja específica para a vaga e sem clichês.
Responda exatamente neste formato:
## Aderência
(nota de 0 a 10, em uma linha, e 3 a 5 frases explicando; diga o que falta)
## Pontos a destacar
(lista curta ligando a vaga ao perfil)
## Respostas prontas para o cadastro
(Nome, E-mail, Telefone, Cidade, Link do LinkedIn, Portfólio, Resumo profissional (até 500 caracteres), Experiência relevante, Formação, Idiomas, Pretensão, Disponibilidade — um por linha, só com o que consta no perfil)
## Dúvidas para confirmar
(lista)
=== PROPOSTA ===
(texto final da proposta/carta de apresentação, pronto para colar, de 120 a 220 palavras)`,
      user: `PERFIL:\n${perfil}\n\nVAGA\nPlataforma: ${v.plataforma || '-'}\nTítulo: ${v.titulo}\nEmpresa: ${v.empresa || '-'}\nOrçamento: ${v.orcamento || '-'}\nDescrição:\n${v.descricao}`,
      maxTokens: 3000,
    });
    const [analise, proposta] = saida.split('=== PROPOSTA ===');
    const { rows: [novo] } = await pool.query(
      `UPDATE vagas SET analise=$1, proposta=$2, status=CASE WHEN status='nova' THEN 'salva' ELSE status END, updated_at=now() WHERE id=$3 RETURNING *`,
      [analise.trim(), (proposta || '').trim() || null, v.id]);
    res.json(novo);
  }));

  // Bianca busca vagas na web (precisa da ferramenta de busca habilitada na conta da API)
  app.post('/api/vagas/buscar', wrap(async (req, res) => {
    const termos = texto(req.body.termos, 200).trim();
    if (!termos) return res.status(400).json({ erro: 'Diga o que a Bianca deve procurar' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de buscas por hora atingido.' });
    const { rows: [p] } = await pool.query('SELECT dados FROM perfil_profissional WHERE id=1');
    let saida;
    try {
      saida = await chamarTexto({
        system: 'Você busca vagas e projetos freelance abertos agora. Use a busca na web. Devolva APENAS um array JSON (sem texto fora dele) com até 8 itens {"titulo","empresa","plataforma","url","orcamento","resumo"}. Só inclua itens com URL real encontrada na busca; nunca invente vagas ou URLs. Se não achar nada, devolva [].',
        user: `Perfil: ${p?.dados?.headline || ''}\nBusca: ${termos}\nPlataformas preferidas: Workana, LinkedIn, e outras com vagas remotas ou em Recife/PE.`,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        maxTokens: 3000, timeoutMs: 120000,
      });
    } catch (e) {
      if (e.status === 502) e.message = 'Não consegui buscar agora. Confira se a busca na web está habilitada na sua conta da API; enquanto isso, cole as vagas manualmente.';
      throw e;
    }
    const achadas = ordemJson(saida).filter((x) => x && x.titulo && /^https?:\/\//i.test(x.url || '')).slice(0, 8);
    const novas = [];
    for (const x of achadas) {
      const { rows: ja } = await pool.query('SELECT 1 FROM vagas WHERE url=$1', [x.url]);
      if (ja.length) continue;
      const { rows: [v] } = await pool.query(
        `INSERT INTO vagas (plataforma, titulo, empresa, url, descricao, orcamento, status) VALUES ($1,$2,$3,$4,$5,$6,'nova') RETURNING *`,
        [texto(x.plataforma, 60) || null, texto(x.titulo, 200), texto(x.empresa, 200) || null, x.url, texto(x.resumo, 2000) || null, texto(x.orcamento, 120) || null]);
      novas.push(v);
    }
    res.json({ encontradas: achadas.length, novas });
  }));

};

// ---------- Webhook da Meta (fora de /api: a Meta não tem a sessão) ----------
module.exports.chamarTexto = chamarTexto;
module.exports.AGENTES = AGENTES;
module.exports.REGRAS = REGRAS;
module.exports.guiaDe = guiaDe;
module.exports.blocoContexto = blocoContexto;
module.exports.webhook = function registrarWebhook(app, { pool, wrap }) {
  app.get('/webhook/meta', (req, res) => {
    const esperado = verifyToken();
    if (esperado && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === esperado) {
      return res.status(200).send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  app.post('/webhook/meta', wrap(async (req, res) => {
    const segredo = cfg('META_APP_SECRET');
    if (!segredo) { console.warn('Webhook da Meta ignorado: falta META_APP_SECRET'); return res.sendStatus(200); }
    const assinatura = String(req.headers['x-hub-signature-256'] || '');
    const calc = 'sha256=' + crypto.createHmac('sha256', segredo).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    if (assinatura.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(calc))) return res.sendStatus(401);
    const canal = req.body.object === 'instagram' ? 'instagram' : 'facebook';
    for (const entry of req.body.entry || []) {
      for (const ev of entry.messaging || []) {
        if (!ev.message || ev.message.is_echo || !ev.message.text || !ev.sender?.id) continue;
        await pool.query(
          `INSERT INTO mensagens (canal, page_id, remetente_id, texto) VALUES ($1,$2,$3,$4)`,
          [canal, String(entry.id || ''), String(ev.sender.id), String(ev.message.text).slice(0, 3000)]);
      }
    }
    res.sendStatus(200);
  }));
};
