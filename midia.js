// Imagens das artes: o link de exportação do Canva expira e o Instagram exige um link https público e estável.
// Guardamos uma cópia (JPEG otimizado) e servimos por /media/:id (id aleatório). Base: Agente de Tráfego.
const crypto = require('crypto');
const net = require('net');

const MAX_BAIXAR = 12 * 1024 * 1024;
const MAX_FINAL = 4 * 1024 * 1024;

function urlPermitida(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:') return false;
  const h = x.hostname.toLowerCase();
  if (net.isIP(h) || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  return true;
}

async function baixarImagem(url) {
  if (!urlPermitida(url)) throw new Error('Use um link https público de imagem (PNG ou JPG)');
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Não consegui baixar a imagem (HTTP ${r.status})`);
  const tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpe?g|webp)$/.test(tipo)) throw new Error(`O link não é uma imagem PNG/JPG (${tipo || 'tipo desconhecido'})`);
  const buf0 = Buffer.from(await r.arrayBuffer());
  return prepararImagem(buf0, tipo);
}

// Converte para JPEG (o Instagram só aceita JPEG) e confere o tamanho
async function prepararImagem(buf, tipo) {
  if (buf.length > MAX_BAIXAR) throw new Error('Imagem maior que 12 MB');
  let saida = tipo;
  try { // o Instagram só aceita JPEG: converte e reduz o peso
    const sharp = require('sharp');
    buf = await sharp(buf).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    saida = 'image/jpeg';
  } catch (e) { if (tipo !== 'image/jpeg') throw new Error('Não consegui converter a imagem para JPEG'); }
  if (buf.length > MAX_FINAL) throw new Error('Imagem maior que 4 MB depois de otimizar');
  return { buf, tipo: saida };
}

function registrar(app, { pool, wrap }) {
  // Guarda a imagem e devolve o link estável. Se vier task_id, já grava na tarefa (usado na publicação).
  app.post('/api/midia', wrap(async (req, res) => {
    const { buf, tipo } = await baixarImagem(String(req.body.url || '').trim());
    const id = crypto.randomBytes(16).toString('hex');
    await pool.query('INSERT INTO midia (id, tipo, dados) VALUES ($1,$2,$3)', [id, tipo, buf]);
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const url = `${proto}://${req.get('host')}/media/${id}`;
    if (req.body.task_id) await pool.query('UPDATE tasks SET publicar_imagem=$1, updated_at=now() WHERE id=$2', [url, req.body.task_id]);
    res.json({ url, bytes: buf.length });
  }));
}

function registrarPublico(app, { pool, wrap }) {
  app.get('/media/:id', wrap(async (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(404).end();
    const { rows: [m] } = await pool.query('SELECT tipo, dados FROM midia WHERE id=$1', [req.params.id]);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m.tipo); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(m.dados);
  }));
}

module.exports = { registrar, registrarPublico, urlPermitida, prepararImagem };
