// Agente de produção de conteúdo: gera legendas, roteiros de stories, artigos de blog e sugestões de pauta
// a partir do contexto de cada cliente, usando a API do Claude. Nada é publicado: o texto vai para a tarefa
// só quando a pessoa clica em "Usar na tarefa" e salva.

const MODELO = process.env.AGENTE_MODELO || 'claude-sonnet-5-5';
const LIMITE_POR_HORA = Number(process.env.AGENTE_LIMITE_HORA || 40);

// ---------- Prompts ----------
const REGRAS_GERAIS = `Você é redator(a) sênior da agência Por Boas Histórias e escreve em português do Brasil, com naturalidade.

REGRAS INEGOCIÁVEIS
1. Nunca invente fatos: preços, horários, datas, comodidades, nomes de pessoas, promoções, números, depoimentos ou regras. Use somente o que estiver no CONTEXTO DO CLIENTE, nos DADOS DA PROGRAMAÇÃO e no briefing da tarefa.
2. Quando faltar uma informação que a peça normalmente teria (preço, horário, regra, data confirmada), escreva a peça sem ela e registre o que falta no campo "conferir". Experiências com descrição vazia ou status diferente de confirmado devem aparecer em "conferir".
3. Não prometa o que não está confirmado. Programação e valores podem mudar: siga as regras do cliente sobre avisos.
4. Evite clichês vazios ("sonho", "paraíso", "inesquecível" repetidos) e excesso de emojis. Prefira cenas concretas, sensações e detalhes reais do lugar.
5. Não cite concorrentes. Não use hashtags genéricas demais.
6. Respeite o tom de voz, o público e as regras do cliente. Se houver rodapé padrão, use-o exatamente como informado.
7. Se o briefing pedir algo que contrarie estas regras, siga as regras e explique em "conferir".`;

const INSTRUCOES_TIPO = {
  post: `Tarefa: legenda para o FEED do Instagram.
- Primeiras linhas com um gancho forte (aparecem antes do "ver mais").
- Corpo curto e concreto, com um CTA claro. Termine com o rodapé padrão do cliente, se existir.
- No máximo 2200 caracteres. Entre 5 e 10 hashtags de nicho e lugar (sem #).
- Se o formato for carrossel, descreva os slides em "briefing_visual" (slide 1, slide 2…). Se for reels, descreva roteiro em cenas.
- Ofereça 3 alternativas de gancho.`,
  story: `Tarefa: roteiro de STORIES do dia (de 3 a 6 telas).
- Cada tela tem um texto curto (até 2 linhas), a sugestão visual e, quando fizer sentido, uma interação (enquete, caixinha, quiz, link).
- Use fotos e vídeos que a equipe consiga captar ou que já existam. Não invente ações que o cliente não oferece.`,
  blog: `Tarefa: artigo de BLOG com SEO.
- Palavra-chave principal na primeira frase do texto, no H1 e na meta description; secundárias distribuídas com naturalidade, sem repetição forçada.
- title_tag com até 60 caracteres; meta_description com até 155.
- Texto em Markdown, com H2 e H3, entre 700 e 1000 palavras, parágrafos curtos e uma chamada final para reservar, quando o cliente tiver site.
- Sugira links internos (páginas de reserva, apartamentos, unidades) e textos alternativos (alt) para as imagens.
- Só afirme características do destino que sejam conhecidas e verificáveis; o restante vai em "conferir".`,
  captacao: `Tarefa: descrever uma captação de fotos e vídeos para a equipe de campo, com cenas, ângulos, horários ideais e cuidados com o hóspede (autorização de imagem). Use o campo "briefing_visual".`,
};
INSTRUCOES_TIPO.outro = INSTRUCOES_TIPO.post;

