// Comando livre: a pessoa escreve o pedido do jeito que quiser (pode citar vários clientes e vários itens).
// O Claude identifica clientes e demandas, as pautas são criadas e o time executa em fila.
// Tudo termina aguardando a aprovação humana; nada é publicado, enviado ou alterado fora da área de trabalho.

const { cfg } = require('./config');
const { chamarTexto, dentroDoLimite } = require('./projetos');
const { criarDemanda, dataOk, texto } = require('./solicitacoes');
const esteira = require('./esteira');

const MAX_DEMANDAS = 8; // por comando
const SIMULTANEAS = 2; // execuções do time ao mesmo tempo (respeita o limite de requisições da API)
const TIPOS = ['post', 'story', 'blog', 'criacao', 'trafego'];
const DEMANDA_DO_TIPO = (t) => (['post', 'story', 'blog'].includes(t) ? 'conteudo' : t);

// ---------- Fila de execução ----------
const fila = [];
let ativos = 0;
let batimento = null;

function andar(pool) {
  while (ativos < SIMULTANEAS && fila.length) {
    const { id, usuario } = fila.shift();
    ativos++;
    esteira.executar(pool, id, { usuario }).catch(() => {}).finally(() => { ativos--; andar(pool); });
  }
}

function enfileirar(pool, id, usuario) {
  fila.push({ id, usuario });
  // Quem espera na fila continua "executando" na tela: renova o relógio para não ser marcado como travado (10 min).
  if (!batimento) {
    batimento = setInterval(() => {
      if (!fila.length) { clearInterval(batimento); batimento = null; return; }
      pool.query(`UPDATE tasks SET esteira_em=now() WHERE id = ANY($1::bigint[]) AND esteira='executando'`, [fila.map((f) => f.id)]).catch(() => {});
    }, 60000);
    batimento.unref();
  }
  andar(pool);
}

// ---------- Interpretação do pedido ----------
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const hojeRecife = () => { const d = new Date(Date.now() - 3 * 3600e3); return { iso: d.toISOString().slice(0, 10), dia: DIAS[d.getUTCDay()] }; };

const SISTEMA = `Você é a coordenadora do time de uma agência de marketing. Recebe um pedido escrito livremente e o transforma em demandas de trabalho para o time: Hugo (conteúdo: posts, roteiros de stories, artigos de blog), Luiz e Davi (criação de artes e de vídeos) e Camila (tráfego: planos de campanha). Escreva em português do Brasil.
Regras:
1. Use SOMENTE clientes da lista, sempre pelo "client_id".
2. Se o pedido citar vários clientes ou vários itens (ex.: "3 posts", "a semana de posts"), crie uma demanda para cada item, no máximo ${MAX_DEMANDAS} no total. Se pedir mais, crie as ${MAX_DEMANDAS} primeiras e avise em "duvidas".
3. Se o cliente não estiver claro, NÃO invente: deixe a demanda de fora e explique em "duvidas".
4. Nunca invente fatos, preços, datas ou promessas: o que faltar vai no "briefing" como [CONFIRMAR: ...].
5. Se o pedido não for um trabalho para o time (for uma pergunta, ou pedir para publicar, enviar mensagens, mudar configurações ou acessar contas), não crie demandas. Em "resumo", explique que o time produz textos, roteiros, briefings de arte e vídeo e planos de campanha para a APROVAÇÃO dela, e que nada é publicado ou alterado sozinho.
6. "prazo" no formato AAAA-MM-DD só quando o pedido trouxer data ou dia da semana (calcule a partir de HOJE); senão null.
Responda APENAS um objeto JSON com as chaves:
"resumo" (1 ou 2 frases do que será feito),
"demandas" (lista de objetos com: "client_id" número; "tipo" um entre post, story, blog, criacao, trafego; "tema" curto e específico, até 90 caracteres; "formato" (estático, carrossel, reels, story, artigo, arte estática, vídeo ou campanha); "editorial" pilar ou objetivo, até 60 caracteres; "briefing" instruções claras para quem vai executar: objetivo, público, mensagem, o que entregar e pendências a confirmar; "prazo"),
"duvidas" (lista de textos curtos; vazia se não houver).`;

function extrairJson(saida) {
  const i = saida.indexOf('{'); const j = saida.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(saida.slice(i, j + 1)); } catch { return null; }
}

