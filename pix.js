// Pix estático (BR Code do Banco Central): monta o "copia e cola" e o QR Code de uma chave Pix com valor e identificador.
// Não há confirmação automática: o assinante avisa que pagou e a administradora confere no banco e libera.
const QRCode = require('qrcode');

const CHAVE = () => String(process.env.PIX_CHAVE || '67679923000192').trim();
const NOME = () => limpar(process.env.PIX_NOME || 'MIDIAUT', 25);
const CIDADE = () => limpar(process.env.PIX_CIDADE || 'RECIFE', 15);

// só letras e números sem acento, maiúsculas (exigência do BR Code)
function limpar(t, max) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().trim().slice(0, max); }
const campo = (id, v) => `${id}${String(v.length).padStart(2, '0')}${v}`;

function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

function payloadPix({ valor, txid, descricao = '' }) {
  const v = Number(valor);
  if (!(v > 0) || v > 999999) throw new Error('Valor do Pix inválido');
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', CHAVE()) + (descricao ? campo('02', limpar(descricao, 40)) : '');
  const corpo = campo('00', '01') + campo('01', '11') + campo('26', conta) + campo('52', '0000') + campo('53', '986')
    + campo('54', v.toFixed(2)) + campo('58', 'BR') + campo('59', NOME()) + campo('60', CIDADE())
    + campo('62', campo('05', String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) + '6304';
  return corpo + crc16(corpo);
}

async function gerarPix(dados) {
  const payload = payloadPix(dados);
  const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
  return { chave: CHAVE(), valor: Number(dados.valor), payload, qr, txid: dados.txid };
}

module.exports = { payloadPix, gerarPix, crc16 };