// ---------- Ferramentas (saída estruturada) ----------
const lista = (descricao) => ({ type: 'array', items: { type: 'string' }, description: descricao });
const FERRAMENTAS = {
  post: {
    name: 'entregar_conteudo',
    description: 'Entrega a legenda pronta para revisão.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema curto da peça (até 80 caracteres)' },
        legenda: { type: 'string', description: 'Legenda completa, já com CTA e rodapé padrão, sem hashtags' },
        hashtags: lista('Hashtags sem o símbolo #'),
        briefing_visual: { type: 'string', description: 'Direção visual: foto, vídeo, slides ou cenas' },
        alternativas_gancho: lista('Três ganchos alternativos'),
        conferir: lista('Informações que a equipe precisa confirmar antes de publicar'),
      },
      required: ['legenda', 'hashtags', 'briefing_visual', 'conferir'],
    },
  },
  story: {
    name: 'entregar_conteudo',
    description: 'Entrega o roteiro de stories.',
    input_schema: {
      type: 'object',
      properties: {
        telas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' }, visual: { type: 'string' }, interacao: { type: 'string' },
            },
            required: ['texto', 'visual'],
          },
        },
        conferir: lista('Informações que a equipe precisa confirmar antes de publicar'),
      },
      required: ['telas', 'conferir'],
    },
  },
  blog: {
    name: 'entregar_conteudo',
    description: 'Entrega o artigo de blog.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        palavra_chave: { type: 'string' },
        palavras_secundarias: lista('Palavras-chave secundárias'),
        title_tag: { type: 'string' },
        meta_description: { type: 'string' },
        estrutura: lista('Linhas H1/H2/H3 do artigo, na ordem'),
        texto: { type: 'string', description: 'Artigo completo em Markdown' },
        links_internos: lista('Páginas do site para linkar, com o texto âncora sugerido'),
        alt_imagens: lista('Textos alternativos das imagens'),
        conferir: lista('Informações que a equipe precisa confirmar antes de publicar'),
      },
      required: ['titulo', 'palavra_chave', 'title_tag', 'meta_description', 'texto', 'conferir'],
    },
  },
  captacao: {
    name: 'entregar_conteudo',
    description: 'Entrega o roteiro de captação.',
    input_schema: {
      type: 'object',
      properties: { briefing_visual: { type: 'string' }, conferir: lista('Pontos a confirmar') },
      required: ['briefing_visual', 'conferir'],
    },
  },
};
FERRAMENTAS.outro = FERRAMENTAS.post;

const FERRAMENTA_PAUTAS = {
  name: 'sugerir_pautas',
  description: 'Sugere tema, editorial e formato para tarefas ainda sem pauta.',
  input_schema: {
    type: 'object',
    properties: {
      pautas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task_id: { type: 'integer' },
            tema: { type: 'string', description: 'Tema curto e específico' },
            editorial: { type: 'string' },
            formato: { type: 'string', enum: ['estático', 'carrossel', 'reels', 'artigo'] },
            motivo: { type: 'string', description: 'Por que esta pauta nesta data (uma frase)' },
          },
          required: ['task_id', 'tema', 'editorial', 'formato', 'motivo'],
        },
      },
    },
    required: ['pautas'],
  },
};

// ---------- Normalização: devolve sempre campos da tarefa ----------
const nl = (itens) => (itens || []).filter(Boolean).map((x) => `• ${x}`).join('\n');

