// Conexão com Facebook, Instagram (login da Meta) e LinkedIn, e publicação com confirmação.
// Os tokens ficam criptografados no banco (mesma chave do cofre de senhas: ACESSOS_KEY).
// Nada é publicado sem o clique de uma pessoa na tela de publicação.

const { cfg, listar, definir, remover } = require('./config');
const crypto = require('crypto');
const { cifrar, decifrar } = require('./cofre');

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_ESCOPOS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_messaging',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_messages'];
const LINKEDIN_ESCOPOS = ['openid', 'profile', 'w_member_social'];

const base = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

async function lerConexao(pool, provedor) {
  const { rows: [r] } = await pool.query('SELECT * FROM conexoes WHERE provedor=$1', [provedor]);
  if (!r) return null;
  try { return { ...JSON.parse(decifrar(r.dados_enc)), conectado_em: r.updated_at }; } catch { return null; }
}

async function salvarConexao(pool, provedor, dados) {
  await pool.query(
    `INSERT INTO conexoes (provedor, dados_enc, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (provedor) DO UPDATE SET dados_enc=EXCLUDED.dados_enc, updated_at=now()`,
    [provedor, cifrar(JSON.stringify(dados))]);
}

const verifyToken = () => cfg('META_VERIFY_TOKEN') ||
  (cfg('META_APP_SECRET') ? crypto.createHash('sha256').update('verify:' + cfg('META_APP_SECRET')).digest('hex').slice(0, 24) : null);

async function jsonDe(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const msg = d.error?.message || d.message || d.error_description || `HTTP ${r.status}`;
    const e = new Error(msg); e.status = 502; throw e;
  }
  return d;
}

// Token da página usado para responder mensagens (conexão salva ou variável antiga)
async function tokenDaPagina(pool) {
  const c = await lerConexao(pool, 'meta');
  const pg = c && c.paginas && c.paginas.find((p) => p.id === c.pagina_id);
  return (pg && pg.token) || process.env.META_PAGE_TOKEN || null;
}

