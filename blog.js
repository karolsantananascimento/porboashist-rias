// Blog do site MidIAut: o administrador escreve em Markdown simples, vê a prévia e publica em /blog.
// Páginas públicas são geradas no servidor (boas para SEO) e o texto é sempre escapado antes de virar HTML.
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const httpsUrl = (u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || ''));

const slugDe = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Markdown mínimo e seguro: #, ##, ###, listas (- ou 1.), > citação, **negrito**, *itálico*, [texto](https://link), ![alt](https://imagem), --- e parágrafos.
function inline(t) {
  let h = esc(t);
  h = h.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a}" loading="lazy">`);
  h = h.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_, a, u) => `<a href="${u}"${u.startsWith('/') ? '' : ' rel="noopener nofollow" target="_blank"'}>${a}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return h;
}
function markdown(src) {
  const linhas = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let par = []; let lista = null;
  const fechaPar = () => { if (par.length) { out.push(`<p>${inline(par.join(' '))}</p>`); par = []; } };
  const fechaLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const l of linhas) {
    let m;
    if (!l.trim()) { fechaPar(); fechaLista(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { fechaPar(); fechaLista(); const n = m[1].length + 1; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^---+$/.test(l.trim())) { fechaPar(); fechaLista(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(l))) { fechaPar(); fechaLista(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { fechaPar(); if (lista !== 'ul') { fechaLista(); out.push('<ul>'); lista = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { fechaPar(); if (lista !== 'ol') { fechaLista(); out.push('<ol>'); lista = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    fechaLista(); par.push(l.trim());
  }
  fechaPar(); fechaLista();
  return out.join('\n');
}
const minutos = (md) => Math.max(1, Math.round(String(md || '').split(/\s+/).filter(Boolean).length / 200));

const CSS = `@font-face{font-family:Manrope;src:url(/fonts/Manrope.ttf);font-weight:200 800;font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#17191D;color:#E8EAEE;font:17px/1.7 Manrope,system-ui,sans-serif}
a{color:#B6FF45}header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid #2E333B;position:sticky;top:0;background:rgba(23,25,29,.92);backdrop-filter:blur(8px)}
.marca{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:800;font-size:20px}.marca img{height:30px}.marca i{color:#B6FF45;font-style:normal}
.cta{background:#B6FF45;color:#17191D!important;text-decoration:none;font-weight:800;border-radius:10px;padding:10px 16px;font-size:15px}
main{max-width:760px;margin:0 auto;padding:40px 22px 80px}h1{font-size:clamp(30px,5vw,46px);line-height:1.15;margin:0 0 12px;color:#fff}h2,h3,h4{color:#fff;line-height:1.25;margin:2em 0 .5em}
.meta{color:#777E8B;font-size:14px;margin-bottom:28px}.lede{color:#A8AEBA;font-size:19px}
article img{max-width:100%;border-radius:12px}blockquote{margin:1.4em 0;padding:4px 18px;border-left:3px solid #B6FF45;color:#A8AEBA}
ul,ol{padding-left:22px}hr{border:0;border-top:1px solid #2E333B;margin:2em 0}
.cartao{display:block;background:#1E2127;border:1px solid #2E333B;border-radius:14px;padding:22px;margin:0 0 16px;text-decoration:none;color:inherit;transition:border-color .15s}
.cartao:hover{border-color:#B6FF45}.cartao h2{margin:0 0 6px;font-size:22px}.cartao p{margin:0;color:#A8AEBA;font-size:15px}.cartao small{color:#777E8B}
.capa{width:100%;border-radius:14px;margin:0 0 26px;aspect-ratio:16/9;object-fit:cover}
.fim{margin-top:48px;background:#1E2127;border:1px solid #2E333B;border-radius:16px;padding:26px;text-align:center}.fim p{margin:0 0 14px;color:#A8AEBA}
footer{border-top:1px solid #2E333B;padding:24px;text-align:center;color:#777E8B;font-size:14px}footer a{color:#A8AEBA}`;

function pagina({ titulo, descricao, canonico, corpo, tipo = 'website', capa, jsonld }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><meta name="description" content="${esc(descricao)}"><link rel="canonical" href="${esc(canonico)}">
<meta name="theme-color" content="#17191D"><link rel="icon" href="/brand/midiaut/favicon.svg">
<meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(descricao)}"><meta property="og:type" content="${tipo}"><meta property="og:url" content="${esc(canonico)}"><meta property="og:image" content="${esc(capa || new URL('/brand/midiaut/og.png', canonico).href)}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}<style>${CSS}</style></head><body>
<header class="top"><a class="marca" href="/midiaut"><img src="/brand/midiaut/simbolo.svg" alt="" width="34" height="30"><span>Mid<i>IA</i>ut</span></a><nav><a href="/blog" style="margin-right:18px;color:#A8AEBA;text-decoration:none">Blog</a><a class="cta" href="/cadastro?plano=testar">Testar grátis</a></nav></header>
${corpo}
<footer>© MidIAut · Tráfego em piloto automático. · <a href="/midiaut">Conheça a plataforma</a></footer></body></html>`;
}

const dataBr = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Recife' });
const baseDe = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

function normalizar(b = {}) {
  const titulo = String(b.titulo || '').trim().slice(0, 140);
  const capa = String(b.capa_url || '').trim();
  if (capa && !httpsUrl(capa)) throw erro('A imagem de capa precisa ser um link https.');
  return {
    titulo, slug: slugDe(b.slug || titulo), resumo: String(b.resumo || '').trim().slice(0, 300), corpo: String(b.corpo || '').slice(0, 60000),
    capa_url: capa, seo_titulo: String(b.seo_titulo || '').trim().slice(0, 70), seo_desc: String(b.seo_desc || '').trim().slice(0, 170),
  };
}

function registrarPublico(app, { pool, wrap }) {
  app.get('/blog', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT titulo, slug, resumo, publicado_em, corpo FROM site_posts WHERE status='publicado' ORDER BY publicado_em DESC LIMIT 100`);
    const b = baseDe(req);
    const lista = rows.length ? rows.map((p) => `<a class="cartao" href="/blog/${esc(p.slug)}"><small>${esc(dataBr(p.publicado_em))} · ${minutos(p.corpo)} min de leitura</small><h2>${esc(p.titulo)}</h2><p>${esc(p.resumo)}</p></a>`).join('') : '<p class="lede">Os primeiros artigos chegam em breve.</p>';
    res.type('html').send(pagina({
      titulo: 'Blog MidIAut | Tráfego pago, Google Ads e Meta Ads com IA', descricao: 'Artigos sobre gestão de tráfego pago, Google Ads, Meta Ads e automação com inteligência artificial.', canonico: `${b}/blog`,
      corpo: `<main><h1>Blog</h1><p class="lede">Tráfego pago, Google Ads, Meta Ads e automação com IA.</p><br>${lista}</main>`,
    }));
  }));
  app.get('/blog/:slug', wrap(async (req, res) => {
    const { rows: [p] } = await pool.query(`SELECT * FROM site_posts WHERE slug=$1 AND status='publicado'`, [String(req.params.slug).slice(0, 100)]);
    if (!p) return res.status(404).type('html').send(pagina({ titulo: 'Artigo não encontrado | MidIAut', descricao: 'Artigo não encontrado.', canonico: `${baseDe(req)}/blog`, corpo: '<main><h1>Artigo não encontrado</h1><p class="lede">Esse artigo não existe ou saiu do ar.</p><p><a href="/blog">Ver todos os artigos</a></p></main>' }));
    const b = baseDe(req); const url = `${b}/blog/${p.slug}`;
    const jsonld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.titulo, description: p.seo_desc || p.resumo, datePublished: p.publicado_em, dateModified: p.updated_at, mainEntityOfPage: url, image: p.capa_url || undefined, author: { '@type': 'Organization', name: 'MidIAut' }, publisher: { '@type': 'Organization', name: 'MidIAut' } };
    res.type('html').send(pagina({
      titulo: p.seo_titulo || `${p.titulo} | MidIAut`, descricao: p.seo_desc || p.resumo || p.titulo, canonico: url, tipo: 'article', capa: p.capa_url || undefined, jsonld,
      corpo: `<main><article><p class="meta"><a href="/blog">← Blog</a> · ${esc(dataBr(p.publicado_em))} · ${minutos(p.corpo)} min de leitura</p><h1>${esc(p.titulo)}</h1>${p.resumo ? `<p class="lede">${esc(p.resumo)}</p>` : ''}${p.capa_url ? `<img class="capa" src="${esc(p.capa_url)}" alt="">` : ''}${markdown(p.corpo)}</article>
<div class="fim"><p><b>Crie campanhas de Google e Meta em minutos.</b><br>Teste a MidIAut por 7 dias, sem cartão.</p><a class="cta" href="/cadastro?plano=testar">Testar grátis</a></div></main>`,
    }));
  }));
  app.get('/sitemap.xml', wrap(async (req, res) => {
    const b = baseDe(req); const { rows } = await pool.query(`SELECT slug, updated_at FROM site_posts WHERE status='publicado' ORDER BY publicado_em DESC`);
    const u = [['/midiaut', null], ['/blog', null], ...rows.map((p) => [`/blog/${p.slug}`, p.updated_at])];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u.map(([l, d]) => `<url><loc>${esc(b + l)}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('')}</urlset>`);
  }));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /midiaut\nAllow: /blog\nDisallow: /api/\nDisallow: /assinante\nSitemap: ${baseDe(req)}/sitemap.xml\n`));
}

function registrar(app, { pool, wrap, soAdmin }) {
  const livre = async (slug, id = 0) => { let s = slug || 'artigo'; let n = 1; for (;;) { const { rows } = await pool.query('SELECT 1 FROM site_posts WHERE slug=$1 AND id<>$2', [s, id]); if (!rows.length) return s; n++; s = `${slug}-${n}`; } };
  app.get('/api/site/posts', soAdmin, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id, titulo, slug, resumo, status, publicado_em, updated_at FROM site_posts ORDER BY updated_at DESC LIMIT 300');
    res.json({ posts: rows });
  }));
  app.get('/api/site/posts/:id', soAdmin, wrap(async (req, res) => {
    const { rows: [p] } = await pool.query('SELECT * FROM site_posts WHERE id=$1', [Number(req.params.id) || 0]);
    if (!p) throw erro('Artigo não encontrado.', 404); res.json({ post: p });
  }));
  app.post('/api/site/posts', soAdmin, wrap(async (req, res) => {
    const n = normalizar(req.body); n.titulo ||= 'Novo artigo'; n.slug = await livre(n.slug || slugDe(n.titulo));
    const { rows: [p] } = await pool.query(
      `INSERT INTO site_posts (titulo, slug, resumo, corpo, capa_url, seo_titulo, seo_desc, autor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [n.titulo, n.slug, n.resumo, n.corpo, n.capa_url, n.seo_titulo, n.seo_desc, req.user.nome || req.user.email]);
    res.json({ post: p });
  }));
  app.put('/api/site/posts/:id', soAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id) || 0; const n = normalizar(req.body);
    const { rows: [atual] } = await pool.query('SELECT * FROM site_posts WHERE id=$1', [id]); if (!atual) throw erro('Artigo não encontrado.', 404);
    if (!n.titulo) throw erro('Dê um título ao artigo.');
    const publicar = req.body.status === 'publicado'; const despublicar = req.body.status === 'rascunho';
    if (publicar && (!n.corpo.trim() || !n.resumo)) throw erro('Para publicar, escreva o resumo e o texto do artigo.');
    // endereço publicado não muda sozinho: links já compartilhados continuam valendo
    // rascunho sem endereço personalizado acompanha o título; publicado nunca muda
    const acompanha = n.slug === atual.slug && atual.slug.replace(/-\d+$/, '') === slugDe(atual.titulo);
    const slug = atual.status === 'publicado' && atual.slug ? atual.slug : await livre(acompanha ? slugDe(n.titulo) : n.slug, id);
    const { rows: [p] } = await pool.query(
      `UPDATE site_posts SET titulo=$2, slug=$3, resumo=$4, corpo=$5, capa_url=$6, seo_titulo=$7, seo_desc=$8,
         status = CASE WHEN $9 THEN 'publicado' WHEN $10 THEN 'rascunho' ELSE status END,
         publicado_em = CASE WHEN $9 AND publicado_em IS NULL THEN now() ELSE publicado_em END, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, n.titulo, slug, n.resumo, n.corpo, n.capa_url, n.seo_titulo, n.seo_desc, publicar, despublicar]);
    res.json({ post: p });
  }));
  app.delete('/api/site/posts/:id', soAdmin, wrap(async (req, res) => {
    await pool.query('DELETE FROM site_posts WHERE id=$1', [Number(req.params.id) || 0]); res.json({ ok: true });
  }));
  app.post('/api/site/previa', soAdmin, wrap(async (req, res) => res.json({ html: markdown(req.body?.corpo), minutos: minutos(req.body?.corpo) })));
}

module.exports = { registrar, registrarPublico, markdown, slugDe };