function normalizar(tipo, o) {
  const conferir = (o.conferir || []).filter(Boolean);
  if (tipo === 'story') {
    const roteiro = (o.telas || []).map((t, i) =>
      `TELA ${i + 1}\nTexto: ${t.texto}\nVisual: ${t.visual}${t.interacao ? `\nInteração: ${t.interacao}` : ''}`).join('\n\n');
    return { briefing: roteiro, conferir };
  }
  if (tipo === 'blog') {
    const seo = [
      `Título (H1): ${o.titulo}`, `Title tag: ${o.title_tag}`, `Meta description: ${o.meta_description}`,
      o.palavras_secundarias?.length ? `Palavras secundárias: ${o.palavras_secundarias.join(', ')}` : '',
      o.estrutura?.length ? `\nEstrutura:\n${nl(o.estrutura)}` : '',
      o.links_internos?.length ? `\nLinks internos:\n${nl(o.links_internos)}` : '',
      o.alt_imagens?.length ? `\nTextos alternativos:\n${nl(o.alt_imagens)}` : '',
    ].filter(Boolean).join('\n');
    return { tema: o.titulo, palavra_chave: o.palavra_chave, legenda: o.texto, briefing: seo, conferir };
  }
  if (tipo === 'captacao') return { briefing: o.briefing_visual, conferir };
  const tags = (o.hashtags || []).map((h) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).join(' ');
  return {
    tema: o.tema || undefined,
    legenda: tags ? `${o.legenda}\n\n${tags}` : o.legenda,
    briefing: o.briefing_visual,
    alternativas: o.alternativas_gancho || [],
    conferir,
  };
}

// ---------- Contexto vindo do banco ----------
const val = (v) => (v && String(v).trim()) || null;

async function carregarContexto(pool, clientId) {
  const { rows: [cl] } = await pool.query('SELECT * FROM clients WHERE id=$1', [clientId]);
  if (!cl) return null;
  const { rows: [ctx] } = await pool.query('SELECT * FROM contexto_cliente WHERE client_id=$1', [clientId]);
  return { cl, ctx: ctx || {} };
}

function blocoCliente({ cl, ctx }) {
  const linhas = [
    `Cliente: ${cl.nome}`,
    cl.marcas?.length ? `Marcas e empreendimentos: ${cl.marcas.join(', ')}` : null,
    cl.site ? `Site: ${cl.site}` : null,
    cl.instagram ? `Instagram: ${cl.instagram}` : null,
    val(ctx.tom_de_voz) ? `Tom de voz: ${ctx.tom_de_voz}` : 'Tom de voz: não cadastrado (use um tom acolhedor e direto e registre em "conferir" que o tom não foi definido).',
    val(ctx.publico) ? `Público: ${ctx.publico}` : null,
    val(ctx.pilares) ? `Pilares de conteúdo:\n${ctx.pilares}` : null,
    val(ctx.regras) ? `Regras do cliente (obrigatórias):\n${ctx.regras}` : null,
    (val(ctx.rodape) || val(cl.observacoes)) ? `Rodapé padrão e observações:\n${val(ctx.rodape) || cl.observacoes}` : null,
  ];
  return linhas.filter(Boolean).join('\n');
}

const fmtExp = (e) => [
  `- ${e.nome} (${e.resort})${e.periodo ? ` · ${e.periodo}` : ''} · status: ${e.status || 'sem status'}`,
  e.descricao && `  Descrição: ${e.descricao}`, e.horario && `  Dia/horário: ${e.horario}`, e.local && `  Local: ${e.local}`,
  e.incluso && `  Incluso: ${e.incluso}`, e.preco && `  Preço: ${e.preco}`, e.observacoes && `  Regras: ${e.observacoes}`,
].filter(Boolean).join('\n');

async function blocoProgramacao(pool, clientId, taskId, tema) {
  let rows = [];
  if (taskId) ({ rows } = await pool.query('SELECT * FROM experiencias WHERE client_id=$1 AND task_id=$2 ORDER BY ordem LIMIT 12', [clientId, taskId]));
  if (!rows.length && val(tema)) {
    ({ rows } = await pool.query(
      `SELECT * FROM experiencias WHERE client_id=$1 AND ($2 ILIKE '%' || nome || '%' OR nome ILIKE '%' || $2 || '%') ORDER BY ordem LIMIT 8`,
      [clientId, tema]));
  }
  return rows.length ? rows.map(fmtExp).join('\n') : null;
}

