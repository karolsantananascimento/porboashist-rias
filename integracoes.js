// Conexão de cada cliente com Facebook, Instagram (login da Meta) e LinkedIn, e publicação com confirmação.
// Os tokens ficam criptografados no banco (ACESSOS_KEY). Cada cliente tem as suas contas e, se quiser, as suas chaves de app.
// Nada é publicado sem o clique de uma pessoa na tela de publicação.

const crypto = require('crypto');
const { cifrar, decifrar } = require('./cofre');
const { cfg, listar, definir, remover } = require('./config');

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_ESCOPOS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_messaging',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_messages'];
const LINKEDIN_ESCOPOS = ['openid', 'profile', 'w_member_social'];
// Google: ler fotos e vídeos do Drive e criar os documentos de pauta (drive.file só enxerga o que o sistema cria)
const GOOGLE_ESCOPOS = ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const GOOGLE_AUTH = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

const base = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

async function lerConexao(pool, provedor, clienteId) {
  const { rows: [r] } = await pool.query('SELECT * FROM conexoes WHERE provedor=$1 AND client_id=$2', [provedor, clienteId || 0]);
  if (!r) return null;
  try { return { ...JSON.parse(decifrar(r.dados_enc)), conectado_em: r.updated_at }; } catch { return null; }
}

async function salvarConexao(pool, provedor, clienteId, dados) {
  await pool.query(
    `INSERT INTO conexoes (provedor, client_id, dados_enc, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (provedor, client_id) DO UPDATE SET dados_enc=EXCLUDED.dados_enc, updated_at=now()`,
    [provedor, clienteId || 0, cifrar(JSON.stringify(dados))]);
}

// Token de verificação do webhook de um escopo (cliente ou padrão)
const verifyToken = (clienteId = 0) => cfg('META_VERIFY_TOKEN', clienteId) ||
  (cfg('META_APP_SECRET', clienteId) ? crypto.createHash('sha256').update('verify:' + cfg('META_APP_SECRET', clienteId)).digest('hex').slice(0, 24) : null);

async function jsonDe(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const msg = d.error?.message || d.message || d.error_description || `HTTP ${r.status}`;
    const e = new Error(msg); e.status = 502; throw e;
  }
  return d;
}

// Token da página do cliente, usado para responder mensagens (a variável antiga só vale como padrão)
async function tokenDaPagina(pool, clienteId) {
  const c = await lerConexao(pool, 'meta', clienteId);
  const pg = c && c.paginas && c.paginas.find((p) => p.id === c.pagina_id);
  return (pg && pg.token) || process.env.META_PAGE_TOKEN || null;
}

