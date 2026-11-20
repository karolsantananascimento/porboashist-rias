// SaaS do gestor de tráfego: assinantes criam a conta, colam as próprias chaves (Meta e Google), pagam a mensalidade
// e rodam as próprias campanhas. O sistema interno (administrador e equipe) continua separado.
//
// Isolamento (regras que não podem ser quebradas):
//  - um assinante só alcança /api/saas/* (server.js bloqueia o resto da API);
//  - a conta vem SEMPRE da sessão, nunca de um parâmetro do pedido;
//  - as chaves são lidas só do escopo do próprio assinante (config.cfgProprio): jamais caem nas chaves do administrador;
//  - chaves ficam criptografadas (ACESSOS_KEY) e nunca voltam inteiras para a tela;
//  - campanhas nascem PAUSADAS e só são ativadas com confirmação; nada é excluído nas plataformas.

const crypto = require('crypto');
const config = require('./config');
const meta = require('./campanhas');
const gads = require('./googleads');
const billing = require('./billing');
const { GRUPOS, PERMITIDAS, normalizarValor } = require('./saas-chaves');
const { hashSenha, conferirSenha } = require('./db');

const ESCOPO_BASE = 1_000_000;
const escopoDe = (conta) => ESCOPO_BASE + conta.id; // escopo do cliente principal da conta
const ESCOPO_CLIENTE_BASE = 2_000_000;
const escopoCliente = (cliente) => cliente.escopo;
// Planos de venda (/gestoragent). O plano é um rótulo administrado por você; o limite de clientes ainda não é aplicado pelo sistema.
const PLANOS = { solo: { nome: 'Solo', clientes: 1, preco: 370 }, agencia: { nome: 'Agência', clientes: 3, preco: 760 }, escala: { nome: 'Escala', clientes: 5, preco: 950 } };
const PRECO_BI = 50;
const TRIAL_DIAS = Number(process.env.SAAS_TRIAL_DIAS ?? 7);
const IA_LIMITE_MES = Number(process.env.SAAS_IA_MES || 30);
const ATIVACOES_DIA = Number(process.env.SAAS_ATIVACOES_DIA || 10);
const MAX_CAMPANHAS = 300;
const MAX_MIDIAS = 200;
const MAX_MIDIA_BYTES = 8 * 1024 * 1024;
let poolRef = null;
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// ---------- Situação da assinatura ----------
function situacao(c) {
  const agora = Date.now();
  const trialAte = c.trial_ate ? new Date(c.trial_ate).getTime() : 0;
  if (c.status === 'bloqueada') return { ativa: false, codigo: 'bloqueada', texto: 'Conta bloqueada. Fale com o suporte.' };
  if (c.cortesia) return { ativa: true, codigo: 'cortesia', texto: 'Acesso liberado' };
  if (c.status === 'ativa') return { ativa: true, codigo: 'ativa', texto: 'Assinatura ativa' };
  if (c.status === 'trial') {
    if (trialAte > agora) return { ativa: true, codigo: 'trial', texto: 'Período de teste', dias_trial: Math.max(1, Math.ceil((trialAte - agora) / 86400000)) };
    return { ativa: false, codigo: 'trial_expirado', texto: 'Seu período de teste terminou. Assine para continuar criando campanhas.' };
  }
  if (c.status === 'inadimplente') return { ativa: false, codigo: 'inadimplente', texto: 'Não conseguimos cobrar a mensalidade. Atualize o cartão para continuar.' };
  return { ativa: false, codigo: 'cancelada', texto: 'Assinatura cancelada. Assine de novo para voltar a criar campanhas.' };
}

const publicoConta = (c, u) => {
  const s = situacao(c);
  return {
    id: c.id, email: u.email, nome: u.nome, empresa: c.empresa, status: c.status, situacao: s, cortesia: c.cortesia,
    trial_ate: c.trial_ate, periodo_fim: c.periodo_fim, tem_assinatura: !!c.stripe_subscription_id,
    plano: c.plano, plano_nome: PLANOS[c.plano]?.nome || c.plano, clientes_max: PLANOS[c.plano]?.clientes ?? 1, bi: !!c.bi,
    ia: { usados: c.ia_mes === mesAtual() ? c.ia_usos : 0, limite: IA_LIMITE_MES },
  };
};
const clientePublico = (k) => ({ id: k.id, nome: k.nome, principal: k.principal });
const mesAtual = () => new Date().toISOString().slice(0, 7);

async function evento(pool, contaId, tipo, detalhe) {
  await pool.query('INSERT INTO saas_eventos (conta_id, tipo, detalhe) VALUES ($1,$2,$3)', [contaId, tipo, String(detalhe || '').slice(0, 400)]).catch(() => {});
}


// ---------- Criativos enviados (imagens JPG/PNG guardadas por cliente) ----------
function inspecionarImagem(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { mime: 'image/jpeg', largura: 0, altura: 0 };
  }
  return null;
}

// ---------- Contextos de cada plataforma (só chaves do próprio assinante) ----------
function contextoMeta(cliente) {
  const e = escopoCliente(cliente); const le = (k) => config.cfgProprio(k, e);
  const token = le('META_ADS_TOKEN');
  if (!token) throw erro('O Meta Ads ainda não está configurado: cole o token de acesso em Chaves de API.');
  const idc = String(le('META_AD_ACCOUNT_ID') || '').trim();
  return {
    token, conta: idc ? (idc.startsWith('act_') ? idc : `act_${idc}`) : '', pixel: le('META_PIXEL_ID') || '',
    teto: Number(le('META_MAX_DAILY_BUDGET_BRL')) || meta.TETO_PADRAO_BRL, page: le('META_PAGE_ID') || '', ig: le('META_IG_ID') || '', pageNome: '',
    // criativos enviados pelo assinante: só lê imagem do próprio cliente
    carregarMidia: async (id) => {
      if (!poolRef) return null;
      const { rows: [m] } = await poolRef.query('SELECT id, nome, mime, dados FROM saas_midias WHERE id=$1 AND cliente_id=$2', [Number(id), cliente.id]);
      return m || null;
    },
  };
}
const contextoGoogle = (cliente) => gads.contexto((k) => config.cfgProprio(k, escopoCliente(cliente)));