function registrar(app, { pool, wrap, soAdmin }) {
  const ASSINAR = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const assinarState = (s) => crypto.createHmac('sha256', ASSINAR).update(s).digest('hex').slice(0, 32);
  const novoState = (userId) => { const s = `${userId}.${crypto.randomBytes(12).toString('hex')}`; return `${s}.${assinarState(s)}`; };
  const stateOk = (state, userId) => {
    const [u, n, sig] = String(state || '').split('.');
    return u === String(userId) && n && sig && assinarState(`${u}.${n}`) === sig;
  };
  const voltar = (res, msg, ok) => res.redirect(`/?integracao=${ok ? 'ok' : 'erro'}&msg=${encodeURIComponent(msg)}`);

  // ----- Meta (Facebook + Instagram) -----
  app.get('/oauth/meta/iniciar', wrap(async (req, res) => {
    if (req.user.papel !== 'admin') return voltar(res, 'Só administradores conectam contas.', false);
    if (!cfg('META_APP_ID') || !cfg('META_APP_SECRET')) return voltar(res, 'Falta configurar META_APP_ID e META_APP_SECRET no Render.', false);
    const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    u.search = new URLSearchParams({
      client_id: cfg('META_APP_ID'), redirect_uri: `${base(req)}/oauth/meta/retorno`,
      state: novoState(req.user.id), scope: META_ESCOPOS.join(','), response_type: 'code',
    });
    res.redirect(u.toString());
  }));

  app.get('/oauth/meta/retorno', wrap(async (req, res) => {
    if (req.query.error) return voltar(res, 'A Meta cancelou a conexão: ' + (req.query.error_description || req.query.error), false);
    if (!stateOk(req.query.state, req.user.id) || req.user.papel !== 'admin') return voltar(res, 'Conexão inválida. Tente de novo.', false);
    try {
      const curto = await jsonDe(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        client_id: cfg('META_APP_ID'), client_secret: cfg('META_APP_SECRET'),
        redirect_uri: `${base(req)}/oauth/meta/retorno`, code: String(req.query.code) }));
      const longo = await jsonDe(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: 'fb_exchange_token', client_id: cfg('META_APP_ID'),
        client_secret: cfg('META_APP_SECRET'), fb_exchange_token: curto.access_token }));
      const eu = await jsonDe(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(longo.access_token)}`);
      const contas = await jsonDe(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(longo.access_token)}`);
      const paginas = (contas.data || []).map((p) => ({
        id: p.id, nome: p.name, token: p.access_token,
        ig_id: p.instagram_business_account?.id || null, ig_usuario: p.instagram_business_account?.username || null,
      }));
      if (!paginas.length) return voltar(res, 'Conectou, mas nenhuma página do Facebook foi liberada. Refaça e marque a página.', false);
      const dados = { usuario: eu.name, paginas, pagina_id: paginas[0].id };
      await salvarConexao(pool, 'meta', dados);
      // Recebe as mensagens da página no webhook (se falhar, segue: dá para configurar no painel da Meta)
      for (const p of paginas) {
        await fetch(`${GRAPH}/${p.id}/subscribed_apps?subscribed_fields=messages`, {
          method: 'POST', headers: { authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
      }
      voltar(res, `Facebook conectado: ${paginas.map((p) => p.nome).join(', ')}`, true);
    } catch (e) { console.error('Erro OAuth Meta', e.message); voltar(res, 'Não consegui concluir a conexão com a Meta: ' + e.message, false); }
  }));

  // ----- LinkedIn -----
  app.get('/oauth/linkedin/iniciar', wrap(async (req, res) => {
    if (req.user.papel !== 'admin') return voltar(res, 'Só administradores conectam contas.', false);
    if (!cfg('LINKEDIN_CLIENT_ID') || !cfg('LINKEDIN_CLIENT_SECRET')) return voltar(res, 'Falta configurar LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET no Render.', false);
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.search = new URLSearchParams({
      response_type: 'code', client_id: cfg('LINKEDIN_CLIENT_ID'), redirect_uri: `${base(req)}/oauth/linkedin/retorno`,
      state: novoState(req.user.id), scope: LINKEDIN_ESCOPOS.join(' '),
    });
    res.redirect(u.toString());
  }));

  app.get('/oauth/linkedin/retorno', wrap(async (req, res) => {
    if (req.query.error) return voltar(res, 'O LinkedIn cancelou a conexão: ' + (req.query.error_description || req.query.error), false);
    if (!stateOk(req.query.state, req.user.id) || req.user.papel !== 'admin') return voltar(res, 'Conexão inválida. Tente de novo.', false);
    try {
      const t = await jsonDe('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code),
          redirect_uri: `${base(req)}/oauth/linkedin/retorno`, client_id: cfg('LINKEDIN_CLIENT_ID'),
          client_secret: cfg('LINKEDIN_CLIENT_SECRET') }) });
      const eu = await jsonDe('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
      await salvarConexao(pool, 'linkedin', {
        token: t.access_token, expira_em: Date.now() + (t.expires_in || 5184000) * 1000,
        autor: `urn:li:person:${eu.sub}`, nome: eu.name || [eu.given_name, eu.family_name].filter(Boolean).join(' '),
      });
      voltar(res, `LinkedIn conectado: ${eu.name || 'conta'}`, true);
    } catch (e) { console.error('Erro OAuth LinkedIn', e.message); voltar(res, 'Não consegui concluir a conexão com o LinkedIn: ' + e.message, false); }
  }));

  // ----- Painel de chaves das APIs -----
  app.get('/api/configuracoes', soAdmin, (req, res) => res.json(listar()));
  app.put('/api/configuracoes/:chave', soAdmin, wrap(async (req, res) => {
    try { await definir(pool, req.params.chave, req.body.valor); }
    catch (e) { if (/Cofre/.test(e.message)) e.message = 'O cofre não está configurado: defina ACESSOS_KEY no Render.'; throw e; }
    res.json(listar());
  }));
  app.delete('/api/configuracoes/:chave', soAdmin, wrap(async (req, res) => {
    await remover(pool, req.params.chave);
    res.json(listar());
  }));

  // ----- Status e gestão -----
  app.get('/api/conexoes', wrap(async (req, res) => {
    const [meta, li] = await Promise.all([lerConexao(pool, 'meta'), lerConexao(pool, 'linkedin')]);
    const pg = meta && meta.paginas.find((p) => p.id === meta.pagina_id);
    res.json({
      meta: {
        app_configurado: !!(cfg('META_APP_ID') && cfg('META_APP_SECRET')),
        conectado: !!meta, usuario: meta?.usuario || null, pagina_id: meta?.pagina_id || null,
        paginas: (meta?.paginas || []).map((p) => ({ id: p.id, nome: p.nome, ig_usuario: p.ig_usuario })),
        facebook: pg ? pg.nome : null, instagram: pg?.ig_usuario || null,
        webhook: `${base(req)}/webhook/meta`, verify_token: req.user.papel === 'admin' ? verifyToken() : null,
        redirect: `${base(req)}/oauth/meta/retorno`,
      },
      linkedin: {
        app_configurado: !!(cfg('LINKEDIN_CLIENT_ID') && cfg('LINKEDIN_CLIENT_SECRET')),
        conectado: !!li, nome: li?.nome || null, expira_em: li?.expira_em || null,
        expirado: !!(li && li.expira_em < Date.now()), redirect: `${base(req)}/oauth/linkedin/retorno`,
      },
    });
  }));

  app.put('/api/conexoes/meta/pagina', soAdmin, wrap(async (req, res) => {
    const c = await lerConexao(pool, 'meta');
    if (!c) return res.status(404).json({ erro: 'Facebook não está conectado' });
    if (!c.paginas.some((p) => p.id === req.body.pagina_id)) return res.status(400).json({ erro: 'Página inválida' });
    delete c.conectado_em;
    await salvarConexao(pool, 'meta', { ...c, pagina_id: req.body.pagina_id });
    res.json({ ok: true });
  }));

  app.delete('/api/conexoes/:provedor', soAdmin, wrap(async (req, res) => {
    if (!['meta', 'linkedin'].includes(req.params.provedor)) return res.status(400).json({ erro: 'Provedor inválido' });
    await pool.query('DELETE FROM conexoes WHERE provedor=$1', [req.params.provedor]);
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
    if (c.expira_em < Date.now()) throw new Error('A conexão com o LinkedIn expirou. Conecte de novo em Integrações.');
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

  app.post('/api/publicar', wrap(async (req, res) => {
    const b = req.body || {};
    const texto = String(b.texto || '').trim().slice(0, 3000);
    const imagem = String(b.imagem_url || '').trim();
    const alvos = (Array.isArray(b.plataformas) ? b.plataformas : []).filter((p) => ['facebook', 'instagram', 'linkedin'].includes(p));
    if (!texto) return res.status(400).json({ erro: 'Escreva o texto da publicação' });
    if (!alvos.length) return res.status(400).json({ erro: 'Escolha onde publicar' });
    if (imagem && !/^https:\/\/\S+$/i.test(imagem)) return res.status(400).json({ erro: 'O link da imagem precisa começar com https://' });
    if (b.confirmado !== true) return res.status(400).json({ erro: 'Confirme a publicação' });
    const meta = await lerConexao(pool, 'meta');
    const li = await lerConexao(pool, 'linkedin');
    const resultados = [];
    for (const plat of alvos) {
      let status = 'publicado', externo = null, erro = null;
      try {
        if (plat === 'linkedin') { if (!li) throw new Error('LinkedIn não está conectado'); externo = await publicarLinkedin(li, texto); }
        else {
          if (!meta) throw new Error('Facebook/Instagram não está conectado');
          externo = plat === 'facebook' ? await publicarFacebook(meta, texto, imagem) : await publicarInstagram(meta, texto, imagem);
        }
      } catch (e) { status = 'erro'; erro = e.message; console.error(`Erro ao publicar em ${plat}:`, e.message); }
      await pool.query(
        `INSERT INTO publicacoes (plataforma, texto, imagem_url, externo_id, status, erro, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [plat, texto, imagem || null, externo ? String(externo) : null, status, erro, req.user.id]);
      resultados.push({ plataforma: plat, status, erro });
    }
    // Publicou em pelo menos uma rede: a tarefa aprovada passa a publicada
    if (b.task_id && resultados.some((r) => r.status === 'publicado')) {
      await pool.query(`UPDATE tasks SET status='publicado', esteira='publicada', esteira_msg='Publicada', esteira_em=now(), updated_at=now() WHERE id=$1 AND esteira='aprovada'`, [b.task_id]);
    }
    res.json({ resultados });
  }));

  app.get('/api/publicacoes', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id, plataforma, texto, status, erro, created_at FROM publicacoes ORDER BY created_at DESC LIMIT 30');
    res.json(rows);
  }));
}

module.exports = { registrar, tokenDaPagina, verifyToken, lerConexao };
