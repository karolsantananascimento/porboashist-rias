// Teste do gestor de tráfego (campanhas no Meta) com o Graph API simulado. Rodar: node test/campanhas.js
const assert = require('node:assert/strict');
const C = require('../campanhas');

let falhas = 0; let n = 0;
const ok = (cond, nome) => { n++; if (cond) console.log('  ✓', nome); else { falhas++; console.log('  ✗', nome); } };
const lanca = async (fn, re, nome) => { n++; try { await fn(); falhas++; console.log('  ✗', nome, '(não lançou erro)'); } catch (e) { if (re.test(e.message)) console.log('  ✓', nome); else { falhas++; console.log('  ✗', nome, '->', e.message); } } };

// ---- Meta simulado ----
let calls = []; let falhaCriativo = false; let falhaIG = false; let adsDaCampanha = [{ id: 'a1', status: 'PAUSED' }];
const j = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
global.fetch = async (url, init = {}) => {
  const u = String(url); const m = init.method || 'GET';
  const corpo = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
  calls.push({ u, m, h: init.headers || {}, corpo });
  if (/\/search\?/.test(u) && /adgeolocation/.test(u)) {
    const q = new URL(u).searchParams.get('q');
    if (/recife/i.test(q)) return j({ data: [{ type: 'city', key: '2500', name: 'Recife', region: 'Pernambuco', country_code: 'BR' }] });
    if (/jo[aã]o pessoa/i.test(q)) return j({ data: [{ type: 'city', key: '2600', name: 'João Pessoa', region: 'Paraíba', country_code: 'BR' }] });
    return j({ data: [] });
  }
  if (/\/search\?/.test(u) && /adinterest/.test(u)) { const q = new URL(u).searchParams.get('q'); return /nenhum/i.test(q) ? j({ data: [] }) : j({ data: [{ id: '6003', name: 'Estética facial', audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 }] }); }
  if (/customaudiences/.test(u)) return j({ data: [{ id: '900', name: 'Clientes Disco', subtype: 'CUSTOM' }, { id: '901', name: 'Visitantes do site', subtype: 'WEBSITE' }] });
  if (m === 'GET' && /\/777\/adsets/.test(u)) return j({ data: [{ id: 's1', status: 'PAUSED' }] });
  if (m === 'GET' && /\/777\/ads/.test(u)) return j({ data: adsDaCampanha });
  if (m === 'GET' && /\/777\?/.test(u)) return j({ name: 'Camp', status: 'PAUSED' });
  if (m === 'GET' && /\/12345\?fields=name/.test(u)) return j({ name: 'Página Disco' });
  if (m === 'POST' && /adcreatives$/.test(u)) {
    if (falhaCriativo) return j({ error: { message: 'Imagem inválida', error_user_msg: 'A imagem não atende aos requisitos' } }, 400);
    if (falhaIG && /instagram_user_id/.test(corpo.object_story_spec || '')) return j({ error: { message: 'Invalid parameter', error_user_msg: 'Conta do Instagram sem acesso' } }, 400);
    return j({ id: 'c1' });
  }
  if (m === 'POST' && /\/campaigns$/.test(u)) return j({ id: '777' });
  if (m === 'POST' && /\/adsets$/.test(u)) return j({ id: 's1' });
  if (m === 'POST' && /\/ads$/.test(u)) return j({ id: 'a1' });
  if (m === 'POST') return j({ success: true });
  return j({});
};

const ctx = { token: 'TOKEN-SECRETO', conta: 'act_1', pixel: '', teto: 100, page: '12345', ig: '999', pageNome: 'Página Disco' };
const base = () => ({ nome: 'Disco · Clínicas de estética', objetivo: 'OUTCOME_TRAFFIC', orcamento_diario_brl: 50, texto_principal: 'Texto do anúncio', imagem_url: 'https://exemplo.com/a.jpg', url_destino: 'https://disco.com/lp', localizacoes: ['Recife', 'João Pessoa, Paraíba'], raio_km: 25, interesses: ['Estética facial'], publicos_personalizados: ['Clientes Disco'], publicos_excluidos: ['Visitantes do site'], idade_min: 25, idade_max: 55, genero: 'feminino' });