// ---------- Rascunho por IA (cota mensal por assinante) ----------
async function reservarIa(pool, conta) {
  const { rows } = await pool.query(
    `UPDATE saas_contas SET ia_usos = CASE WHEN ia_mes=$2 THEN ia_usos+1 ELSE 1 END, ia_mes=$2
     WHERE id=$1 AND (ia_mes IS DISTINCT FROM $2 OR ia_usos < $3) RETURNING ia_usos`, [conta.id, mesAtual(), IA_LIMITE_MES]);
  if (!rows[0]) throw erro(`Você usou os ${IA_LIMITE_MES} rascunhos com IA deste mês. Eles voltam no início do próximo mês; enquanto isso dá para montar campanhas manualmente.`, 429);
}
const devolverIa = (pool, conta) => pool.query(
  `UPDATE saas_contas SET ia_usos = GREATEST(ia_usos-1,0) WHERE id=$1 AND ia_mes=$2`, [conta.id, mesAtual()]).catch(() => {});

async function rascunhoIa(pool, conta, empresa, briefing) {
  const { chamarTexto } = require('./projetos');
  const { extrairJson } = require('./comandos');
  const txt = (v, n) => String(v ?? '').trim().slice(0, n);
  const saida = await chamarTexto({
    system: meta.SISTEMA_RASCUNHO,
    user: `CLIENTE: ${txt(empresa, 120) || 'Anunciante'}\nHOJE: ${new Date().toISOString().slice(0, 10)}\nTEMA: ${txt(briefing, 120)}\n\nPEDIDO, BRIEFING E PLANO:\n${txt(briefing, 6000)}`,
    maxTokens: 3000, timeoutMs: 90000,
  });
  const j = extrairJson(saida);
  if (!j || typeof j.campanha !== 'object') throw erro('Não consegui montar o rascunho. Descreva a campanha com mais detalhes e tente de novo.', 502);
  const spec = meta.normalizar(j.campanha);
  const pend = (Array.isArray(j.pendencias) ? j.pendencias : []).map((x) => txt(x, 300)).filter(Boolean).slice(0, 12);
  const falta = meta.faltando(spec); if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
  return { spec, pend };
}

// ---------- Registro público (sem login): cadastro, preço e webhook do Stripe ----------
function registrarPublico(app, { pool, wrap, criarSessao }) {
  const tentativas = new Map();
  const limitar = (ip) => {
    const t = tentativas.get(ip); const agora = Date.now();
    if (!t || agora - t.desde > 3600000) { tentativas.set(ip, { n: 1, desde: agora }); return false; }
    t.n++; return t.n > 8;
  };

  app.get('/api/saas/publico', (req, res) => res.json({
    preco: process.env.SAAS_PRECO_TEXTO || '', trial_dias: TRIAL_DIAS, cobranca: billing.configurado(), termos_url: process.env.SAAS_TERMOS_URL || '',
  }));

  app.post('/api/saas/cadastro', wrap(async (req, res) => {
    if (limitar(req.ip)) throw erro('Muitos cadastros deste endereço. Tente de novo mais tarde.', 429);
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const nome = String(b.nome || '').trim().slice(0, 120);
    const empresa = String(b.empresa || '').trim().slice(0, 120);
    const senha = String(b.senha || '');
    const plano = Object.hasOwn(PLANOS, b.plano) ? b.plano : 'solo';
    const bi = b.bi === true;
    if (!nome) throw erro('Informe o seu nome.');
    if (!emailValido(email)) throw erro('E-mail inválido.');
    if (senha.length < 8) throw erro('A senha precisa ter pelo menos 8 caracteres.');
    if (b.aceite !== true) throw erro('Para criar a conta é preciso aceitar os termos de uso.');
    const c = await pool.connect();
    let user; let conta;
    try {
      await c.query('BEGIN');
      ({ rows: [user] } = await c.query(
        `INSERT INTO users (email, nome, senha_hash, papel, trocar_senha, aceite_termos_em) VALUES ($1,$2,$3,'assinante',false,now()) RETURNING *`,
        [email, nome, hashSenha(senha)]));
      ({ rows: [conta] } = await c.query(
        `INSERT INTO saas_contas (user_id, empresa, status, trial_ate, plano, bi) VALUES ($1,$2,'trial', now() + ($3 || ' days')::interval, $4, $5) RETURNING *`,
        [user.id, empresa || null, String(TRIAL_DIAS), plano, bi]));
      await c.query('INSERT INTO saas_clientes (conta_id, nome, escopo, principal) VALUES ($1,$2,$3,true)', [conta.id, empresa || nome || 'Meu cliente', escopoDe(conta)]);
      await c.query('INSERT INTO saas_eventos (conta_id, tipo, detalhe) VALUES ($1,$2,$3)', [conta.id, 'cadastro', 'Conta criada']);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      if (e.code === '23505') throw erro('Já existe uma conta com esse e-mail. Entre com a sua senha.', 409);
      throw e;
    } finally { c.release(); }
    criarSessao(res, user);
    res.json({ ok: true });
  }));

  // Webhook do Stripe: valida a assinatura sobre o corpo bruto antes de confiar em qualquer coisa
  app.post('/api/saas/webhook', wrap(async (req, res) => {
    if (!billing.conferirAssinatura(req.rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ erro: 'Assinatura inválida' });
    }
    try { await billing.aplicarEvento(pool, req.body); } catch (e) { console.error('Webhook Stripe', req.body?.type, e.message); return res.status(500).json({ erro: 'Falha ao processar' }); }
    res.json({ recebido: true });
  }));
}