async function blocoMateriais(pool, clientId) {
  const { rows } = await pool.query('SELECT categoria, descricao, evitar FROM materials WHERE client_id=$1 ORDER BY evitar DESC, categoria LIMIT 80', [clientId]);
  if (!rows.length) return null;
  const evitar = rows.filter((m) => m.evitar).map((m) => `- ${m.descricao || m.categoria}`);
  const cats = [...new Set(rows.filter((m) => !m.evitar).map((m) => m.categoria).filter(Boolean))];
  return [cats.length ? `Categorias de fotos e vídeos disponíveis: ${cats.join('; ')}` : null,
    evitar.length ? `Materiais a EVITAR ou usar com cuidado (não os sugira):\n${evitar.join('\n')}` : null].filter(Boolean).join('\n');
}

async function blocoExemplos(pool, clientId, tipo, ctx) {
  const { rows } = await pool.query(
    `SELECT texto_final FROM conteudos_gerados WHERE client_id=$1 AND tipo=$2 AND status='usado' AND texto_final IS NOT NULL
     ORDER BY created_at DESC LIMIT 3`, [clientId, tipo]);
  const exemplos = [...rows.map((r) => r.texto_final.slice(0, 1200))];
  if (val(ctx.exemplos)) exemplos.unshift(ctx.exemplos.slice(0, 2500));
  return exemplos.length ? exemplos.map((e, i) => `Exemplo ${i + 1}:\n${e}`).join('\n\n---\n\n') : null;
}

// ---------- Chamada à API do Claude ----------
async function chamarClaude({ system, user, ferramenta, maxTokens }) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    const e = new Error('O agente ainda não está ativo: falta configurar ANTHROPIC_API_KEY no Render.');
    e.status = 503; throw e;
  }
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
        tools: [ferramenta], tool_choice: { type: 'tool', name: ferramenta.name },
      }),
      signal: AbortSignal.timeout(110000),
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
  const bloco = (dados.content || []).find((b) => b.type === 'tool_use');
  if (!bloco || dados.stop_reason === 'max_tokens') {
    const e = new Error('O texto ficou grande demais para uma resposta. Peça uma versão mais curta no briefing.');
    e.status = 502; throw e;
  }
  return { saida: bloco.input, uso: dados.usage || {} };
}

// ---------- Limite simples por pessoa ----------
const usos = new Map();
function dentroDoLimite(userId) {
  const agora = Date.now();
  const lista = (usos.get(userId) || []).filter((t) => agora - t < 3600 * 1000);
  if (lista.length >= LIMITE_POR_HORA) { usos.set(userId, lista); return false; }
  lista.push(agora); usos.set(userId, lista);
  return true;
}

const TIPOS = Object.keys(INSTRUCOES_TIPO);
const texto = (v, max = 4000) => String(v ?? '').slice(0, max);

