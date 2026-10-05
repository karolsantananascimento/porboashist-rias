// Criptografia das senhas de acesso dos clientes (AES-256-GCM)
const crypto = require('crypto');

function chave() {
  const k = process.env.ACESSOS_KEY;
  if (!k) return null;
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('ACESSOS_KEY precisa ter 32 bytes em base64');
  return buf;
}

function cifrar(texto) {
  if (texto == null || texto === '') return null;
  const k = chave();
  if (!k) throw new Error('Cofre de senhas não configurado (ACESSOS_KEY)');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decifrar(valor) {
  if (!valor) return null;
  const k = chave();
  if (!k) throw new Error('Cofre de senhas não configurado (ACESSOS_KEY)');
  const [v, iv, tag, ct] = valor.split(':');
  if (v !== 'v1') throw new Error('Formato de senha desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

module.exports = { cifrar, decifrar };
