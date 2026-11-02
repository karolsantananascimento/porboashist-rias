// Janela de solicitações de cada projeto (tela interna + formulário público por link)
// e importação de pautas geradas fora do sistema (ex.: pelo Claude).

const crypto = require('crypto');
const { cifrar, decifrar } = require('./cofre');

const TIPOS = ['conteudo', 'arte', 'video', 'campanha', 'mensagem', 'outro'];
const TIPOS_ROTULO = { conteudo: 'Conteúdo', arte: 'Arte', video: 'Vídeo', campanha: 'Campanha de anúncios', mensagem: 'Mensagens', outro: 'Outro' };
const texto = (v, max = 4000) => String(v ?? '').slice(0, max).trim();
const dataOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Importação de pautas ----------
const TIPOS_TAREFA = ['post', 'story', 'blog', 'captacao', 'outro'];
const STATUS_TAREFA = ['pauta', 'conteudo', 'design', 'revisao', 'aprovacao', 'agendado', 'publicado'];
const placeholder = (t) => !t || /^(Stories do dia|Artigo de blog \(SEO\))/.test(t);

async function importarPautas(pool, body) {
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) throw Object.assign(new Error('Nenhuma pauta para importar (campo "itens" vazio)'), { status: 400 });
  if (itens.length > 200) throw Object.assign(new Error('Importe no máximo 200 pautas por vez'), { status: 400 });

  const { rows: projetos } = await pool.query('SELECT id, nome FROM projects');
  const { rows: clientes } = await pool.query('SELECT id, nome, project_id FROM clients');
  const projeto = body.project_id
    ? projetos.find((p) => p.id === Number(body.project_id))
    : body.projeto ? projetos.find((p) => semAcento(p.nome) === semAcento(body.projeto)) : null;
  if ((body.project_id || body.projeto) && !projeto) throw Object.assign(new Error(`Projeto não encontrado: ${body.projeto || body.project_id}`), { status: 400 });
  const doProjeto = (c) => !projeto || c.project_id === projeto.id;
  const achar = (ref) => {
    if (ref == null || ref === '') return null;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return clientes.find((c) => c.id === Number(ref) && doProjeto(c)) || null;
    return clientes.find((c) => semAcento(c.nome) === semAcento(ref) && doProjeto(c)) || null;
  };
  const padrao = achar(body.client_id ?? body.cliente);

  const r = { criadas: 0, preenchidas: 0, erros: [] };
  for (const [i, it] of itens.entries()) {
    const rot = `Item ${i + 1}${it.tema ? ` (${texto(it.tema, 40)})` : ''}`;
    const ref = it.client_id ?? it.cliente;
    const cl = ref != null && ref !== '' ? achar(ref) : padrao;
    if (!cl) { r.erros.push(`${rot}: cliente não encontrado${it.cliente ? ` (${it.cliente})` : ''}`); continue; }
    if (it.data && !dataOk(it.data)) { r.erros.push(`${rot}: data inválida (use AAAA-MM-DD)`); continue; }
    const tipo = TIPOS_TAREFA.includes(it.tipo) ? it.tipo : 'post';
    const legenda = texto(it.legenda, 6000) || null;
    const status = STATUS_TAREFA.includes(it.status) ? it.status : (legenda ? 'conteudo' : 'pauta');
    const campos = {
      formato: texto(it.formato, 40) || null, editorial: texto(it.editorial, 120) || null, tema: texto(it.tema, 300) || null,
      legenda, briefing: texto(it.briefing, 12000) || null, links: texto(it.links, 2000) || null,
      palavra_chave: texto(it.palavra_chave, 120) || null, responsavel: texto(it.responsavel, 80) || null,
      prioridade: ['baixa', 'normal', 'alta'].includes(it.prioridade) ? it.prioridade : 'normal',
      arte_url: /^https:\/\/\S+$/i.test(String(it.arte_url || '').trim()) ? String(it.arte_url).trim() : null,
    };
    // Ocupa a tarefa vazia do mesmo dia/tipo (estrutura criada em "Gerar mês"), senão cria uma nova
    let vazia = null;
    if (it.data) {
      const { rows } = await pool.query(
        `SELECT id, tema FROM tasks WHERE client_id=$1 AND data=$2 AND tipo=$3 AND legenda IS NULL AND briefing IS NULL ORDER BY id`, [cl.id, it.data, tipo]);
      vazia = rows.find((t) => placeholder(t.tema)) || null;
    }
    if (vazia) {
      await pool.query(
        `UPDATE tasks SET formato=COALESCE($1,formato), editorial=$2, tema=$3, legenda=$4, briefing=$5, links=$6, palavra_chave=$7,
           responsavel=$8, prioridade=$9, status=$10, arte_url=COALESCE($11,arte_url), updated_at=now() WHERE id=$12`,
        [campos.formato, campos.editorial, campos.tema, campos.legenda, campos.briefing, campos.links, campos.palavra_chave, campos.responsavel, campos.prioridade, status, campos.arte_url, vazia.id]);
      r.preenchidas++;
    } else {
      await pool.query(
        `INSERT INTO tasks (client_id, tipo, formato, data, editorial, tema, legenda, briefing, links, palavra_chave, responsavel, prioridade, status, arte_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [cl.id, tipo, campos.formato, it.data || null, campos.editorial, campos.tema, campos.legenda, campos.briefing, campos.links,
          campos.palavra_chave, campos.responsavel, campos.prioridade, status, campos.arte_url]);
      r.criadas++;
    }
  }
  return r;
}

// ---------- Pauta a partir da demanda (IA quando disponível; senão regra simples) ----------
async function montarPauta(pool, { tipo, texto: demanda, cliente }) {
  const primeira = demanda.split(/\n|(?<=[.!?])\s/)[0].replace(/\s+/g, ' ').trim();
  const base = {
    tema: texto(primeira, 120),
    tipo: tipo === 'conteudo' ? (/blog|artigo/i.test(demanda) ? 'blog' : /stor(y|ies)/i.test(demanda) ? 'story' : 'post') : tipo,
    formato: tipo === 'trafego' ? 'campanha' : tipo === 'criacao' ? (/v[ií]deo|reels/i.test(demanda) ? 'vídeo' : 'arte') : null,
    editorial: { conteudo: 'Demanda · Conteúdo', criacao: 'Demanda · Criação', trafego: 'Demanda · Tráfego' }[tipo],
    briefing: `DEMANDA ORIGINAL\n${demanda}`,
    ia: false,
  };
  const { cfg } = require('./config');
  if (!cfg('ANTHROPIC_API_KEY')) return base;
  try {
    const { chamarTexto, blocoContexto } = require('./projetos');
    const ctx = await blocoContexto(pool, cliente.project_id, cliente.id);
    const out = await chamarTexto({
      system: `Você organiza demandas de uma agência em pautas de trabalho. Escreva em português do Brasil. Nunca invente fatos, preços, datas ou promessas: o que faltar vai em "briefing" como [CONFIRMAR: ...]. Responda APENAS um objeto JSON com as chaves: "tema" (curto e específico, até 90 caracteres), "tipo" (${tipo === 'conteudo' ? 'post, story ou blog' : tipo}), "formato" (${tipo === 'conteudo' ? 'estático, carrossel, reels, story ou artigo' : tipo === 'criacao' ? 'arte estática, carrossel, vídeo, capa ou outro' : 'campanha'}), "editorial" (pilar ou objetivo, até 60 caracteres) e "briefing" (instruções claras para quem vai executar: objetivo, público, mensagem, o que entregar, pendências a confirmar).`,
      user: `${ctx}\n\nTIPO DA DEMANDA: ${tipo}\nDEMANDA:\n${demanda}`,
      maxTokens: 1200, timeoutMs: 45000,
    });
    const i = out.indexOf('{'); const j = out.lastIndexOf('}');
    const o = JSON.parse(out.slice(i, j + 1));
    if (!o.tema || !o.briefing) return base;
    const tiposOk = tipo === 'conteudo' ? ['post', 'story', 'blog'] : [tipo];
    return {
      tema: texto(o.tema, 160), tipo: tiposOk.includes(o.tipo) ? o.tipo : base.tipo, formato: texto(o.formato, 40) || base.formato,
      editorial: texto(o.editorial, 120) || base.editorial,
      briefing: `${texto(o.briefing, 6000)}\n\n— Demanda original —\n${demanda}`, ia: true,
    };
  } catch (e) {
    console.warn('Pauta sem IA (usando texto da demanda):', e.message);
    return base;
  }
}

// ---------- Rotas ----------
function registrar(app, { pool, wrap, soAdmin }) {
  // Lista e métricas por projeto
  app.get('/api/solicitacoes', wrap(async (req, res) => {
    const w = []; const v = [];
    if (req.query.project_id) { v.push(req.query.project_id); w.push(`project_id=$${v.length}`); }
    if (req.query.status) { v.push(req.query.status); w.push(`status=$${v.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM solicitacoes ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
       ORDER BY (status IN ('concluida','cancelada')), (prioridade='alta') DESC, prazo NULLS LAST, created_at DESC LIMIT 300`, v);
    res.json(rows);
  }));

  app.post('/api/solicitacoes', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.project_id) return res.status(400).json({ erro: 'Escolha o projeto' });
    if (!texto(b.titulo)) return res.status(400).json({ erro: 'Dê um título para a solicitação' });
    const { rows: [s] } = await pool.query(
      `INSERT INTO solicitacoes (project_id, client_id, titulo, tipo, descricao, solicitante, contato, prazo, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.project_id, b.client_id || null, texto(b.titulo, 200), TIPOS.includes(b.tipo) ? b.tipo : 'outro', texto(b.descricao) || null,
        texto(b.solicitante, 120) || req.user.nome || req.user.email, texto(b.contato, 160) || null,
        dataOk(b.prazo) ? b.prazo : null, ['baixa', 'normal', 'alta'].includes(b.prioridade) ? b.prioridade : 'normal']);
    res.json(s);
  }));

  app.put('/api/solicitacoes/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: [a] } = await pool.query('SELECT * FROM solicitacoes WHERE id=$1', [req.params.id]);
    if (!a) return res.status(404).json({ erro: 'Solicitação não encontrada' });
    const n = { ...a, ...b };
    const { rows: [s] } = await pool.query(
      `UPDATE solicitacoes SET titulo=$1, tipo=$2, descricao=$3, solicitante=$4, contato=$5, prazo=$6, prioridade=$7, status=$8, client_id=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [texto(n.titulo, 200) || a.titulo, TIPOS.includes(n.tipo) ? n.tipo : a.tipo, texto(n.descricao) || null, texto(n.solicitante, 120) || null,
        texto(n.contato, 160) || null, dataOk(n.prazo) ? n.prazo : null, ['baixa', 'normal', 'alta'].includes(n.prioridade) ? n.prioridade : a.prioridade,
        ['nova', 'andamento', 'concluida', 'cancelada'].includes(n.status) ? n.status : a.status, n.client_id || null, a.id]);
    res.json(s);
  }));

  app.delete('/api/solicitacoes/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM solicitacoes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  // Caixa de demandas da tela inicial: registra a solicitação e já cria a pauta na área do cliente
  app.post('/api/demandas', wrap(async (req, res) => {
    const b = req.body || {};
    const tipo = ['conteudo', 'criacao', 'trafego'].includes(b.tipo) ? b.tipo : null;
    const demanda = texto(b.texto, 4000);
    if (!tipo) return res.status(400).json({ erro: 'Escolha o tipo da demanda' });
    if (!demanda) return res.status(400).json({ erro: 'Escreva a demanda' });
    const { rows: [cl] } = await pool.query(
      `SELECT c.id, c.nome, c.project_id, p.nome AS projeto, p.tipo AS projeto_tipo FROM clients c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=$1`, [b.client_id]);
    if (!cl) return res.status(400).json({ erro: 'Escolha o cliente' });
    if (cl.projeto_tipo === 'empregos') return res.status(400).json({ erro: 'O projeto Empregos não recebe demandas por aqui' });
    const prazo = dataOk(b.prazo) ? b.prazo : null;

    const pauta = await montarPauta(pool, { tipo, texto: demanda, cliente: cl });
    const responsavel = { conteudo: 'Hugo', trafego: 'Camila', criacao: /v[ií]deo|reels|edi[cç][aã]o|corte/i.test(demanda + ' ' + (pauta.formato || '')) ? 'Davi' : 'Luiz' }[tipo];
    const { rows: [t] } = await pool.query(
      `INSERT INTO tasks (client_id, tipo, formato, data, editorial, tema, briefing, status, responsavel, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pauta',$8,$9) RETURNING *`,
      [cl.id, pauta.tipo, pauta.formato || null, prazo, pauta.editorial || null, pauta.tema, pauta.briefing, responsavel,
        /urgente|hoje|amanh[ãa]|prioridade/i.test(demanda) ? 'alta' : 'normal']);
    const tipoSol = tipo === 'conteudo' ? 'conteudo' : tipo === 'trafego' ? 'campanha' : (responsavel === 'Davi' ? 'video' : 'arte');
    let sol;
    if (b.solicitacao_id) {
      // Solicitação que já existia (formulário, registro manual): passa a andamento e fica ligada à pauta
      ({ rows: [sol] } = await pool.query(
        `UPDATE solicitacoes SET status='andamento', task_id=$1, client_id=$2, updated_at=now() WHERE id=$3 RETURNING *`, [t.id, cl.id, b.solicitacao_id]));
    }
    if (!sol) {
      ({ rows: [sol] } = await pool.query(
        `INSERT INTO solicitacoes (project_id, client_id, titulo, tipo, descricao, solicitante, prazo, origem, status, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'caixa','andamento',$8) RETURNING *`,
        [cl.project_id, cl.id, texto(pauta.tema, 200), tipoSol, demanda, req.user.nome || req.user.email, prazo, t.id]));
    }
    // O time começa a trabalhar sozinho; o resultado cai na fila de aprovação
    let executando = false;
    const { cfg } = require('./config');
    if (b.executar !== false && cfg('ANTHROPIC_API_KEY')) {
      await pool.query(`UPDATE tasks SET esteira='executando', esteira_msg='Time começando…', esteira_em=now() WHERE id=$1`, [t.id]);
      require('./esteira').executar(pool, t.id, { usuario: req.user.email });
      executando = true;
    }
    res.json({ tarefa: { ...t, esteira: executando ? 'executando' : null }, solicitacao: sol, projeto: { id: cl.project_id, nome: cl.projeto }, cliente: { id: cl.id, nome: cl.nome }, ia: pauta.ia, executando });
  }));

  // Link do formulário público do projeto
  app.post('/api/projects/:id/link-solicitacao', wrap(async (req, res) => {
    const { rows: [p] } = await pool.query('SELECT id, token_solicitacao FROM projects WHERE id=$1', [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Projeto não encontrado' });
    let token = p.token_solicitacao;
    if (!token || req.body.regenerar) {
      token = crypto.randomBytes(18).toString('base64url');
      await pool.query('UPDATE projects SET token_solicitacao=$1 WHERE id=$2', [token, p.id]);
    }
    res.json({ link: `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/solicitar/${token}` });
  }));

  // Importação de pautas pela tela (sessão) ...
  app.post('/api/importar/pautas', wrap(async (req, res) => res.json(await importarPautas(pool, req.body || {}))));

  // ... e por token (automação externa), com um token gerado por administrador
  app.get('/api/importar/token', soAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT updated_at FROM configuracoes WHERE chave='IMPORT_TOKEN_HASH'`);
    res.json({ existe: !!rows.length, gerado_em: rows[0]?.updated_at || null });
  }));
  app.post('/api/importar/token', soAdmin, wrap(async (req, res) => {
    const token = 'mmb_' + crypto.randomBytes(24).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO configuracoes (chave, valor_enc, updated_at) VALUES ('IMPORT_TOKEN_HASH',$1,now())
       ON CONFLICT (chave) DO UPDATE SET valor_enc=EXCLUDED.valor_enc, updated_at=now()`, [cifrar(hash)]);
    res.json({ token });
  }));
}

