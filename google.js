// Google Drive (fotos e vídeos) e Google Docs (documento de pauta). A conexão é feita em Acessos e APIs (OAuth).
// O token fica criptografado no banco; o sistema renova sozinho. Só lê o Drive e cria documentos: nunca apaga nada.

const crypto = require('crypto');
const { cfg } = require('./config');
const { lerConexao, salvarConexao, GOOGLE_TOKEN } = require('./integracoes');
const { prepararImagem } = require('./midia');

const DRIVE = process.env.GOOGLE_DRIVE_URL || 'https://www.googleapis.com/drive/v3';
const UPLOAD = process.env.GOOGLE_UPLOAD_URL || 'https://www.googleapis.com/upload/drive/v3';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Conexão do cliente; sem ela, a conexão padrão (escopo 0). Renova o token quando falta pouco para vencer.
async function conexao(pool, clienteId) {
  const ids = Number(clienteId) ? [Number(clienteId), 0] : [0];
  for (const cid of ids) { const c = await lerConexao(pool, 'google', cid); if (c) return { c, cid }; }
  return null;
}

async function tokenGoogle(pool, clienteId) {
  const achou = await conexao(pool, clienteId);
  if (!achou) { const e = new Error('O Google não está conectado. Conecte em Acessos e APIs.'); e.status = 400; throw e; }
  const { c, cid } = achou;
  if (c.expira_em > Date.now() + 60000) return c.token;
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: cfg('GOOGLE_CLIENT_ID', cid), client_secret: cfg('GOOGLE_CLIENT_SECRET', cid) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const e = new Error(d.error === 'invalid_grant' ? 'A conexão com o Google expirou. Reconecte em Acessos e APIs.' : 'Não consegui renovar o acesso ao Google: ' + (d.error_description || d.error || r.status)); e.status = 502; throw e;
  }
  delete c.conectado_em;
  await salvarConexao(pool, 'google', cid, { ...c, token: d.access_token, expira_em: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

async function api(pool, clienteId, url, opts = {}) {
  const token = await tokenGoogle(pool, clienteId);
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(opts.timeout || 30000) });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(r.status === 403 && /accessNotConfigured|has not been used/.test(JSON.stringify(d)) ? 'Ative a API do Google Drive no projeto do Google Cloud.' : (d.error?.message || `Google respondeu HTTP ${r.status}`));
    e.status = 502; throw e;
  }
  return r;
}