// ---------- Rotas autenticadas ----------
function registrar(app, { pool, wrap, soAdmin, gerarConvite, suporte }) {
  poolRef = pool;
  const base = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

  // Todas as rotas do assinante partem daqui: a conta vem da sessão
  const assinante = wrap(async (req, res, next) => {
    if (req.user.papel === 'admin') {
      // Modo suporte: a administradora vê e opera a conta do assinante escolhido (cookie próprio, 2 horas)
      const alvoId = suporte.ler(req, req.user);
      if (!alvoId) return res.status(403).json({ erro: 'Esta área é para assinantes.' });
      const { rows: [alvo] } = await pool.query(`SELECT * FROM users WHERE id=$1 AND papel='assinante'`, [alvoId]);
      if (!alvo) { suporte.encerrar(res); return res.status(403).json({ erro: 'Conta em atendimento não encontrada.' }); }
      req.suporte = { admin: req.user.email }; req.admin = req.user; req.user = alvo;
    } else if (req.user.papel !== 'assinante') return res.status(403).json({ erro: 'Esta área é para assinantes.' });
    const { rows: [c] } = await pool.query('SELECT * FROM saas_contas WHERE user_id=$1', [req.user.id]);
    if (!c) return res.status(403).json({ erro: 'Conta de assinante não encontrada.' });
    req.conta = c;
    let { rows: cls } = await pool.query('SELECT * FROM saas_clientes WHERE conta_id=$1 ORDER BY principal DESC, id', [c.id]);
    if (!cls.length) { // conta antiga ou criada por fora: garante o cliente principal
      ({ rows: cls } = await pool.query(
        `INSERT INTO saas_clientes (conta_id, nome, escopo, principal) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING RETURNING *`,
        [c.id, c.empresa || 'Meu cliente', escopoDe(c)]));
      if (!cls.length) ({ rows: cls } = await pool.query('SELECT * FROM saas_clientes WHERE conta_id=$1 ORDER BY principal DESC, id', [c.id]));
    }
    const pedido = req.headers['x-cliente'];
    const cl = pedido ? cls.find((x) => String(x.id) === String(pedido)) : cls[0];
    if (!cl) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    req.clientes = cls; req.cliente = cl;
    // Tudo o que a administradora muda na conta do assinante fica registrado
    if (req.suporte && req.method !== 'GET') await evento(pool, c.id, 'suporte_acao', `${req.suporte.admin}: ${req.method} ${req.path}`);
    next();
  });
  // Rotas que gastam ou criam: exigem assinatura em dia (ou período de teste)
  const emDia = (req, res, next) => {
    const s = situacao(req.conta);
    if (s.ativa) return next();
    res.status(402).json({ erro: s.texto, codigo: s.codigo });
  };
  // No modo suporte ficam bloqueadas as ações que gastam dinheiro do assinante, mexem na cobrança ou apagam a conta
  const semSuporte = (req, res, next) => (req.suporte
    ? res.status(403).json({ erro: 'No modo suporte esta ação fica bloqueada: ela gasta dinheiro, mexe na cobrança ou apaga a conta do assinante. Peça para ele fazer.' })
    : next());
  const idDe = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw erro('Identificador inválido'); return n; };
  const carregar = async (req) => {
    const { rows: [c] } = await pool.query('SELECT * FROM saas_campanhas WHERE id=$1 AND conta_id=$2 AND cliente_id=$3', [idDe(req), req.conta.id, req.cliente.id]);
    if (!c) throw erro('Campanha não encontrada', 404);
    return c;
  };
  const confirmar = (req, msg) => { if (req.body?.confirmado !== true) throw erro(msg); };
  const ativacoesHoje = async (contaId) => (await pool.query(
    `SELECT count(*)::int n FROM saas_eventos WHERE conta_id=$1 AND tipo='campanha_ativada'
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Recife') AT TIME ZONE 'America/Recife'`, [contaId])).rows[0].n;

  // ----- Perfil e situação da conta -----
  app.get('/api/saas/eu', assinante, wrap(async (req, res) => {
    res.json({
      conta: publicoConta(req.conta, req.user), cobranca: billing.configurado(), preco: process.env.SAAS_PRECO_TEXTO || '',
      clientes: req.clientes.map(clientePublico), cliente_atual: req.cliente.id, suporte: req.suporte || null,
    });
  }));

  // ----- Clientes do assinante (cada um com as próprias chaves e campanhas) -----
  const limiteClientes = (conta) => PLANOS[conta.plano]?.clientes ?? 1;
  app.get('/api/saas/clientes', assinante, wrap(async (req, res) => {
    res.json({ clientes: req.clientes.map(clientePublico), atual: req.cliente.id, max: limiteClientes(req.conta) });
  }));
  app.post('/api/saas/clientes', assinante, wrap(async (req, res) => {
    const nome = String(req.body?.nome || '').trim().slice(0, 120);
    if (!nome) throw erro('Informe o nome do cliente.');
    const max = limiteClientes(req.conta);
    const { rows: [n] } = await pool.query(
      `WITH novo AS (SELECT nextval('saas_clientes_id_seq')::int AS id)
       INSERT INTO saas_clientes (id, conta_id, nome, escopo)
       SELECT novo.id, $1, $2, $3 + novo.id FROM novo
        WHERE (SELECT count(*) FROM saas_clientes WHERE conta_id=$1) < $4 RETURNING *`,
      [req.conta.id, nome, ESCOPO_CLIENTE_BASE, max]);
    if (!n) throw erro(`O plano ${PLANOS[req.conta.plano]?.nome || ''} permite ${max} cliente${max > 1 ? 's' : ''}. Para gerenciar mais, fale com o suporte e mude de plano.`, 403);
    await evento(pool, req.conta.id, 'cliente_criado', nome);
    res.json({ cliente: clientePublico(n) });
  }));
  app.put('/api/saas/clientes/:id', assinante, wrap(async (req, res) => {
    const nome = String(req.body?.nome || '').trim().slice(0, 120);
    if (!nome) throw erro('Informe o nome do cliente.');
    const { rows: [n] } = await pool.query('UPDATE saas_clientes SET nome=$3 WHERE id=$1 AND conta_id=$2 RETURNING *', [idDe(req), req.conta.id, nome]);
    if (!n) throw erro('Cliente não encontrado.', 404);
    res.json({ cliente: clientePublico(n) });
  }));
  app.delete('/api/saas/clientes/:id', assinante, wrap(async (req, res) => {
    const cl = req.clientes.find((x) => x.id === idDe(req));
    if (!cl) throw erro('Cliente não encontrado.', 404);
    if (cl.principal) throw erro('O cliente principal não pode ser excluído. Renomeie-o, se quiser.');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM configuracoes WHERE client_id=$1', [cl.escopo]);
      await c.query('DELETE FROM conexoes WHERE client_id=$1', [cl.escopo]);
      await c.query('DELETE FROM saas_clientes WHERE id=$1', [cl.id]); // apaga as campanhas guardadas em cascata
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
    await config.carregar(pool);
    await evento(pool, req.conta.id, 'cliente_excluido', cl.nome);
    res.json({ ok: true });
  }));

  app.put('/api/saas/conta', assinante, wrap(async (req, res) => {
    const empresa = String(req.body?.empresa ?? '').trim().slice(0, 120) || null;
    const { rows: [c] } = await pool.query('UPDATE saas_contas SET empresa=$2, updated_at=now() WHERE id=$1 RETURNING *', [req.conta.id, empresa]);
    res.json({ conta: publicoConta(c, req.user) });
  }));

  // Exclusão da conta e das chaves (LGPD). Quem tem assinatura paga precisa cancelá-la antes.
  app.post('/api/saas/conta/excluir', assinante, semSuporte, wrap(async (req, res) => {
    if (!conferirSenha(String(req.body?.senha || ''), req.user.senha_hash)) throw erro('Senha incorreta.');
    if (req.conta.stripe_subscription_id && req.conta.status === 'ativa' && !req.conta.cortesia) {
      throw erro('Cancele a assinatura em "Assinatura → Gerenciar pagamento" antes de excluir a conta, para não continuar sendo cobrado.');
    }
    await excluirConta(pool, req.conta);
    res.setHeader('Set-Cookie', 'pbh_sessao=; Path=/; Max-Age=0');
    res.json({ ok: true });
  }));

  // ----- Chaves de API -----
  app.get('/api/saas/chaves', assinante, wrap(async (req, res) => {
    const e = escopoCliente(req.cliente);
    const lista = config.listarProprio(e, [...PERMITIDAS]);
    const por = Object.fromEntries(lista.map((x) => [x.chave, x]));
    res.json({
      grupos: GRUPOS.map((g) => ({
        id: g.id, titulo: g.titulo, intro: g.intro,
        campos: g.campos.map((c) => ({ ...c, secreto: por[c.chave].secreto, definido: por[c.chave].definido, previa: por[c.chave].previa })),
      })),
    });
  }));

  app.put('/api/saas/chaves', assinante, wrap(async (req, res) => {
    const chave = String(req.body?.chave || '');
    if (!PERMITIDAS.has(chave)) throw erro('Chave desconhecida.');
    const valor = normalizarValor(chave, req.body?.valor);
    await config.definir(pool, chave, valor, escopoCliente(req.cliente));
    await evento(pool, req.conta.id, 'chave_salva', chave);
    res.json({ ok: true });
  }));

  app.delete('/api/saas/chaves/:chave', assinante, wrap(async (req, res) => {
    if (!PERMITIDAS.has(req.params.chave)) throw erro('Chave desconhecida.');
    await config.remover(pool, req.params.chave, escopoCliente(req.cliente));
    await evento(pool, req.conta.id, 'chave_removida', req.params.chave);
    res.json({ ok: true });
  }));

  // Testes de conexão (só leituras). Respondem 200 com ok:true/false para a tela mostrar verde ou vermelho.
  app.post('/api/saas/testar/meta', assinante, wrap(async (req, res) => {
    try {
      const ctx = contextoMeta(req.cliente);
      if (!ctx.conta) throw erro('Falta o ID da conta de anúncios.');
      const ct = await meta.get(ctx, ctx.conta, { fields: 'name,account_status,currency' });
      const out = { conta: ct.name || ctx.conta, moeda: ct.currency || null, ativa: ct.account_status === 1 };
      if (ctx.page) { const pg = await meta.get(ctx, ctx.page, { fields: 'name' }); out.pagina = pg.name || ctx.page; }
      else out.aviso = 'Falta o ID da página do Facebook para poder subir campanhas.';
      res.json({ ok: true, ...out });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
  }));

  app.post('/api/saas/testar/google', assinante, wrap(async (req, res) => {
    try { res.json({ ok: true, ...(await gads.testar(contextoGoogle(req.cliente))) }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
  }));

  // ----- Campanhas (rascunhos e histórico, Meta e Google) -----
  app.get('/api/saas/campanhas', assinante, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM saas_campanhas WHERE conta_id=$1 AND cliente_id=$2 ORDER BY id DESC LIMIT 100', [req.conta.id, req.cliente.id]);
    res.json(rows);
  }));


  // ----- Criativos (imagens) do cliente: enviadas aqui e subidas ao Meta junto com a campanha -----
  const metaMidia = (m) => ({ id: m.id, nome: m.nome, mime: m.mime, tamanho: m.tamanho, largura: m.largura, altura: m.altura, url: `/api/saas/midias/${m.id}/arquivo`, token: `midia:${m.id}` });
  app.get('/api/saas/midias', assinante, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id, nome, mime, tamanho, largura, altura FROM saas_midias WHERE cliente_id=$1 ORDER BY id DESC LIMIT 100', [req.cliente.id]);
    res.json({ midias: rows.map(metaMidia) });
  }));
  app.post('/api/saas/midias', assinante, emDia, semSuporte, require('express').raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_MIDIA_BYTES }), wrap(async (req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || !b.length) throw erro('Envie uma imagem JPG ou PNG de até 8 MB.');
    const info = inspecionarImagem(b);
    if (!info) throw erro('Formato não aceito. Envie imagem JPG ou PNG.');
    if (info.largura && (info.largura < 200 || info.altura < 200)) throw erro('Imagem muito pequena: use pelo menos 200 px de largura e altura (ideal 1080 px).');
    const { rows: [{ n }] } = await pool.query('SELECT count(*)::int n FROM saas_midias WHERE cliente_id=$1', [req.cliente.id]);
    if (n >= MAX_MIDIAS) throw erro('Você chegou ao limite de imagens guardadas deste cliente. Exclua as que não usa mais.');
    let nome = ''; try { nome = decodeURIComponent(String(req.headers['x-nome-arquivo'] || '')); } catch { /* nome ilegível */ }
    nome = nome.replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120) || 'imagem';
    const { rows: [m] } = await pool.query(
      'INSERT INTO saas_midias (conta_id, cliente_id, nome, mime, tamanho, largura, altura, dados) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nome, mime, tamanho, largura, altura',
      [req.conta.id, req.cliente.id, nome, info.mime, b.length, info.largura || null, info.altura || null, b]);
    res.json({ midia: metaMidia(m) });
  }));
  app.get('/api/saas/midias/:id/arquivo', assinante, wrap(async (req, res) => {
    const { rows: [m] } = await pool.query('SELECT mime, dados FROM saas_midias WHERE id=$1 AND cliente_id=$2', [Number(req.params.id) || 0, req.cliente.id]);
    if (!m) throw erro('Imagem não encontrada.', 404);
    res.set({ 'Content-Type': m.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(m.dados);
  }));
  app.delete('/api/saas/midias/:id', assinante, semSuporte, wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const { rows: [uso] } = await pool.query(`SELECT 1 FROM saas_campanhas WHERE cliente_id=$1 AND status IN ('rascunho','erro') AND (spec->>'imagem_url'=$2 OR spec->'imagens_urls' ? $2) LIMIT 1`, [req.cliente.id, `midia:${id}`]);
    if (uso) throw erro('Esta imagem está em um rascunho de campanha. Troque a imagem no rascunho antes de excluir.', 409);
    const r = await pool.query('DELETE FROM saas_midias WHERE id=$1 AND cliente_id=$2', [id, req.cliente.id]);
    if (!r.rowCount) throw erro('Imagem não encontrada.', 404);
    res.json({ ok: true });
  }));

  const contarCampanhas = async (contaId) => (await pool.query('SELECT count(*)::int n FROM saas_campanhas WHERE conta_id=$1', [contaId])).rows[0].n;

  app.post('/api/saas/campanhas', assinante, emDia, wrap(async (req, res) => {
    if (await contarCampanhas(req.conta.id) >= MAX_CAMPANHAS) throw erro('Você chegou ao limite de campanhas guardadas. Exclua rascunhos antigos.');
    const spec = meta.normalizar(req.body?.spec || {});
    const pend = []; const falta = meta.faltando(spec); if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
    const { rows: [c] } = await pool.query(
      `INSERT INTO saas_campanhas (conta_id, cliente_id, plataforma, spec, pendencias) VALUES ($1,$4,'meta',$2,$3) RETURNING *`, [req.conta.id, spec, JSON.stringify(pend), req.cliente.id]);
    res.json({ campanha: c });
  }));

  // A IA lê o pedido do assinante e monta o rascunho. Nada vai para o Meta: ele revisa antes.
  app.post('/api/saas/campanhas/ia', assinante, emDia, wrap(async (req, res) => {
    const briefing = String(req.body?.briefing || '').trim();
    if (briefing.length < 20) throw erro('Descreva a campanha: objetivo, quanto quer gastar por dia, cidades, público e o que está sendo anunciado.');
    if (await contarCampanhas(req.conta.id) >= MAX_CAMPANHAS) throw erro('Você chegou ao limite de campanhas guardadas. Exclua rascunhos antigos.');
    await reservarIa(pool, req.conta);
    let r;
    try { r = await rascunhoIa(pool, req.conta, req.cliente.nome || req.conta.empresa, briefing); } catch (e) { await devolverIa(pool, req.conta); throw e; }
    const { rows: [c] } = await pool.query(
      `INSERT INTO saas_campanhas (conta_id, cliente_id, plataforma, spec, pendencias, briefing) VALUES ($1,$5,'meta',$2,$3,$4) RETURNING *`,
      [req.conta.id, r.spec, JSON.stringify(r.pend), briefing.slice(0, 6000), req.cliente.id]);
    res.json({ campanha: c });
  }));

  app.put('/api/saas/campanhas/:id', assinante, emDia, wrap(async (req, res) => {
    const c = await carregar(req);
    if (c.plataforma !== 'meta') throw erro('Só rascunhos do Meta podem ser editados aqui.');
    if (!['rascunho', 'erro'].includes(c.status)) throw erro('Esta campanha já foi criada no Meta e não pode mais ser editada aqui.', 409);
    const spec = meta.normalizar(req.body?.spec || {});
    let teto = meta.TETO_PADRAO_BRL; try { teto = contextoMeta(req.cliente).teto; } catch { /* usa o padrão */ }
    const pend = []; const falta = meta.faltando(spec, { teto }); if (falta.length) pend.push(`Falta preencher: ${falta.join(', ')}.`);
    const { rows: [n] } = await pool.query(
      `UPDATE saas_campanhas SET spec=$1, pendencias=$2, status='rascunho', erro=NULL, updated_at=now() WHERE id=$3 AND status IN ('rascunho','erro') RETURNING *`,
      [spec, JSON.stringify(pend), c.id]);
    if (!n) throw erro('Esta campanha já foi criada no Meta e não pode mais ser editada aqui.', 409);
    res.json({ campanha: n });
  }));

  app.delete('/api/saas/campanhas/:id', assinante, wrap(async (req, res) => {
    const c = await carregar(req);
    if (!['rascunho', 'erro'].includes(c.status) && c.plataforma === 'meta') throw erro('Esta campanha já existe no Meta. Pause ou exclua por lá; aqui só rascunhos saem da lista.', 409);
    if (c.ids?.campanha_id && c.status !== 'rascunho' && c.status !== 'erro') throw erro('Esta campanha já existe na plataforma. Exclua por lá.', 409);
    await pool.query('DELETE FROM saas_campanhas WHERE id=$1', [c.id]);
    res.json({ ok: true });
  }));

  // Só leituras no Meta: confere o rascunho e mostra o que vai ser criado
  app.post('/api/saas/campanhas/:id/conferir', assinante, emDia, wrap(async (req, res) => {
    const c = await carregar(req);
    const ctx = contextoMeta(req.cliente);
    try { res.json({ ok: true, ...(await meta.conferir(ctx, c.spec)) }); } catch (e) { res.json({ ok: false, erro: e.message }); }
  }));

  // Cria tudo PAUSADO. O clique do assinante, com confirmado: true, é a autorização.
  app.post('/api/saas/campanhas/:id/subir', assinante, semSuporte, emDia, wrap(async (req, res) => {
    confirmar(req, 'Confirme a criação da campanha.');
    const c0 = await carregar(req);
    const ctx = contextoMeta(req.cliente);
    const prob = meta.validar(c0.spec, ctx); if (prob) throw erro(prob);
    const { rows: [c] } = await pool.query(
      `UPDATE saas_campanhas SET status='criando', erro=NULL, updated_at=now() WHERE id=$1 AND status IN ('rascunho','erro') RETURNING *`, [c0.id]);
    if (!c) throw erro('Esta campanha já está sendo criada ou já foi criada.', 409);
    try {
      const ids = await meta.subirCampanha(ctx, c.spec);
      const sobra = [...(c0.ids?.restos_pausados || []), ...(c0.ids?.campanha_id ? [c0.ids.campanha_id] : [])];
      if (sobra.length) ids.restos_pausados = sobra;
      const { rows: [n] } = await pool.query(`UPDATE saas_campanhas SET status='criada_pausada', ids=$2, criada_em=now(), updated_at=now() WHERE id=$1 RETURNING *`, [c.id, ids]);
      await evento(pool, req.conta.id, 'campanha_criada', `Meta ${ids.campanha_id}`);
      res.json({ campanha: n });
    } catch (e) {
      console.error('SaaS: falha ao subir campanha', c.id, e.message);
      const { rows: [n] } = await pool.query(`UPDATE saas_campanhas SET status='erro', erro=$2, ids=$3, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, e.message, e.criado || {}]);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ erro: e.message, campanha: n });
    }
  }));

  app.post('/api/saas/campanhas/:id/ativar', assinante, semSuporte, emDia, wrap(async (req, res) => {
    confirmar(req, 'Confirme a ativação: a campanha começa a gastar.');
    const c0 = await carregar(req);
    if (c0.status !== 'criada_pausada') throw erro('Só dá para ativar uma campanha criada e pausada.', 409);
    if (await ativacoesHoje(req.conta.id) >= ATIVACOES_DIA) throw erro(`Limite de ${ATIVACOES_DIA} ativações por dia atingido. Tente amanhã ou ative pelo Gerenciador de Anúncios.`, 429);
    const ctx = contextoMeta(req.cliente);
    const { rows: [c] } = await pool.query(`UPDATE saas_campanhas SET status='ativando', erro=NULL, ativada_em=now(), updated_at=now() WHERE id=$1 AND status='criada_pausada' RETURNING *`, [c0.id]);
    if (!c) throw erro('Esta campanha já está sendo ativada.', 409);
    try {
      const r = await meta.ativarEstrutura(ctx, c.ids.campanha_id);
      const { rows: [n] } = await pool.query(`UPDATE saas_campanhas SET status='ativada', ids=ids || $2::jsonb, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, { ativados: { conjuntos: r.conjuntos, anuncios: r.anuncios } }]);
      await evento(pool, req.conta.id, 'campanha_ativada', `Meta ${c.ids.campanha_id}`);
      res.json({ campanha: n });
    } catch (e) {
      console.error('SaaS: falha ao ativar campanha', c.id, e.message);
      const { rows: [n] } = await pool.query(`UPDATE saas_campanhas SET status='criada_pausada', erro=$2, ativada_em=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, `Falha ao ativar: ${e.message}. Confira o estado no Gerenciador de Anúncios.`]);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ erro: e.message, campanha: n });
    }
  }));

  // Pausar nunca é bloqueado pela assinatura: quem está inadimplente ainda pode parar de gastar
  app.post('/api/saas/campanhas/:id/pausar', assinante, wrap(async (req, res) => {
    const c0 = await carregar(req);
    if (c0.status !== 'ativada') throw erro('Só dá para pausar uma campanha ativada.', 409);
    await meta.pausar(contextoMeta(req.cliente), c0.ids.campanha_id);
    const { rows: [n] } = await pool.query(`UPDATE saas_campanhas SET status='criada_pausada', erro=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [c0.id]);
    await evento(pool, req.conta.id, 'campanha_pausada', `Meta ${c0.ids.campanha_id}`);
    res.json({ campanha: n });
  }));

  // ----- Leituras do Meta (sempre com as chaves do assinante) -----
  const leituraMeta = (fn) => [assinante, wrap(async (req, res) => res.json(await fn(contextoMeta(req.cliente), req)))];
  const q = (req) => String(req.query.q || '').trim().slice(0, 80);
  app.get('/api/saas/meta/desempenho', ...leituraMeta((ctx, req) => meta.desempenho(ctx, { nivel: req.query.nivel || 'campaign', periodo: req.query.periodo || 'last_7d' })));
  app.get('/api/saas/meta/campanhas', ...leituraMeta((ctx) => meta.listarCampanhas(ctx)));
  app.get('/api/saas/meta/publicos', ...leituraMeta((ctx) => meta.listarPublicos(ctx)));
  app.get('/api/saas/meta/interesses', ...leituraMeta((ctx, req) => { if (!q(req)) throw erro('Digite o interesse'); return meta.buscarInteresses(ctx, q(req)); }));
  app.get('/api/saas/meta/localizacoes', ...leituraMeta((ctx, req) => { if (!q(req)) throw erro('Digite a cidade ou o estado'); return meta.buscarLocal(ctx, q(req), String(req.query.pais || 'BR').toUpperCase().slice(0, 2)); }));

  // ----- Google Ads -----
  app.get('/api/saas/google/campanhas', assinante, wrap(async (req, res) => {
    res.json(await gads.listarCampanhas(contextoGoogle(req.cliente), String(req.query.periodo || 'LAST_7_DAYS')));
  }));

  app.post('/api/saas/google/campanhas', assinante, semSuporte, emDia, wrap(async (req, res) => {
    confirmar(req, 'Confirme a criação da campanha (ela nasce pausada).');
    if (await contarCampanhas(req.conta.id) >= MAX_CAMPANHAS) throw erro('Você chegou ao limite de campanhas guardadas. Exclua rascunhos antigos.');
    const ctx = contextoGoogle(req.cliente);
    const b = req.body?.spec || {};
    const lista = (v, n) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
    const spec = {
      nome: String(b.nome || '').trim().slice(0, 120), orcamento_diario_brl: Number(String(b.orcamento_diario_brl ?? '').replace(',', '.')),
      estrategia: b.estrategia, teto_cpc_brl: Number(String(b.teto_cpc_brl ?? '').replace(',', '.')) || undefined,
      titulos: lista(b.titulos, 15), descricoes: lista(b.descricoes, 4), url_final: String(b.url_final || '').trim().slice(0, 500),
      palavras_exatas: lista(b.palavras_exatas, 50), palavras_frase: lista(b.palavras_frase, 50),
    };
    try {
      const ids = await gads.criarPesquisa(ctx, spec);
      const { rows: [n] } = await pool.query(
        `INSERT INTO saas_campanhas (conta_id, cliente_id, plataforma, spec, status, ids, criada_em) VALUES ($1,$4,'google',$2,'criada_pausada',$3,now()) RETURNING *`, [req.conta.id, spec, ids, req.cliente.id]);
      await evento(pool, req.conta.id, 'campanha_criada', `Google ${ids.campanha_id}`);
      res.json({ campanha: n });
    } catch (e) {
      console.error('SaaS: falha ao criar campanha no Google', e.message);
      res.status(e.status && e.status < 500 ? e.status : 502).json({ erro: e.message, criado: e.criado || {} });
    }
  }));

  const atualizarGoogle = (contaId, gid, status) => pool.query(
    `UPDATE saas_campanhas SET status=$3, updated_at=now() WHERE conta_id=$1 AND plataforma='google' AND ids->>'campanha_id'=$2`, [contaId, String(gid), status]).catch(() => {});

  app.post('/api/saas/google/campanhas/:gid/status', assinante, wrap(async (req, res) => {
    const status = req.body?.status === 'ENABLED' ? 'ENABLED' : 'PAUSED';
    if (status === 'ENABLED') {
      if (req.suporte) return res.status(403).json({ erro: 'No modo suporte não dá para ativar campanhas: peça para o assinante.' });
      const s = situacao(req.conta); if (!s.ativa) return res.status(402).json({ erro: s.texto, codigo: s.codigo });
      confirmar(req, 'Confirme a ativação: a campanha começa a gastar.');
      if (await ativacoesHoje(req.conta.id) >= ATIVACOES_DIA) throw erro(`Limite de ${ATIVACOES_DIA} ativações por dia atingido. Tente amanhã.`, 429);
    }
    const r = await gads.mudarStatus(contextoGoogle(req.cliente), req.params.gid, status);
    await atualizarGoogle(req.conta.id, req.params.gid, status === 'ENABLED' ? 'ativada' : 'criada_pausada');
    await evento(pool, req.conta.id, status === 'ENABLED' ? 'campanha_ativada' : 'campanha_pausada', `Google ${req.params.gid}`);
    res.json(r);
  }));

  app.post('/api/saas/google/campanhas/:gid/orcamento', assinante, semSuporte, emDia, wrap(async (req, res) => {
    confirmar(req, 'Confirme a alteração do orçamento.');
    const r = await gads.ajustarOrcamento(contextoGoogle(req.cliente), req.params.gid, req.body?.valor);
    await evento(pool, req.conta.id, 'orcamento_google', `Google ${req.params.gid}: R$ ${r.de_brl} -> R$ ${r.para_brl}`);
    res.json(r);
  }));

  // ----- Assinatura e pagamento -----
  app.post('/api/saas/assinar', assinante, semSuporte, wrap(async (req, res) => {
    if (req.conta.status === 'bloqueada') throw erro('Conta bloqueada. Fale com o suporte.', 403);
    if (req.conta.status === 'ativa' && req.conta.stripe_subscription_id) throw erro('Você já tem uma assinatura ativa. Use "Gerenciar pagamento".');
    res.json({ url: await billing.criarCheckout({ conta: req.conta, email: req.user.email, base: base(req) }) });
  }));

  app.post('/api/saas/portal', assinante, semSuporte, wrap(async (req, res) => {
    res.json({ url: await billing.criarPortal({ conta: req.conta, base: base(req) }) });
  }));

  // ===== Administrador: gestão dos assinantes =====
  app.get('/api/saas/admin/assinantes', soAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT c.*, u.email, u.nome, u.ativo AS usuario_ativo, u.created_at AS usuario_criado,
         (SELECT count(*)::int FROM saas_clientes k WHERE k.conta_id=c.id) AS clientes,
         (SELECT count(*)::int FROM saas_campanhas x WHERE x.conta_id=c.id) AS campanhas,
         (SELECT count(*)::int FROM saas_campanhas x WHERE x.conta_id=c.id AND x.status='ativada') AS campanhas_ativas,
         (SELECT max(created_at) FROM saas_eventos e WHERE e.conta_id=c.id) AS ultima_atividade
       FROM saas_contas c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC`);
    const base0 = rows.map((r) => {
      const e = escopoDe(r); const tem = (k) => !!config.cfgProprio(k, e);
      return {
        id: r.id, email: r.email, nome: r.nome, empresa: r.empresa, status: r.status, situacao: situacao(r), cortesia: r.cortesia,
        plano: r.plano, bi: !!r.bi, clientes: r.clientes, clientes_max: PLANOS[r.plano]?.clientes ?? 1, trial_ate: r.trial_ate, periodo_fim: r.periodo_fim, tem_assinatura: !!r.stripe_subscription_id, campanhas: r.campanhas, campanhas_ativas: r.campanhas_ativas,
        ultima_atividade: r.ultima_atividade, criado_em: r.created_at,
        meta_ok: tem('META_ADS_TOKEN') && tem('META_AD_ACCOUNT_ID') && tem('META_PAGE_ID'),
        google_ok: tem('GOOGLE_ADS_DEVELOPER_TOKEN') && tem('GOOGLE_ADS_REFRESH_TOKEN') && tem('GOOGLE_ADS_CUSTOMER_ID'),
      };
    });
    res.json({ assinantes: base0, cobranca: billing.configurado(), preco: process.env.SAAS_PRECO_TEXTO || '' });
  }));

  app.put('/api/saas/admin/assinantes/:id', soAdmin, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query('SELECT * FROM saas_contas WHERE id=$1', [idDe(req)]);
    if (!c) throw erro('Assinante não encontrado', 404);
    const b = req.body || {};
    const sets = []; const vals = [c.id];
    const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', '$' + vals.length)); };
    if (typeof b.cortesia === 'boolean') add('cortesia=?', b.cortesia);
    if (b.plano !== undefined) { if (!Object.hasOwn(PLANOS, b.plano)) throw erro('Plano inválido'); add('plano=?', b.plano); }
    if (typeof b.bi === 'boolean') add('bi=?', b.bi);
    if (typeof b.bloqueada === 'boolean') {
      // desbloquear devolve a conta à situação que ela teria: assinando (ativa) ou em teste
      add('status=?', b.bloqueada ? 'bloqueada' : (c.stripe_subscription_id ? 'ativa' : 'trial'));
    }
    if (Number.isInteger(b.estender_dias) && b.estender_dias > 0 && b.estender_dias <= 365) {
      add(`trial_ate = GREATEST(COALESCE(trial_ate, now()), now()) + (? || ' days')::interval`, String(b.estender_dias));
    }
    if (!sets.length) throw erro('Nada para atualizar');
    const { rows: [n] } = await pool.query(`UPDATE saas_contas SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, vals);
    await evento(pool, c.id, 'admin', `${req.user.email}: ${JSON.stringify(b).slice(0, 200)}`);
    res.json({ ok: true, situacao: situacao(n) });
  }));

  // Modo suporte: entra na conta do assinante a partir da conta da administradora (fica registrado no histórico dele)
  app.post('/api/saas/admin/assinantes/:id/suporte', soAdmin, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query('SELECT c.*, u.email FROM saas_contas c JOIN users u ON u.id=c.user_id WHERE c.id=$1', [idDe(req)]);
    if (!c) throw erro('Assinante não encontrado', 404);
    suporte.iniciar(res, req.user, c.user_id);
    await evento(pool, c.id, 'suporte_iniciado', req.user.email);
    res.json({ ok: true, url: '/assinante', assinante: c.email });
  }));
  app.post('/api/saas/suporte/sair', soAdmin, wrap(async (req, res) => {
    suporte.encerrar(res);
    res.json({ ok: true });
  }));

  // Link para o assinante criar uma nova senha (não há envio de e-mail neste sistema)
  app.post('/api/saas/admin/assinantes/:id/link-senha', soAdmin, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query('SELECT user_id FROM saas_contas WHERE id=$1', [idDe(req)]);
    if (!c) throw erro('Assinante não encontrado', 404);
    res.json({ link: await gerarConvite(c.user_id, req) });
  }));

  app.delete('/api/saas/admin/assinantes/:id', soAdmin, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query('SELECT * FROM saas_contas WHERE id=$1', [idDe(req)]);
    if (!c) throw erro('Assinante não encontrado', 404);
    if (c.stripe_subscription_id && c.status === 'ativa' && !c.cortesia) throw erro('Este assinante tem assinatura paga ativa. Cancele no Stripe antes de excluir.');
    await excluirConta(pool, c);
    res.json({ ok: true });
  }));
}

// Apaga usuário, conta, campanhas e todas as chaves guardadas daquele escopo
async function excluirConta(pool, conta) {
  const escopos = [escopoDe(conta), ...(await pool.query('SELECT escopo FROM saas_clientes WHERE conta_id=$1', [conta.id])).rows.map((x) => x.escopo)];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM configuracoes WHERE client_id = ANY($1::int[])', [escopos]);
    await c.query('DELETE FROM conexoes WHERE client_id = ANY($1::int[])', [escopos]);
    await c.query('DELETE FROM users WHERE id=$1 AND papel=\'assinante\'', [conta.user_id]); // apaga a conta em cascata
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  await config.carregar(pool);
}

module.exports = { registrar, registrarPublico, situacao, escopoDe, escopoCliente, contextoMeta, contextoGoogle, ESCOPO_BASE, ESCOPO_CLIENTE_BASE, PLANOS };