// Rotas públicas (fora de /api): formulário de solicitação e importação por token
function registrarPublico(app, { pool, wrap }) {
  const express = require('express');
  app.use('/solicitar', express.urlencoded({ extended: false, limit: '60kb' }));

  app.post('/importar/pautas', wrap(async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { rows: [r] } = await pool.query(`SELECT valor_enc FROM configuracoes WHERE chave='IMPORT_TOKEN_HASH'`);
    let ok = false;
    if (r && token) {
      try {
        const esperado = decifrar(r.valor_enc);
        const calc = crypto.createHash('sha256').update(token).digest('hex');
        ok = esperado.length === calc.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(calc));
      } catch { ok = false; }
    }
    if (!ok) return res.status(401).json({ erro: 'Token inválido' });
    res.json(await importarPautas(pool, req.body || {}));
  }));

  const tentativas = new Map();
  const limite = (ip) => {
    const agora = Date.now();
    const l = (tentativas.get(ip) || []).filter((t) => agora - t < 3600 * 1000);
    if (l.length >= 6) { tentativas.set(ip, l); return false; }
    l.push(agora); tentativas.set(ip, l); return true;
  };

  const pagina = (titulo, corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(titulo)}</title>
<style>body{margin:0;background:#f7f3ee;color:#2a2420;font:15px/1.5 system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:28px 18px}
h1{font-size:22px;margin:0 0 4px}p{color:#6b6058}label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:#6b6058;margin:14px 0 4px}
input,select,textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #e6ddd2;border-radius:8px;font:inherit;background:#fff}
button{margin-top:18px;background:#b3202a;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer}
.ok{background:#e1efe6;padding:14px;border-radius:8px}.err{background:#f7e0dd;padding:12px;border-radius:8px}.hp{position:absolute;left:-9999px}</style></head><body><main>${corpo}</main></body></html>`;

  const formulario = (p, erro = '', v = {}) => pagina(`Solicitações · ${p.nome}`, `
    <h1>Solicitar algo para ${esc(p.nome)}</h1><p>Descreva o que você precisa. A equipe recebe na hora.</p>
    ${erro ? `<div class="err">${esc(erro)}</div>` : ''}
    <form method="post"><div class="hp"><label>Não preencha<input name="site" tabindex="-1" autocomplete="off"></label></div>
      <label>Seu nome</label><input name="nome" required maxlength="120" value="${esc(v.nome)}">
      <label>E-mail ou WhatsApp</label><input name="contato" required maxlength="160" value="${esc(v.contato)}">
      <label>O que você precisa?</label><select name="tipo">${TIPOS.map((t) => `<option value="${t}" ${v.tipo === t ? 'selected' : ''}>${TIPOS_ROTULO[t]}</option>`).join('')}</select>
      <label>Título</label><input name="titulo" required maxlength="200" value="${esc(v.titulo)}">
      <label>Detalhes</label><textarea name="descricao" rows="6" maxlength="4000">${esc(v.descricao)}</textarea>
      <label>Prazo desejado (opcional)</label><input type="date" name="prazo" value="${esc(v.prazo)}">
      <button type="submit">Enviar solicitação</button></form>`);

  const projetoDoToken = async (token) => {
    if (!/^[\w-]{20,40}$/.test(token)) return null;
    const { rows: [p] } = await pool.query('SELECT id, nome FROM projects WHERE token_solicitacao=$1', [token]);
    return p || null;
  };

  app.get('/solicitar/:token', wrap(async (req, res) => {
    const p = await projetoDoToken(req.params.token);
    if (!p) return res.status(404).send(pagina('Link inválido', '<h1>Link inválido</h1><p>Peça um novo link à equipe.</p>'));
    res.send(formulario(p));
  }));

  app.post('/solicitar/:token', wrap(async (req, res) => {
    const p = await projetoDoToken(req.params.token);
    if (!p) return res.status(404).send(pagina('Link inválido', '<h1>Link inválido</h1><p>Peça um novo link à equipe.</p>'));
    const b = req.body || {};
    if (b.site) return res.send(pagina('Enviado', '<div class="ok"><b>Solicitação enviada.</b></div>')); // robô: finge sucesso
    if (!limite(req.ip)) return res.status(429).send(formulario(p, 'Muitas solicitações em pouco tempo. Tente mais tarde.', b));
    if (!texto(b.nome) || !texto(b.contato) || !texto(b.titulo)) return res.status(400).send(formulario(p, 'Preencha nome, contato e título.', b));
    await pool.query(
      `INSERT INTO solicitacoes (project_id, titulo, tipo, descricao, solicitante, contato, prazo, origem) VALUES ($1,$2,$3,$4,$5,$6,$7,'formulario')`,
      [p.id, texto(b.titulo, 200), TIPOS.includes(b.tipo) ? b.tipo : 'outro', texto(b.descricao) || null, texto(b.nome, 120), texto(b.contato, 160), dataOk(b.prazo) ? b.prazo : null]);
    res.send(pagina('Enviado', `<h1>Recebemos sua solicitação</h1><div class="ok">A equipe de ${esc(p.nome)} vai entrar em contato pelo contato informado.</div>`));
  }));
}

module.exports = { registrar, registrarPublico, importarPautas, montarPauta };