function registrar(app, { pool, wrap, soAdmin }) {
  const ASSINAR = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const assinarState = (s) => crypto.createHmac('sha256', ASSINAR).update(s).digest('hex').slice(0, 32);
  const novoState = (userId, clienteId) => { const s = `${userId}.${clienteId}.${crypto.randomBytes(12).toString('hex')}`; return `${s}.${assinarState(s)}`; };
  const lerState = (state, userId) => {
    const [u, cid, n, sig] = String(state || '').split('.');
    if (u !== String(userId) || !cid || !n || !sig || assinarState(`${u}.${cid}.${n}`) !== sig) return null;
    return Number(cid);
  };
  const clienteDe = async (id) => {
    const { rows: [c] } = await pool.query('SELECT id, nome, project_id FROM clients WHERE id=$1', [id]);
    return c || null;
  };
  const voltar = async (res, msg, ok, clienteId) => {
    const c = clienteId ? await clienteDe(clienteId) : null;
    res.redirect(`/?integracao=${ok ? 'ok' : 'erro'}&msg=${encodeURIComponent(msg)}${c ? `&client_id=${c.id}&project_id=${c.project_id || ''}` : ''}`);
  };

  // ----- Meta (Facebook + Instagram) -----
  app.get('/oauth/meta/iniciar', wrap(async (req, res) => {
    const cid = Number(req.query.client_id);
    const cl = cid ? await clienteDe(cid) : null;
    if (!cl) return voltar(res, 'Escolha o cliente antes de conectar.', false);
    if (req.user.papel !== 'admin') return voltar(res, 'Só administradores conectam contas.', false, cid);
    if (!cfg('META_APP_ID', cid) || !cfg('META_APP_SECRET', cid)) return voltar(res, 'Falta o app da Meta: cole o ID e a chave secreta (do cliente ou as padrão).', false, cid);
    const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    u.search = new URLSearchParams({
      client_id: cfg('META_APP_ID', cid), redirect_uri: `${base(req)}/oauth/meta/retorno`,
      state: novoState(req.user.id, cid), scope: META_ESCOPOS.join(','), response_type: 'code',
    });
    res.redirect(u.toString());
  }));

  app.get('/oauth/meta/retorno', wrap(async (req, res) => {
    const cid = lerState(req.query.state, req.user.id);
    if (req.query.error) return voltar(res, 'A Meta cancelou a conexão: ' + (req.query.error_description || req.query.error), false, cid);
    if (!cid || req.user.papel !== 'admin') return voltar(res, 'Conexão inválida. Tente de novo.', false, cid);
    try {
      const appId = cfg('META_APP_ID', cid); const segredo = cfg('META_APP_SECRET', cid);
      const curto = await jsonDe(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        client_id: appId, client_secret: segredo, redirect_uri: `${base(req)}/oauth/meta/retorno`, code: String(req.query.code) }));
      const longo = await jsonDe(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: segredo, fb_exchange_token: curto.access_token }));
      const eu = await jsonDe(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(longo.access_token)}`);
      const contas = await jsonDe(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(longo.access_token)}`);
      const paginas = (contas.data || []).map((p) => ({
        id: p.id, nome: p.name, token: p.access_token,
        ig_id: p.instagram_business_account?.id || null, ig_usuario: p.instagram_business_account?.username || null,
      }));
      if (!paginas.length) return voltar(res, 'Conectou, mas nenhuma página do Facebook foi liberada. Refaça e marque a página.', false, cid);
      await salvarConexao(pool, 'meta', cid, { usuario: eu.name, paginas, pagina_id: paginas[0].id });
      // Mensagens dessas páginas passam a cair neste cliente
      await pool.query('DELETE FROM meta_paginas WHERE client_id=$1', [cid]);
      for (const p of paginas) {
        for (const id of [p.id, p.ig_id].filter(Boolean)) {
          await pool.query('INSERT INTO meta_paginas (page_id, client_id) VALUES ($1,$2) ON CONFLICT (page_id) DO UPDATE SET client_id=EXCLUDED.client_id', [String(id), cid]);
        }
        await fetch(`${GRAPH}/${p.id}/subscribed_apps?subscribed_fields=messages`, {
          method: 'POST', headers: { authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
      }
      voltar(res, `Facebook conectado: ${paginas.map((p) => p.nome).join(', ')}`, true, cid);
    } catch (e) { console.error('Erro OAuth Meta', e.message); voltar(res, 'Não consegui concluir a conexão com a Meta: ' + e.message, false, cid); }
  }));

  // ----- LinkedIn -----
  app.get('/oauth/linkedin/iniciar', wrap(async (req, res) => {
    const cid = Number(req.query.client_id);
    const cl = cid ? await clienteDe(cid) : null;
    if (!cl) return voltar(res, 'Escolha o cliente antes de conectar.', false);
    if (req.user.papel !== 'admin') return voltar(res, 'Só administradores conectam contas.', false, cid);
    if (!cfg('LINKEDIN_CLIENT_ID', cid) || !cfg('LINKEDIN_CLIENT_SECRET', cid)) return voltar(res, 'Falta o app do LinkedIn: cole o Client ID e o Secret (do cliente ou os padrão).', false, cid);
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.search = new URLSearchParams({
      response_type: 'code', client_id: cfg('LINKEDIN_CLIENT_ID', cid), redirect_uri: `${base(req)}/oauth/linkedin/retorno`,
      state: novoState(req.user.id, cid), scope: LINKEDIN_ESCOPOS.join(' '),
    });
    res.redirect(u.toString());
  }));

  app.get('/oauth/linkedin/retorno', wrap(async (req, res) => {
    const cid = lerState(req.query.state, req.user.id);
    if (req.query.error) return voltar(res, 'O LinkedIn cancelou a conexão: ' + (req.query.error_description || req.query.error), false, cid);
    if (!cid || req.user.papel !== 'admin') return voltar(res, 'Conexão inválida. Tente de novo.', false, cid);
    try {
      const t = await jsonDe('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code),
          redirect_uri: `${base(req)}/oauth/linkedin/retorno`, client_id: cfg('LINKEDIN_CLIENT_ID', cid),
          client_secret: cfg('LINKEDIN_CLIENT_SECRET', cid) }) });
      const eu = await jsonDe('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
      await salvarConexao(pool, 'linkedin', cid, {
        token: t.access_token, expira_em: Date.now() + (t.expires_in || 5184000) * 1000,
        autor: `urn:li:person:${eu.sub}`, nome: eu.name || [eu.given_name, eu.family_name].filter(Boolean).join(' '),
      });
      voltar(res, `LinkedIn conectado: ${eu.name || 'conta'}`, true, cid);
    } catch (e) { console.error('Erro OAuth LinkedIn', e.message); voltar(res, 'Não consegui concluir a conexão com o LinkedIn: ' + e.message, false, cid); }
  }));

  // ----- Google (Drive e Docs) -----
  app.get('/oauth/google/iniciar', wrap(async (req, res) => {
    const cid = Number(req.query.client_id);
    const cl = cid ? await clienteDe(cid) : null;
    if (!cl) return voltar(res, 'Escolha o cliente antes de conectar.', false);
    if (req.user.papel !== 'admin') return voltar(res, 'Só administradores conectam contas.', false, cid);
    if (!cfg('GOOGLE_CLIENT_ID', cid) || !cfg('GOOGLE_CLIENT_SECRET', cid)) return voltar(res, 'Falta o cliente OAuth do Google: cole o ID e a chave secreta (do cliente ou as padrão).', false, cid);
    const u = new URL(GOOGLE_AUTH);
    u.search = new URLSearchParams({
      client_id: cfg('GOOGLE_CLIENT_ID', cid), redirect_uri: `${base(req)}/oauth/google/retorno`, response_type: 'code',
      scope: GOOGLE_ESCOPOS.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: novoState(req.user.id, cid),
    });
    res.redirect(u.toString());
  }));

  app.get('/oauth/google/retorno', wrap(async (req, res) => {
    const cid = lerState(req.query.state, req.user.id);
    if (req.query.error) return voltar(res, 'O Google cancelou a conexão: ' + req.query.error, false, cid);
    if (!cid || req.user.papel !== 'admin') return voltar(res, 'Conexão inválida. Tente de novo.', false, cid);
    try {
      const t = await jsonDe(GOOGLE_TOKEN, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: `${base(req)}/oauth/google/retorno`,
          client_id: cfg('GOOGLE_CLIENT_ID', cid), client_secret: cfg('GOOGLE_CLIENT_SECRET', cid) }) });
      if (!t.refresh_token) return voltar(res, 'O Google não devolveu a permissão permanente. Remova o acesso do app na sua conta Google e conecte de novo.', false, cid);
      if (!String(t.scope || '').includes('drive.readonly')) return voltar(res, 'Faltou liberar a leitura do Drive. Conecte de novo e marque todas as permissões.', false, cid);
      let email = null;
      try { const eu = await jsonDe('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } }); email = eu.email || null; } catch { /* e-mail é só informativo */ }
      await salvarConexao(pool, 'google', cid, { token: t.access_token, refresh_token: t.refresh_token, expira_em: Date.now() + (t.expires_in || 3600) * 1000, email });
      voltar(res, `Google conectado${email ? ': ' + email : ''}`, true, cid);
    } catch (e) { console.error('Erro OAuth Google', e.message); voltar(res, 'Não consegui concluir a conexão com o Google: ' + e.message, false, cid); }
  }));

  // ----- Chaves das APIs: padrão do sistema (client_id ausente) ou do cliente -----
  const escopo = (req) => Number(req.query.client_id || req.body?.client_id || 0) || 0;
  app.get('/api/configuracoes', soAdmin, (req, res) => res.json(listar(escopo(req))));
  app.put('/api/configuracoes/:chave', soAdmin, wrap(async (req, res) => {
    try { await definir(pool, req.params.chave, req.body.valor, escopo(req)); }
    catch (e) { if (/Cofre/.test(e.message)) e.message = 'O cofre não está configurado: defina ACESSOS_KEY no Render.'; throw e; }
    res.json(listar(escopo(req)));
  }));
  app.delete('/api/configuracoes/:chave', soAdmin, wrap(async (req, res) => {
    await remover(pool, req.params.chave, escopo(req));
    res.json(listar(escopo(req)));
  }));

  // ----- Status das conexões de um cliente -----
  app.get('/api/conexoes', wrap(async (req, res) => {
    const cid = Number(req.query.client_id) || 0;
    if (!cid) return res.status(400).json({ erro: 'Escolha o cliente' });
    const [meta, li, go] = await Promise.all([lerConexao(pool, 'meta', cid), lerConexao(pool, 'linkedin', cid), lerConexao(pool, 'google', cid)]);
    const pg = meta && meta.paginas.find((p) => p.id === meta.pagina_id);
    const admin = req.user.papel === 'admin';
    res.json({
      meta: {
        app_configurado: !!(cfg('META_APP_ID', cid) && cfg('META_APP_SECRET', cid)),
        conectado: !!meta, usuario: meta?.usuario || null, pagina_id: meta?.pagina_id || null,
        paginas: (meta?.paginas || []).map((p) => ({ id: p.id, nome: p.nome, ig_usuario: p.ig_usuario })),
        facebook: pg ? pg.nome : null, instagram: pg?.ig_usuario || null,
        webhook: `${base(req)}/webhook/meta`, verify_token: admin ? verifyToken(cid) : null,
        redirect: `${base(req)}/oauth/meta/retorno`,
      },
      google: {
        app_configurado: !!(cfg('GOOGLE_CLIENT_ID', cid) && cfg('GOOGLE_CLIENT_SECRET', cid)),
        conectado: !!go, email: go?.email || null, redirect: `${base(req)}/oauth/google/retorno`,
      },
      linkedin: {
        app_configurado: !!(cfg('LINKEDIN_CLIENT_ID', cid) && cfg('LINKEDIN_CLIENT_SECRET', cid)),
        conectado: !!li, nome: li?.nome || null, expira_em: li?.expira_em || null,
        expirado: !!(li && li.expira_em < Date.now()), redirect: `${base(req)}/oauth/linkedin/retorno`,
      },
    });
  }));

  app.put('/api/conexoes/meta/pagina', soAdmin, wrap(async (req, res) => {
    const cid = Number(req.body.client_id) || 0;
    const c = await lerConexao(pool, 'meta', cid);
    if (!c) return res.status(404).json({ erro: 'Facebook não está conectado para este cliente' });
    if (!c.paginas.some((p) => p.id === req.body.pagina_id)) return res.status(400).json({ erro: 'Página inválida' });
    delete c.conectado_em;
    await salvarConexao(pool, 'meta', cid, { ...c, pagina_id: req.body.pagina_id });
    res.json({ ok: true });
  }));

  app.delete('/api/conexoes/:provedor', soAdmin, wrap(async (req, res) => {
    if (!['meta', 'linkedin', 'google'].includes(req.params.provedor)) return res.status(400).json({ erro: 'Provedor inválido' });
    const cid = Number(req.query.client_id) || 0;
    await pool.query('DELETE FROM conexoes WHERE provedor=$1 AND client_id=$2', [req.params.provedor, cid]);
    if (req.params.provedor === 'meta') await pool.query('DELETE FROM meta_paginas WHERE client_id=$1', [cid]);
    res.json({ ok: true });
  }));

  // ----- Publicação -----
  async function publicarFacebook(c, texto, imagem) {
    const pg = c.paginas.find((p) => p.id === c.pagina_id);
    const corpo = imagem ? { url: imagem, caption: texto } : { message: texto };
    const d = await jsonDe(`${GRAPH}/${pg.id}/${imagem ? 'photos' : 'feed'}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pg.token}` }, body: JSON.stringify(corpo) });
    return d.post_id || d.id;
  }

  async function publicarInstagram(c, texto, imagem) {
    const pg = c.paginas.find((p) => p.id === c.pagina_id);
    if (!pg.ig_id) throw new Error('A página conectada não tem uma conta profissional do Instagram vinculada');
    if (!imagem) throw new Error('O Instagram exige uma imagem (link público https://)');
    const h = { 'content-type': 'application/json', authorization: `Bearer ${pg.token}` };
    const cont = await jsonDe(`${GRAPH}/${pg.ig_id}/media`, { method: 'POST', headers: h, body: JSON.stringify({ image_url: imagem, caption: texto }) });
    for (let i = 0; i < 6; i++) { // espera o Instagram processar a imagem
      const st = await jsonDe(`${GRAPH}/${cont.id}?fields=status_code`, { headers: h });
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('O Instagram recusou a imagem (formato ou proporção)');
      await new Promise((r) => setTimeout(r, 2000));
    }
    const pub = await jsonDe(`${GRAPH}/${pg.ig_id}/media_publish`, { method: 'POST', headers: h, body: JSON.stringify({ creation_id: cont.id }) });
    return pub.id;
  }

  async function publicarLinkedin(c, texto) {
    if (c.expira_em < Date.now()) throw new Error('A conexão com o LinkedIn expirou. Conecte de novo em Acessos e APIs.');
    const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}`, 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({
        author: c.autor, lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: texto }, shareMediaCategory: 'NONE' } },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || `LinkedIn recusou (HTTP ${r.status})`);
    return r.headers.get('x-restli-id') || d.id;
  }

  // Publica nas redes escolhidas (usado pelo botão "Publicar agora" e pelo agendador). Registra cada tentativa.
  async function publicarCore(cid, alvos, texto, imagem, userId) {
    const meta = await lerConexao(pool, 'meta', cid);
    const li = await lerConexao(pool, 'linkedin', cid);
    const resultados = [];
    for (const plat of alvos) {
      let status = 'publicado', externo = null, erro = null;
      try {
        if (plat === 'linkedin') { if (!li) throw new Error('LinkedIn não está conectado para este cliente'); externo = await publicarLinkedin(li, texto); }
        else {
          if (!meta) throw new Error('Facebook/Instagram não está conectado para este cliente');
          externo = plat === 'facebook' ? await publicarFacebook(meta, texto, imagem) : await publicarInstagram(meta, texto, imagem);
        }
      } catch (e) { status = 'erro'; erro = e.message; console.error(`Erro ao publicar em ${plat}:`, e.message); }
      await pool.query(
        `INSERT INTO publicacoes (plataforma, texto, imagem_url, externo_id, status, erro, usuario_id, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [plat, texto, imagem || null, externo ? String(externo) : null, status, erro, userId || null, cid]);
      resultados.push({ plataforma: plat, status, erro });
    }
    return resultados;
  }
  publicarCoreRef = publicarCore;

  app.post('/api/publicar', wrap(async (req, res) => {
    const b = req.body || {};
    const texto = String(b.texto || '').trim().slice(0, 3000);
    const imagem = String(b.imagem_url || '').trim();
    const alvos = (Array.isArray(b.plataformas) ? b.plataformas : []).filter((p) => ['facebook', 'instagram', 'linkedin'].includes(p));
    // O cliente vem da tarefa (quando há) ou da tela: publica sempre nas contas dele, nunca nas de outro
    let cid = Number(b.client_id) || 0;
    if (b.task_id) { const { rows: [t] } = await pool.query('SELECT client_id FROM tasks WHERE id=$1', [b.task_id]); if (t) cid = t.client_id; }
    if (!cid) return res.status(400).json({ erro: 'Escolha o cliente da publicação' });
    if (!texto) return res.status(400).json({ erro: 'Escreva o texto da publicação' });
    if (!alvos.length) return res.status(400).json({ erro: 'Escolha onde publicar' });
    if (imagem && !/^https:\/\/\S+$/i.test(imagem)) return res.status(400).json({ erro: 'O link da imagem precisa começar com https://' });
    if (b.confirmado !== true) return res.status(400).json({ erro: 'Confirme a publicação' });
    const resultados = await publicarCore(cid, alvos, texto, imagem, req.user.id);
    // Publicou em pelo menos uma rede: a tarefa aprovada passa a publicada
    if (b.task_id && resultados.some((r) => r.status === 'publicado')) {
      await pool.query(`UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg='Publicada', esteira_em=now(), updated_at=now() WHERE id=$1 AND esteira IN ('aprovada','agendada')`, [b.task_id]);
    }
    res.json({ resultados });
  }));

  app.get('/api/publicacoes', wrap(async (req, res) => {
    const cid = Number(req.query.client_id) || 0;
    const { rows } = cid
      ? await pool.query('SELECT id, plataforma, texto, status, erro, created_at FROM publicacoes WHERE client_id=$1 ORDER BY created_at DESC LIMIT 30', [cid])
      : await pool.query('SELECT id, plataforma, texto, status, erro, created_at FROM publicacoes ORDER BY created_at DESC LIMIT 30');
    res.json(rows);
  }));
}

let publicarCoreRef = null;
module.exports = { registrar, tokenDaPagina, verifyToken, lerConexao, salvarConexao, jsonDe, GOOGLE_TOKEN, publicar: (...a) => publicarCoreRef(...a) };
