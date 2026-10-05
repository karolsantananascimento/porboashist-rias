// Leitura da planilha "Experiências de Datas Promocionais" (CSV exportado do Google Sheets)

function parseCSV(texto) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const limpa = (s) => (s || '').replace(/\r/g, '').trim();

// Converte as linhas da planilha em experiências agrupadas por seção (mês/data)
function lerExperiencias(texto) {
  const linhas = parseCSV(texto);
  const inicio = linhas.findIndex((l) => /^data\s*\/\s*per[ií]odo/i.test(limpa(l[0])));
  if (inicio < 0) throw new Error('Cabeçalho "Data / Período" não encontrado na planilha');
  const out = [];
  let secao = null;
  let ordem = 0;
  for (const l of linhas.slice(inicio + 1)) {
    const cel = l.map(limpa);
    const preenchidas = cel.filter(Boolean);
    if (!preenchidas.length) continue;
    if (/^status:|^resorts:/i.test(cel[0])) continue; // legenda no fim da planilha
    if (preenchidas.length === 1 && cel[0].includes('|')) { secao = cel[0].replace(/\s+\|\s+/, ' | '); continue; }
    if (!cel[1] || !cel[2]) continue;
    out.push({
      secao, ordem: ordem++, periodo: cel[0], nome: cel[1], resort: cel[2],
      descricao: cel[3] || null, horario: cel[4] || null, local: cel[5] || null,
      incluso: cel[6] || null, preco: cel[7] || null, observacoes: cel[8] || null,
      status: cel[9] || 'Pendente',
    });
  }
  return out;
}

// Monta a URL de exportação em CSV a partir do link da planilha
function urlExportacao(url) {
  const id = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!id) return null;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv${gid ? '&gid=' + gid : ''}`;
}

module.exports = { parseCSV, lerExperiencias, urlExportacao };