// Texto que vai ao ar (mesma regra da tela): só a seção LEGENDA do que o Hugo escreveu
function extrairLegenda(txt) {
  const t = String(txt || '');
  const m = t.match(/^[#*\s]*LEGENDA[^\n]*\n([\s\S]*?)(?=\n[#*\s]*(BRIEFING|HASHTAGS|CONFERIR|OP[ÇC][ÕO]ES|CARD\s*1|CAPA)\b|(?![\s\S]))/im);
  return (m ? m[1] : t).trim();
}
const SECAO_BRIEFING = /^[#*\s]*BRIEFING[^\n]*\n([\s\S]*?)(?=\n[#*\s]*(CONFERIR|HASHTAGS)\b|(?![\s\S]))/im;

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaBR = (d) => { if (!d) return 'Sem data'; const s = String(d).slice(0, 10); const dt = new Date(s + 'T12:00'); return `${s.slice(8)}/${s.slice(5, 7)} (${DIAS[dt.getDay()]})`; };
const paragrafos = (s) => String(s || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

// Monta o documento único de pauta: datas, legendas e criativos
function htmlPauta({ titulo, tarefas, geradoEm }) {
  const porDia = [];
  for (const t of tarefas) {
    const dia = t.data ? String(t.data).slice(0, 10) : '';
    const g = porDia.find((x) => x.dia === dia) || porDia[porDia.push({ dia, itens: [] }) - 1];
    g.itens.push(t);
  }
  const corpo = porDia.map((g) => `<h2>${esc(diaBR(g.dia))}</h2>` + g.itens.map((t) => {
    const legenda = t.tipo === 'story' ? extrairLegenda(t.briefing) : extrairLegenda(t.legenda || t.briefing);
    const brief = ((t.legenda || '').match(SECAO_BRIEFING) || [])[1];
    const midias = (t.midias || []).filter((m) => m.link);
    return `<h3>${esc(t.cliente_nome)} · ${esc(t.tema || 'Sem título')}</h3>
      <p><b>Formato:</b> ${esc(t.formato || t.tipo)} &nbsp; <b>Status:</b> ${esc(t.esteira ? ({ executando: 'Em produção', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada', agendada: 'Agendada', publicando: 'Publicando', publicada: 'Publicada', erro: 'Erro' })[t.esteira] : t.status)}${t.plataformas ? ` &nbsp; <b>Canais:</b> ${esc(t.plataformas.replace(/,/g, ', '))}` : ''}</p>
      <h4>Legenda</h4>${legenda ? paragrafos(legenda) : '<p><i>Ainda sem legenda.</i></p>'}
      <h4>Criativo</h4>${t.arte_url ? `<p><a href="${esc(t.arte_url)}">Abrir criativo no Canva</a></p>` : '<p><i>Sem link do criativo.</i></p>'}
      ${brief ? `<p><b>Briefing do criativo:</b></p>${paragrafos(brief.slice(0, 1500))}` : ''}
      ${midias.length ? `<p><b>Fotos e vídeos do Drive:</b> ${midias.map((m) => `<a href="${esc(m.link)}">${esc(m.nome)}</a>`).join(' · ')}</p>` : ''}`;
  }).join('<hr>')).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title></head><body><h1>${esc(titulo)}</h1><p><i>Gerado em ${esc(geradoEm)}</i></p>${corpo || '<p>Nenhuma pauta no período.</p>'}</body></html>`;
}

function registrar(app, { pool, wrap }) {
  const escopoCliente = async (q) => {
    if (q.client_id) return Number(q.client_id);
    if (q.project_id) { // conexão de qualquer cliente do projeto, se não houver a padrão
      const { rows } = await pool.query(`SELECT c.id FROM clients c JOIN conexoes x ON x.client_id=c.id AND x.provedor='google' WHERE c.project_id=$1 ORDER BY c.id LIMIT 1`, [q.project_id]);
      return rows[0]?.id || 0;
    }
    return 0;
  };

  // Lista pastas, fotos e vídeos de uma pasta do Drive
  app.get('/api/drive/arquivos', wrap(async (req, res) => {
    const cid = await escopoCliente(req.query);
    const pasta = String(req.query.pasta || 'root');
    if (!/^[\w-]+$/.test(pasta)) return res.status(400).json({ erro: 'Pasta inválida' });
    const busca = String(req.query.q || '').trim().slice(0, 80).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const tipos = "(mimeType contains 'image/' or mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')";
    const q = busca ? `name contains '${busca}' and trashed = false and ${tipos}` : `'${pasta}' in parents and trashed = false and ${tipos}`;
    const u = new URL(`${DRIVE}/files`);
    u.search = new URLSearchParams({
      q, pageSize: '60', orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,size,videoMediaMetadata(durationMillis))',
      ...(req.query.pagina ? { pageToken: String(req.query.pagina) } : {}) });
    const r = await (await api(pool, cid, u.toString())).json();
    res.json({
      proxima: r.nextPageToken || null,
      arquivos: (r.files || []).map((f) => ({
        id: f.id, nome: f.name, pasta: f.mimeType === 'application/vnd.google-apps.folder', video: /^video\//.test(f.mimeType), mime: f.mimeType,
        thumb: f.thumbnailLink || null, link: f.webViewLink || null, tamanho: f.size ? Number(f.size) : null,
        duracao: f.videoMediaMetadata?.durationMillis ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000) : null })),
    });
  }));

  // Anexa fotos e vídeos escolhidos a uma pauta (só guarda as referências; nada é copiado nem alterado no Drive)
  app.post('/api/tasks/:id/midias', wrap(async (req, res) => {
    const novos = (Array.isArray(req.body.arquivos) ? req.body.arquivos : []).slice(0, 20)
      .filter((m) => m && /^[\w-]+$/.test(String(m.id || '')))
      .map((m) => ({ id: String(m.id), nome: String(m.nome || 'arquivo').slice(0, 160), video: !!m.video, link: /^https:\/\//.test(String(m.link || '')) ? String(m.link) : null, thumb: /^https:\/\//.test(String(m.thumb || '')) ? String(m.thumb) : null }));
    if (!novos.length) return res.status(400).json({ erro: 'Escolha ao menos um arquivo' });
    const { rows: [t] } = await pool.query('SELECT midias FROM tasks WHERE id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ erro: 'Pauta não encontrada' });
    const atual = Array.isArray(t.midias) ? t.midias : [];
    const todos = [...atual, ...novos.filter((n) => !atual.some((a) => a.id === n.id))].slice(0, 30);
    await pool.query('UPDATE tasks SET midias=$1::jsonb, updated_at=now() WHERE id=$2', [JSON.stringify(todos), req.params.id]);
    res.json({ midias: todos });
  }));

  app.delete('/api/tasks/:id/midias/:fid', wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(`UPDATE tasks SET midias = COALESCE((SELECT jsonb_agg(m) FROM jsonb_array_elements(midias) m WHERE m->>'id' <> $2), '[]'::jsonb), updated_at=now() WHERE id=$1 RETURNING midias`, [req.params.id, req.params.fid]);
    if (!t) return res.status(404).json({ erro: 'Pauta não encontrada' });
    res.json({ midias: t.midias });
  }));

  // Baixa uma foto do Drive, converte para JPEG e guarda com link estável (o Instagram exige um link https público)
  app.post('/api/drive/importar', wrap(async (req, res) => {
    const fid = String(req.body.file_id || '');
    if (!/^[\w-]+$/.test(fid)) return res.status(400).json({ erro: 'Arquivo inválido' });
    let cid = 0;
    if (req.body.task_id) { const { rows: [t] } = await pool.query('SELECT client_id FROM tasks WHERE id=$1', [req.body.task_id]); if (t) cid = t.client_id; }
    const meta = await (await api(pool, cid, `${DRIVE}/files/${fid}?supportsAllDrives=true&fields=mimeType,size,name`)).json();
    if (!/^image\/(png|jpe?g|webp)$/.test(meta.mimeType || '')) return res.status(400).json({ erro: 'Só dá para usar foto PNG ou JPG como imagem do post (vídeo fica como anexo)' });
    if (Number(meta.size) > 12 * 1024 * 1024) return res.status(400).json({ erro: 'Imagem maior que 12 MB' });
    const buf = Buffer.from(await (await api(pool, cid, `${DRIVE}/files/${fid}?alt=media&supportsAllDrives=true`, { timeout: 60000 })).arrayBuffer());
    const { buf: jpg, tipo } = await prepararImagem(buf, meta.mimeType);
    const id = crypto.randomBytes(16).toString('hex');
    await pool.query('INSERT INTO midia (id, tipo, dados) VALUES ($1,$2,$3)', [id, tipo, jpg]);
    const url = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}/media/${id}`;
    if (req.body.task_id) await pool.query('UPDATE tasks SET publicar_imagem=$1, updated_at=now() WHERE id=$2', [url, req.body.task_id]);
    res.json({ url, nome: meta.name });
  }));

  // Documento único de pauta (datas, legendas e criativos). Com o Google conectado vira um Google Doc;
  // sem ele, devolve o HTML para baixar (abre no Word e no Google Docs).
  app.post('/api/docs/pauta', wrap(async (req, res) => {
    const b = req.body || {};
    const v = []; const w = [];
    if (b.client_id) { v.push(b.client_id); w.push(`t.client_id=$${v.length}`); }
    else if (b.project_id) { v.push(b.project_id); w.push(`t.client_id IN (SELECT id FROM clients WHERE project_id=$${v.length})`); }
    else return res.status(400).json({ erro: 'Escolha o projeto' });
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
    const mes = /^\d{4}-\d{2}$/.test(b.mes || '') ? b.mes : hoje;
    v.push(mes); w.push(`to_char(t.data,'YYYY-MM')=$${v.length}`);
    w.push(`NOT (t.tipo='story' AND COALESCE(t.legenda,'')='' AND COALESCE(t.briefing,'')='')`);
    const { rows: tarefas } = await pool.query(
      `SELECT t.*, c.nome AS cliente_nome FROM tasks t JOIN clients c ON c.id=t.client_id WHERE ${w.join(' AND ')} ORDER BY t.data, c.nome, t.id LIMIT 300`, v);
    const { rows: [alvo] } = b.client_id ? await pool.query('SELECT nome FROM clients WHERE id=$1', [b.client_id]) : await pool.query('SELECT nome FROM projects WHERE id=$1', [b.project_id]);
    const nomeMes = new Date(mes + '-15T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const titulo = `Pauta · ${alvo?.nome || ''} · ${nomeMes}`;
    const html = htmlPauta({ titulo, tarefas, geradoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' }) });
    const cid = await escopoCliente(b);
    if (!(await conexao(pool, cid))) return res.json({ via: 'download', nome: titulo, html, total: tarefas.length });
    const lim = '----pauta' + crypto.randomBytes(8).toString('hex');
    const corpo = `--${lim}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: titulo, mimeType: 'application/vnd.google-apps.document' })}\r\n--${lim}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${lim}--`;
    const r = await (await api(pool, cid, `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${lim}` }, body: corpo, timeout: 60000 })).json();
    res.json({ via: 'google', nome: r.name, link: r.webViewLink, total: tarefas.length });
  }));
}

module.exports = { registrar, htmlPauta, extrairLegenda, tokenGoogle };