(async () => {
  console.log('Rascunho');
  const nz = C.normalizar({ nome: ' X ', objetivo: 'INVALIDO', orcamento_diario_brl: '12,5', cta: 'HACK', genero: 'xx', destino: 'foo', qualquer: 'coisa', localizacoes: ['Recife', '', 7], idade_min: 'abc' });
  ok(nz.nome === 'X' && !nz.objetivo && nz.orcamento_diario_brl === 12.5 && !nz.cta && !nz.genero && !nz.destino && !('qualquer' in nz) && !('idade_min' in nz) && nz.localizacoes.length === 2, 'normalizar descarta o que é inválido e converte números');
  ok(C.faltando({ nome: 'x' }).includes('orçamento diário') && C.faltando(base()).length === 0, 'faltando lista só o que falta');

  console.log('Validação');
  ok(C.validar(base(), ctx) === '', 'rascunho completo passa');
  ok(/teto de R\$ 100/.test(C.validar({ ...base(), orcamento_diario_brl: 500 }, ctx)), 'bloqueia orçamento acima do teto');
  ok(/imagem/.test(C.validar({ ...base(), imagem_url: 'http://x.com/a.jpg' }, ctx)), 'imagem precisa ser https');
  ok(/pixel/i.test(C.validar({ ...base(), objetivo: 'OUTCOME_LEADS' }, ctx)), 'Leads no site exige pixel');
  ok(C.validar({ ...base(), objetivo: 'OUTCOME_LEADS', destino: 'whatsapp' }, ctx) === '', 'Leads com WhatsApp dispensa pixel');
  ok(/WhatsApp só funciona com o objetivo Leads/.test(C.validar({ ...base(), destino: 'whatsapp' }, ctx)), 'WhatsApp só com Leads');
  ok(/link de destino/.test(C.validar({ ...base(), url_destino: '' }, ctx)), 'site exige link');
  ok(/página do Facebook/.test(C.validar(base(), { ...ctx, page: '' })), 'exige página do Facebook');
  ok(/Instagram/.test(C.validar({ ...base(), objetivo: 'OUTCOME_ENGAGEMENT', destino: 'instagram_direct' }, { ...ctx, ig: '' })), 'mensagens no Instagram exigem Instagram vinculado');
  ok(/idade/i.test(C.validar({ ...base(), idade_min: 60, idade_max: 30 }, ctx)), 'faixa de idade invertida');
  ok(/raio/.test(C.validar({ ...base(), raio_km: 5 }, ctx)), 'raio fora de 17-80');

  console.log('Conferir (só leitura)');
  calls = [];
  const cf = await C.conferir(ctx, base());
  ok(calls.every((c) => c.m === 'GET'), 'conferir só faz leituras no Meta');
  ok(cf.avisos.some((a) => /Recife.*cidade \+ 25 km/.test(a)) && cf.avisos.some((a) => /Página Disco/.test(a)) && cf.avisos.some((a) => /Exclui: Visitantes/.test(a)), 'mostra local, página e públicos resolvidos');

  console.log('Subir campanha (tudo pausado)');
  calls = [];
  const r = await C.subirCampanha(ctx, base());
  const posts = calls.filter((c) => c.m === 'POST');
  ok(posts.map((p) => p.u.split('/').pop()).join(',') === 'adcreatives,campaigns,adsets,ads', 'ordem: criativo -> campanha -> conjunto -> anúncio');
  ok(posts.filter((p) => /campaigns|adsets|\/ads$/.test(p.u)).every((p) => p.corpo.status === 'PAUSED'), 'campanha, conjunto e anúncio nascem PAUSADOS');
  ok(!posts.some((p) => p.corpo.status === 'ACTIVE'), 'nada é ativado na criação');
  ok(posts.find((p) => /campaigns$/.test(p.u)).corpo.daily_budget === '5000', 'orçamento em centavos (R$ 50 -> 5000)');
  ok(calls.every((c) => c.h.authorization === 'Bearer TOKEN-SECRETO' && !c.u.includes('TOKEN-SECRETO') && !JSON.stringify(c.corpo).includes('TOKEN-SECRETO')), 'o token vai só no cabeçalho, nunca na URL nem no corpo');
  const tg = JSON.parse(posts.find((p) => /adsets$/.test(p.u)).corpo.targeting);
  ok(tg.geo_locations.cities.length === 2 && tg.geo_locations.cities[0].key === '2500' && tg.geo_locations.cities[0].radius === 25 && !tg.geo_locations.countries, 'público: cidades exatas com raio (não o país inteiro)');
  ok(tg.age_min === 25 && tg.age_max === 55 && tg.genders[0] === 2 && tg.flexible_spec[0].interests[0].id === '6003', 'idade, gênero e interesses');
  ok(tg.custom_audiences[0].id === '900' && tg.excluded_custom_audiences[0].id === '901', 'público personalizado incluído e excluído');
  ok(posts.find((p) => /adsets$/.test(p.u)).corpo.optimization_goal === 'LINK_CLICKS', 'meta de otimização do objetivo Tráfego');
  ok(r.campanha_id === '777' && r.anuncio_id === 'a1' && r.instagram_vinculado === true, 'devolve os IDs e o Instagram vinculado');
  ok(JSON.parse(posts[0].corpo.object_story_spec).instagram_user_id === '999', 'criativo leva o Instagram vinculado');

  console.log('Falhas parciais');
  calls = []; falhaCriativo = true;
  await lanca(() => C.subirCampanha(ctx, base()), /Falhou na etapa "criativo".*imagem não atende/, 'criativo recusado: erro claro');
  ok(!calls.some((c) => /\/campaigns$|\/adsets$/.test(c.u)), 'com o criativo recusado, nem campanha nem conjunto são criados');
  falhaCriativo = false;
  calls = []; falhaIG = true;
  const r2 = await C.subirCampanha(ctx, base());
  ok(r2.instagram_vinculado === false && calls.filter((c) => /adcreatives$/.test(c.u)).length === 2, 'sem acesso ao Instagram: refaz o criativo só com a página');
  falhaIG = false;
  await lanca(() => C.subirCampanha(ctx, { ...base(), localizacoes: ['Cidade Que Nao Existe'] }), /Não encontrei a localização/, 'localização inexistente falha antes de criar qualquer coisa');
  await lanca(() => C.subirCampanha(ctx, { ...base(), interesses: ['nenhum interesse'] }), /Não encontrei o interesse/, 'interesse inexistente falha antes de criar qualquer coisa');
  await lanca(() => C.subirCampanha(ctx, { ...base(), orcamento_diario_brl: 999 }), /teto/, 'subirCampanha revalida o teto de orçamento');

  console.log('Destinos');
  calls = [];
  await C.subirCampanha(ctx, { ...base(), objetivo: 'OUTCOME_ENGAGEMENT', destino: 'post', localizacoes: undefined, paises: ['BR'] });
  const adsetPost = JSON.parse(JSON.stringify(calls.filter((c) => /adsets$/.test(c.u)).pop().corpo));
  ok(adsetPost.destination_type === 'ON_POST' && adsetPost.optimization_goal === 'POST_ENGAGEMENT' && JSON.parse(adsetPost.targeting).geo_locations.countries[0] === 'BR', 'engajamento no post, público no país');
  calls = [];
  await C.subirCampanha(ctx, { ...base(), objetivo: 'OUTCOME_LEADS', destino: 'whatsapp' });
  ok(calls.filter((c) => /adsets$/.test(c.u)).pop().corpo.destination_type === 'WHATSAPP', 'Leads com WhatsApp');
  calls = [];
  await C.subirCampanha(ctx, { ...base(), objetivo: 'OUTCOME_LEADS', pixel_id: 'PX1' });
  ok(JSON.parse(calls.filter((c) => /adsets$/.test(c.u)).pop().corpo.promoted_object).pixel_id === 'PX1', 'Leads no site usa o pixel');
  calls = [];
  await C.subirCampanha(ctx, { ...base(), imagem_url: undefined, imagens_urls: ['https://x.com/1.jpg', 'https://x.com/2.jpg'] });
  ok(JSON.parse(calls.find((c) => /adcreatives$/.test(c.u)).corpo.object_story_spec).link_data.child_attachments.length === 2, 'carrossel com 2 cartões');

  console.log('Ativar e pausar');
  calls = []; adsDaCampanha = [];
  await lanca(() => C.ativarEstrutura(ctx, '777'), /não tem nenhum anúncio/, 'não ativa campanha sem anúncio');
  ok(!calls.some((c) => c.m === 'POST'), 'e não escreve nada ao recusar');
  adsDaCampanha = [{ id: 'a1', status: 'PAUSED' }, { id: 'a2', status: 'ACTIVE' }];
  calls = [];
  const at = await C.ativarEstrutura(ctx, '777');
  ok(at.anuncios.length === 1 && at.anuncios[0] === 'a1' && at.conjuntos[0] === 's1', 'ativa campanha e só o que estava pausado');
  calls = []; await C.pausar(ctx, '777');
  ok(calls[0].corpo.status === 'PAUSED', 'pausar envia PAUSED');
  ok(!calls.some((c) => c.m === 'DELETE'), 'nenhuma exclusão');

  console.log(`\n${n - falhas}/${n} verificações passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