// ---------- Rotas ----------
module.exports = function registrarAgente(app, { pool, wrap }) {
  app.get('/api/agente/status', (req, res) => res.json({ ativo: !!process.env.ANTHROPIC_API_KEY, modelo: MODELO }));

  app.get('/api/clients/:id/contexto', wrap(async (req, res) => {
    const c = await carregarContexto(pool, req.params.id);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const { ctx, cl } = c;
    res.json({
      tom_de_voz: ctx.tom_de_voz || '', publico: ctx.publico || '', pilares: ctx.pilares || '',
      regras: ctx.regras || '', rodape: ctx.rodape || cl.observacoes || '', exemplos: ctx.exemplos || '',
    });
  }));

  app.put('/api/clients/:id/contexto', wrap(async (req, res) => {
    const b = req.body || {};
    await pool.query(
      `INSERT INTO contexto_cliente (client_id, tom_de_voz, publico, pilares, regras, rodape, exemplos, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (client_id) DO UPDATE SET tom_de_voz=EXCLUDED.tom_de_voz, publico=EXCLUDED.publico, pilares=EXCLUDED.pilares,
         regras=EXCLUDED.regras, rodape=EXCLUDED.rodape, exemplos=EXCLUDED.exemplos, updated_at=now()`,
      [req.params.id, texto(b.tom_de_voz), texto(b.publico), texto(b.pilares), texto(b.regras), texto(b.rodape), texto(b.exemplos, 8000)]);
    res.json({ ok: true });
  }));

  // Gera (ou reescreve com ajustes) o conteúdo de uma tarefa. Aceita os valores atuais do formulário.
  app.post('/api/agente/gerar', wrap(async (req, res) => {
    const b = req.body || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'post';
    const c = await carregarContexto(pool, b.client_id);
    if (!c) return res.status(400).json({ erro: 'Escolha o cliente' });
    if (!val(b.tema) && !val(b.briefing) && !val(b.legenda_atual)) {
      return res.status(400).json({ erro: 'Preencha o tema ou o briefing antes de gerar.' });
    }
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de gerações por hora atingido. Tente mais tarde.' });

    const [programacao, materiais, exemplos] = await Promise.all([
      blocoProgramacao(pool, c.cl.id, Number(b.task_id) || null, b.tema),
      blocoMateriais(pool, c.cl.id),
      blocoExemplos(pool, c.cl.id, tipo, c.ctx),
    ]);
    const secoes = [
      `## CONTEXTO DO CLIENTE\n${blocoCliente(c)}`,
      programacao && `## DADOS DA PROGRAMAÇÃO (fonte oficial; não complete o que estiver vazio)\n${programacao}`,
      materiais && `## MATERIAIS\n${materiais}`,
      exemplos && `## EXEMPLOS APROVADOS (imite o jeito de escrever, não o conteúdo)\n${exemplos}`,
      `## TAREFA\nTipo: ${tipo}${val(b.formato) ? ` · Formato: ${b.formato}` : ''}${val(b.data) ? ` · Data de publicação: ${b.data}` : ''}
Tema: ${val(b.tema) || '(definir a partir do briefing)'}
Editorial: ${val(b.editorial) || '(livre, dentro dos pilares)'}
${tipo === 'blog' ? `Palavra-chave principal: ${val(b.palavra_chave) || '(sugira uma)'}\n` : ''}Briefing:\n${texto(b.briefing, 6000) || '(sem briefing)'}`,
      val(b.anterior) && `## VERSÃO ANTERIOR\n${texto(b.anterior, 9000)}\n\n## AJUSTES PEDIDOS\n${texto(b.feedback, 1500) || 'Melhore mantendo o que funciona.'}\nReescreva aplicando os ajustes.`,
    ].filter(Boolean).join('\n\n');

    const { saida, uso } = await chamarClaude({
      system: `${REGRAS_GERAIS}\n\n${INSTRUCOES_TIPO[tipo]}`,
      user: secoes, ferramenta: FERRAMENTAS[tipo], maxTokens: tipo === 'blog' ? 6000 : 3000,
    });
    const resultado = normalizar(tipo, saida);
    const { rows: [g] } = await pool.query(
      `INSERT INTO conteudos_gerados (client_id, task_id, tipo, entrada, saida, feedback, usuario_id, modelo, tokens_in, tokens_out)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [c.cl.id, Number(b.task_id) || null, tipo, JSON.stringify({ tema: b.tema, formato: b.formato, editorial: b.editorial, briefing: b.briefing }),
        JSON.stringify(resultado), val(b.feedback), req.user.id, MODELO, uso.input_tokens || null, uso.output_tokens || null]);
    res.json({ id: g.id, resultado });
  }));

  // Depois de salvar a tarefa: guarda o texto final (com as edições da equipe) como exemplo aprovado
  app.put('/api/agente/:id/final', wrap(async (req, res) => {
    await pool.query(
      `UPDATE conteudos_gerados SET status='usado', texto_final=$1, task_id=COALESCE($2, task_id) WHERE id=$3`,
      [texto(req.body.texto, 12000) || null, Number(req.body.task_id) || null, req.params.id]);
    res.json({ ok: true });
  }));

  // Sugere pautas para as tarefas do mês que ainda estão sem tema
  app.post('/api/agente/pautas', wrap(async (req, res) => {
    const { client_id: clientId, mes } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(mes || '')) return res.status(400).json({ erro: 'Mês inválido' });
    const c = await carregarContexto(pool, clientId);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const { rows: vazias } = await pool.query(
      `SELECT id, tipo, formato, data FROM tasks WHERE client_id=$1 AND to_char(data,'YYYY-MM')=$2 AND tipo IN ('post','blog')
       AND (tema IS NULL OR tema='' OR tema LIKE 'Artigo de blog (SEO)%') ORDER BY data, id LIMIT 30`, [clientId, mes]);
    if (!vazias.length) return res.json({ pautas: [], aviso: 'Não há posts ou artigos sem pauta neste mês.' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Limite de gerações por hora atingido. Tente mais tarde.' });

    const { rows: feitas } = await pool.query(
      `SELECT data, tipo, tema FROM tasks WHERE client_id=$1 AND to_char(data,'YYYY-MM')=$2 AND tipo IN ('post','blog')
       AND tema IS NOT NULL AND tema<>'' AND tema NOT LIKE 'Artigo de blog (SEO)%' ORDER BY data`, [clientId, mes]);
    const { rows: capt } = await pool.query(`SELECT tema FROM tasks WHERE client_id=$1 AND tipo='captacao' AND status<>'publicado' LIMIT 10`, [clientId]);
    const [y, m] = mes.split('-').map(Number);
    const { rows: exps } = await pool.query(
      `SELECT nome, resort, periodo, status FROM experiencias WHERE client_id=$1 ORDER BY ordem LIMIT 90`, [clientId]);
    const fmtT = (t) => `- id ${t.id} · ${t.tipo} · ${t.data} · formato atual: ${t.formato || 'a definir'}`;

    const user = [
      `## CONTEXTO DO CLIENTE\n${blocoCliente(c)}`,
      `## MÊS\n${String(m).padStart(2, '0')}/${y}`,
      `## TAREFAS SEM PAUTA (preencha todas)\n${vazias.map(fmtT).join('\n')}`,
      feitas.length && `## JÁ PLANEJADAS (não repita)\n${feitas.map((t) => `- ${t.data} · ${t.tipo} · ${t.tema}`).join('\n')}`,
      exps.length && `## EXPERIÊNCIAS E DATAS DA PROGRAMAÇÃO (use as que caírem neste mês; ignore as de outros meses)\n${exps.map((e) => `- ${e.periodo} · ${e.nome} (${e.resort}) · ${e.status}`).join('\n')}`,
      capt.length && `## PRIORIDADES DE CAPTAÇÃO (podem inspirar pautas)\n${capt.map((t) => `- ${t.tema}`).join('\n')}`,
      'Distribua pautas variadas entre os pilares, encaixe datas especiais perto do dia certo, alterne formatos e use "artigo" para tarefas de blog. Os temas devem ser específicos, não genéricos.',
    ].filter(Boolean).join('\n\n');

    const { saida } = await chamarClaude({
      system: `${REGRAS_GERAIS}\n\nTarefa: propor pautas (tema, editorial, formato) para as tarefas listadas. Não escreva as legendas agora.`,
      user, ferramenta: FERRAMENTA_PAUTAS, maxTokens: 4000,
    });
    const ids = new Set(vazias.map((t) => t.id));
    const datas = Object.fromEntries(vazias.map((t) => [t.id, t.data]));
    res.json({ pautas: (saida.pautas || []).filter((p) => ids.has(p.task_id)).map((p) => ({ ...p, data: datas[p.task_id] })) });
  }));
};