// Valida o que a IA devolveu: só entram demandas de clientes permitidos, com tipo e texto válidos.
function validarPlano(plano, permitidos, pedido) {
  const demandas = [];
  const duvidas = Array.isArray(plano?.duvidas) ? plano.duvidas.map((d) => texto(d, 300)).filter(Boolean).slice(0, 6) : [];
  for (const d of Array.isArray(plano?.demandas) ? plano.demandas : []) {
    const cl = permitidos.get(Number(d?.client_id));
    const tema = texto(d?.tema, 160);
    const briefing = texto(d?.briefing, 6000);
    if (!cl || !tema || !briefing || !TIPOS.includes(d.tipo)) { duvidas.push(`Não consegui montar a demanda "${tema || 'sem título'}"${cl ? '' : ' (cliente não identificado)'}.`); continue; }
    demandas.push({
      cl, tipo: d.tipo, tema,
      prazo: dataOk(d.prazo) ? d.prazo : null,
      pauta: {
        tema, tipo: d.tipo, formato: texto(d.formato, 40) || null, editorial: texto(d.editorial, 120) || 'Comando livre',
        briefing: `${briefing}\n\n— Pedido original —\n${pedido}`, ia: true,
      },
    });
  }
  return { resumo: texto(plano?.resumo, 600), demandas: demandas.slice(0, MAX_DEMANDAS), duvidas };
}

function registrar(app, { pool, wrap }) {
  app.post('/api/comandos', wrap(async (req, res) => {
    const b = req.body || {};
    const pedido = texto(b.texto, 4000);
    if (!pedido) return res.status(400).json({ erro: 'Escreva o comando' });
    if (!cfg('ANTHROPIC_API_KEY')) return res.status(503).json({ erro: 'Os agentes não estão ativos: falta a chave do Claude em Integrações.' });
    if (!dentroDoLimite(req.user.id)) return res.status(429).json({ erro: 'Muitos pedidos ao time nesta hora. Tente de novo mais tarde.' });

    // Clientes que o comando pode usar (nunca do projeto Empregos); a tela pode restringir por cliente ou por projeto
    const v = []; let filtro = '';
    if (b.client_id) { v.push(Number(b.client_id)); filtro = ` AND c.id=$${v.length}`; }
    else if (b.project_id) { v.push(Number(b.project_id)); filtro = ` AND c.project_id=$${v.length}`; }
    const { rows: clientes } = await pool.query(
      `SELECT c.id, c.nome, c.project_id, p.nome AS projeto FROM clients c JOIN projects p ON p.id=c.project_id
       WHERE p.tipo IS DISTINCT FROM 'empregos'${filtro} ORDER BY p.ordem, p.nome, c.nome`, v);
    if (!clientes.length) return res.status(400).json({ erro: 'Nenhum cliente disponível para este comando' });
    const permitidos = new Map(clientes.map((c) => [c.id, c]));

    const h = hojeRecife();
    const saida = await chamarTexto({
      system: SISTEMA,
      user: `HOJE: ${h.iso} (${h.dia})\nCLIENTES (client_id | nome | projeto):\n${clientes.map((c) => `${c.id} | ${c.nome} | ${c.projeto}`).join('\n')}\n${clientes.length === 1 ? `\nTodas as demandas são do cliente ${clientes[0].id}.\n` : ''}\nPEDIDO:\n${pedido}`,
      maxTokens: 4000, timeoutMs: 80000,
    });
    const plano = extrairJson(saida);
    if (!plano) return res.status(502).json({ erro: 'Não consegui entender o pedido. Reescreva com um pouco mais de detalhe e tente de novo.' });
    const { resumo, demandas, duvidas } = validarPlano(plano, permitidos, pedido);

    const criadas = []; const ignoradas = [];
    for (const d of demandas) {
      if (!dentroDoLimite(req.user.id)) { ignoradas.push(`${d.tema} (limite de pedidos por hora atingido)`); continue; }
      const r = await criarDemanda(pool, {
        cl: d.cl, tipo: DEMANDA_DO_TIPO(d.tipo), demanda: texto(`${d.tema}\n\n${d.pauta.briefing}`, 4000), prazo: d.prazo,
        user: req.user, pauta: d.pauta, iniciar: (id) => enfileirar(pool, id, req.user.email),
      });
      criadas.push({ tarefa: r.tarefa, cliente: { id: d.cl.id, nome: d.cl.nome }, projeto: { id: d.cl.project_id, nome: d.cl.projeto }, executando: r.executando });
    }
    res.json({ resumo, criadas, duvidas, ignoradas });
  }));
}

module.exports = { registrar, validarPlano, extrairJson };
