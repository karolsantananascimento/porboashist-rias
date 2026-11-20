// Teste do SaaS do gestor de tráfego: sobe o server.js REAL (com Postgres real) e simula Meta, Google, Claude e Stripe.
// Rodar com um Postgres local: PGBASE=postgresql://postgres@localhost:5433 node test/saas.js
// (cria e apaga um banco próprio, "pbh_saas_teste").
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const BASE = process.env.PGBASE;
if (!BASE) { console.error('Defina PGBASE (ex.: postgresql://postgres@localhost:5433)'); process.exit(2); }
const DB = 'pbh_saas_teste';
const PORTA = 3917;
const LOG = '/tmp/saas-mock-calls.jsonl';
const WH = 'whsec_teste';
const TOKEN_ADMIN = 'TOKEN-DO-ADMIN-NAO-PODE-VAZAR-000000';

let n = 0; let falhas = 0;
const ok = (c, nome) => { n++; if (c) console.log('  ✓', nome); else { falhas++; console.log('  ✗', nome); } };

// ---- cliente HTTP com cookie por usuário ----
const cpfDe = (n) => { const d = String(100000000 + n * 7919).slice(0, 9).split('').map(Number); for (const k of [9, 10]) { let t = 0; for (let i = 0; i < k; i++) t += d[i] * (k + 1 - i); const r = (t * 10) % 11; d.push(r === 10 ? 0 : r); } return d.join(''); };
const jar = {};
async function req(quem, metodo, caminho, corpo, extra = {}) {
  const headers = { 'content-type': 'application/json', ...(jar[quem] ? { cookie: jar[quem] } : {}), ...(extra.headers || {}) };
  const r = await fetch(`http://127.0.0.1:${PORTA}${caminho}`, { method: metodo, headers, body: extra.bruto ?? (corpo ? JSON.stringify(corpo) : undefined), redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && quem) jar[quem] = sc.split(';')[0];
  const t = await r.text(); let c = {}; try { c = t ? JSON.parse(t) : {}; } catch { c = { raw: t }; }
  return { status: r.status, corpo: c, loc: r.headers.get('location'), sc };
}
const chamadas = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const limparLog = () => fs.writeFileSync(LOG, '');
const assinar = (corpo, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', WH).update(`${t}.${corpo}`).digest('hex')}`;
const webhook = (ev, sig) => { const corpo = JSON.stringify(ev); return req(null, 'POST', '/api/saas/webhook', null, { bruto: corpo, headers: { 'stripe-signature': sig || assinar(corpo) } }); };

(async () => {
  const adm = new Client({ connectionString: `${BASE}/postgres` }); await adm.connect();
  await adm.query(`DROP DATABASE IF EXISTS ${DB}`); await adm.query(`CREATE DATABASE ${DB}`);
  const db = new Client({ connectionString: `${BASE}/${DB}` });

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORTA), DATABASE_URL: `${BASE}/${DB}`, NODE_ENV: 'test', MOCK_LOG: LOG,
      NODE_OPTIONS: `--require ${path.join(__dirname, 'saas-mock.js')}`,
      ACESSOS_KEY: Buffer.alloc(32, 9).toString('base64'), SESSION_SECRET: 'segredo-de-teste', ADMIN_EMAIL: 'admin@exemplo.com', SUPER_ADMIN_EMAIL: 'admin@exemplo.com', ADMIN_PASSWORD: 'senhaadmin123',
      ANTHROPIC_API_KEY: 'chave-claude-admin', META_ADS_TOKEN: TOKEN_ADMIN, META_AD_ACCOUNT_ID: 'act_999', META_PAGE_ID: '999',
      STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: WH, SAAS_IA_MES: '3', SAAS_CADASTROS_HORA: '100', SAAS_PRECO_TEXTO: 'R$ 97/mês',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = ''; srv.stdout.on('data', (d) => (saida += d)); srv.stderr.on('data', (d) => (saida += d));
  limparLog();
  const fim = async (cod) => { srv.kill(); await db.end().catch(() => {}); await new Promise((r) => setTimeout(r, 300)); await adm.query(`DROP DATABASE IF EXISTS ${DB}`).catch(() => {}); await adm.end(); process.exit(cod); };
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORTA}/healthz`); if (r.ok) break; } catch { /* aguarda */ } await new Promise((r) => setTimeout(r, 250)); if (i === 59) { console.error('Servidor não subiu:\n' + saida); await fim(1); } }
  await db.connect();

  try {
    console.log('Cadastro');
    let r = await req(null, 'GET', '/api/saas/publico');
    ok(r.status === 200 && r.corpo.cobranca === true && r.corpo.preco === 'R$ 97/mês', 'página pública mostra preço e se a cobrança está ligada');
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', sobrenome: 'Silva', cpf: cpfDe(1), email: 'ana@exemplo.com', senha: 'abc', aceite: true });
    ok(r.status === 400 && /8 caracteres/.test(r.corpo.erro), 'senha curta é recusada');
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', sobrenome: 'Silva', cpf: cpfDe(2), email: 'ana@exemplo.com', senha: 'senha-forte-1' });
    ok(r.status === 400 && /termos/.test(r.corpo.erro), 'sem aceitar os termos não cria conta');
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', sobrenome: 'Silva', cpf: cpfDe(3), empresa: 'Clínica Ana', email: 'ana@exemplo.com', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 200 && jar.a, 'cadastro cria a conta e já entra');
    r = await req('b', 'POST', '/api/saas/cadastro', { nome: 'Bruno', sobrenome: 'Silva', cpf: cpfDe(4), empresa: 'Loja Bruno', email: 'bruno@exemplo.com', senha: 'senha-forte-2', aceite: true });
    ok(r.status === 200, 'segundo assinante criado');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Ana', sobrenome: 'Silva', cpf: cpfDe(3), email: 'ANA@exemplo.com', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 409, 'e-mail repetido (mesmo em maiúsculas) é recusado');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Zé', email: 'ze@exemplo.com', cpf: cpfDe(40), senha: 'senha-forte-1', aceite: true });
    ok(r.status === 400 && /sobrenome/i.test(r.corpo.erro), 'sobrenome é obrigatório');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Zé', sobrenome: 'Lima', email: 'ze@exemplo.com', cpf: '111.111.111-11', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 400 && /CPF/.test(r.corpo.erro), 'CPF com dígitos repetidos é recusado');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Zé', sobrenome: 'Lima', email: 'ze@exemplo.com', cpf: cpfDe(40).slice(0, 10) + '0', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 400 && /CPF/.test(r.corpo.erro), 'CPF com dígito verificador errado é recusado');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Zé', sobrenome: 'Lima', email: 'ze@exemplo.com', cpf: cpfDe(3), senha: 'senha-forte-1', aceite: true });
    ok(r.status === 409 && /CPF/.test(r.corpo.erro), 'o mesmo CPF não abre uma segunda conta');

    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.status === 200 && r.corpo.conta.status === 'trial' && r.corpo.conta.situacao.ativa && r.corpo.conta.situacao.dias_trial >= 6, 'conta nova começa em período de teste');
    const { rows: [u] } = await db.query(`SELECT papel, aceite_termos_em FROM users WHERE email='ana@exemplo.com'`);
    ok(u.papel === 'assinante' && u.aceite_termos_em, 'papel assinante e aceite dos termos registrado');
    r = await req(null, 'POST', '/api/login', { email: 'ana@exemplo.com', senha: 'senha-forte-1' });
    ok(r.status === 200 && r.corpo.usuario.papel === 'assinante', 'login normal funciona para assinante');

    console.log('Isolamento do sistema interno');
    for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/users'], ['GET', '/api/tasks'], ['GET', '/api/backup'], ['GET', '/api/projects'], ['POST', '/api/restaurar'], ['GET', '/api/meta/contas?client_id=1'], ['GET', '/api/integracoes']]) {
      r = await req('a', m, p, m === 'POST' ? {} : undefined);
      ok(r.status === 403, `assinante não acessa ${m} ${p} (${r.status})`);
    }
    r = await req('a', 'GET', '/oauth/meta/iniciar?client_id=1');
    ok(r.status === 302 && /\/assinante/.test(r.loc), 'assinante não entra nas rotas de OAuth do sistema interno');
    r = await req('a', 'GET', '/api/saas/admin/assinantes');
    ok(r.status === 403, 'assinante não acessa o painel de administração dos assinantes');
    r = await req(null, 'GET', '/api/saas/chaves');
    ok(r.status === 401, 'sem login nada do SaaS abre');

    console.log('Administrador');
    r = await req('adm', 'POST', '/api/login', { email: 'admin@exemplo.com', senha: 'senhaadmin123' });
    ok(r.status === 200 && r.corpo.usuario.papel === 'admin', 'administrador entra');
    r = await req('adm', 'GET', '/api/users');
    ok(r.corpo.every((x) => x.papel !== 'assinante') && r.corpo.length >= 1, 'assinantes não aparecem na lista de usuários da equipe');
    const { rows: [ub] } = await db.query(`SELECT id FROM users WHERE email='bruno@exemplo.com'`);
    r = await req('adm', 'PUT', `/api/users/${ub.id}`, { papel: 'admin' });
    ok(r.status === 400, 'não dá para promover um assinante a admin pela tela da equipe');
    r = await req('adm', 'DELETE', `/api/users/${ub.id}`);
    ok(r.status === 400, 'não dá para excluir assinante pela tela da equipe');
    // ---- administrador absoluto ----
    r = await req('adm', 'POST', '/api/users', { email: 'segundo@exemplo.com', nome: 'Segundo', papel: 'admin' });
    ok(r.status === 200 && r.corpo.usuario.papel === 'admin', 'o administrador absoluto cria outro administrador');
    const tokSeg = decodeURIComponent((/convite=([^&\s]+)/.exec(r.corpo.link) || [])[1] || ''); const idSeg = r.corpo.usuario.id;
    r = await req('seg', 'POST', '/api/convite', { token: tokSeg, senha: 'senhasegundo123', nome: 'Segundo' }); ok(r.status === 200, 'segundo administrador define a senha');
    r = await req('adm', 'POST', '/api/users', { email: 'membro1@exemplo.com', nome: 'Membro', papel: 'membro' });
    const idMem = r.corpo.usuario.id; ok(r.status === 200, 'cria membro da equipe');
    r = await req('seg', 'POST', '/api/users', { email: 'outro@exemplo.com', papel: 'admin' }); ok(r.status === 403 && /absoluto/.test(r.corpo.erro), 'outro administrador não cria administrador');
    r = await req('seg', 'PUT', `/api/users/${idMem}`, { papel: 'admin' }); ok(r.status === 403, 'outro administrador não promove ninguém');
    r = await req('seg', 'POST', '/api/users', { email: 'membro2@exemplo.com', papel: 'membro' }); ok(r.status === 200, 'outro administrador ainda cria membros');
    r = await req('seg', 'PUT', `/api/users/${idMem}`, { nome: 'Membro Renomeado' }); ok(r.status === 200, 'outro administrador ainda edita membros');
    const { rows: [sup] } = await db.query(`SELECT id FROM users WHERE email='admin@exemplo.com'`);
    r = await req('seg', 'PUT', `/api/users/${sup.id}`, { papel: 'membro' }); ok(r.status === 403, 'ninguém rebaixa o administrador absoluto');
    r = await req('seg', 'PUT', `/api/users/${sup.id}`, { ativo: false }); ok(r.status === 403, 'ninguém desativa o administrador absoluto');
    r = await req('seg', 'DELETE', `/api/users/${sup.id}`); ok(r.status === 403, 'ninguém exclui o administrador absoluto');
    r = await req('adm', 'PUT', `/api/users/${sup.id}`, { papel: 'membro' }); ok(r.status === 403, 'nem o próprio administrador absoluto se rebaixa');
    r = await req('seg', 'DELETE', `/api/users/${idSeg}`); ok(r.status === 400, 'não exclui a si mesmo');
    r = await req('adm', 'PUT', `/api/users/${idSeg}`, { papel: 'membro' }); ok(r.status === 200, 'o administrador absoluto rebaixa outro administrador');
    r = await req('adm', 'GET', '/api/saas/chaves');
    ok(r.status === 403, 'rotas do assinante não abrem para o administrador');
    r = await req('adm', 'GET', '/api/saas/admin/assinantes');
    ok(r.status === 200 && r.corpo.assinantes.length === 2, 'administrador lista os assinantes');
    const idA = r.corpo.assinantes.find((x) => x.email === 'ana@exemplo.com').id; const idB = r.corpo.assinantes.find((x) => x.email === 'bruno@exemplo.com').id;

    console.log('Chaves de API');
    r = await req('a', 'GET', '/api/saas/chaves');
    const campos = r.corpo.grupos.flatMap((g) => g.campos);
    ok(r.status === 200 && r.corpo.grupos.length === 3 && campos.every((c) => c.ajuda && c.ajuda.passos.length), 'todo campo tem o "?" com passo a passo');
    ok(campos.every((c) => c.definido === false), 'assinante novo não herda as chaves do administrador (mesmo com variável de ambiente)');
    r = await req('a', 'PUT', '/api/saas/chaves', { chave: 'ANTHROPIC_API_KEY', valor: 'x'.repeat(30) });
    ok(r.status === 400, 'só as chaves do catálogo podem ser gravadas');
    r = await req('a', 'PUT', '/api/saas/chaves', { chave: 'META_AD_ACCOUNT_ID', valor: 'abc' });
    ok(r.status === 400 && /números/.test(r.corpo.erro), 'ID da conta inválido é explicado');
    r = await req('a', 'PUT', '/api/saas/chaves', { chave: 'META_ADS_TOKEN', valor: 'curto' });
    ok(r.status === 400, 'token curto demais é recusado');
    const tokA = 'EAAB-token-da-ana-1234567890abcdef';
    for (const [k, v] of [['META_ADS_TOKEN', tokA], ['META_AD_ACCOUNT_ID', '1111111111'], ['META_PAGE_ID', '55555']]) {
      r = await req('a', 'PUT', '/api/saas/chaves', { chave: k, valor: v }); ok(r.status === 200, `salva ${k}`);
    }
    r = await req('a', 'GET', '/api/saas/chaves');
    const tk = r.corpo.grupos.flatMap((g) => g.campos).find((c) => c.chave === 'META_ADS_TOKEN');
    ok(tk.definido && tk.previa === '••••cdef' && !JSON.stringify(r.corpo).includes(tokA), 'a tela só recebe os 4 últimos caracteres, nunca o token inteiro');
    ok(r.corpo.grupos[0].campos.find((c) => c.chave === 'META_AD_ACCOUNT_ID').previa === 'act_1111111111', 'ID da conta ganha o prefixo act_');
    const { rows: gravadas } = await db.query(`SELECT valor_enc FROM configuracoes WHERE client_id=$1`, [1000000 + idA]);
    ok(gravadas.length === 3 && gravadas.every((x) => x.valor_enc.startsWith('v1:') && !x.valor_enc.includes('EAAB')), 'no banco as chaves ficam criptografadas');
    r = await req('b', 'GET', '/api/saas/chaves');
    ok(r.corpo.grupos.flatMap((g) => g.campos).every((c) => !c.definido), 'o outro assinante não vê as chaves da Ana');

    console.log('Teste de conexão e uso do token certo');
    limparLog();
    r = await req('b', 'POST', '/api/saas/testar/meta');
    ok(r.corpo.ok === false && /não está configurado/.test(r.corpo.erro), 'sem chave própria o teste falha, mesmo havendo token do administrador no ambiente');
    ok(chamadas().filter((c) => c.alvo === 'meta').length === 0, 'nenhuma chamada ao Meta foi feita para quem não tem chave');
    r = await req('a', 'POST', '/api/saas/testar/meta');
    ok(r.corpo.ok === true && r.corpo.conta === 'Conta do Assinante' && r.corpo.pagina === 'Página do Assinante', 'teste do Meta mostra conta e página');
    ok(chamadas().filter((c) => c.alvo === 'meta').every((c) => c.auth === `Bearer ${tokA}`), 'o Meta recebeu só o token da própria Ana');

    console.log('Campanha: IA → conferir → subir pausada → ativar → pausar');
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'curto' });
    ok(r.status === 400, 'pedido curto demais não gasta a cota de IA');
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Clínica de estética em Recife, R$ 40 por dia, mulheres de 25 a 55 anos, levar para a página de agendamento.' });
    const camp = r.corpo.campanha;
    ok(r.status === 200 && camp.status === 'rascunho' && camp.spec.nome === 'Clínica · Tráfego' && !('campo_inventado' in camp.spec), 'a IA monta o rascunho só com campos conhecidos');
    r = await req('b', 'GET', `/api/saas/campanhas`);
    ok(r.corpo.length === 0, 'o outro assinante não vê a campanha da Ana');
    r = await req('b', 'POST', `/api/saas/campanhas/${camp.id}/conferir`);
    ok(r.status === 404, 'nem consegue conferir a campanha dela (404)');
    r = await req('b', 'POST', `/api/saas/campanhas/${camp.id}/subir`, { confirmado: true });
    ok(r.status === 404, 'nem subir a campanha dela (404)');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/conferir`);
    ok(r.corpo.ok === true && r.corpo.avisos.length >= 3, 'conferir passa e só lê');
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/subir`, {});
    ok(r.status === 400 && chamadas().length === 0, 'sem confirmação não cria nada');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/subir`, { confirmado: true });
    ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada' && r.corpo.campanha.ids.campanha_id === 'camp1', 'sobe pausada e guarda os IDs');
    const escritas = chamadas().filter((c) => c.alvo === 'meta' && c.m === 'POST');
    ok(escritas.length === 4 && escritas.every((c) => c.auth === `Bearer ${tokA}`), 'criativo, campanha, conjunto e anúncio, todos com o token da Ana');
    ok(escritas.filter((c) => /status=PAUSED/.test(c.body)).length >= 3 && !escritas.some((c) => /status=ACTIVE/.test(c.body)), 'tudo criado PAUSADO, nada ativo');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/ativar`, {});
    ok(r.status === 400, 'ativar exige confirmação');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/ativar`, { confirmado: true });
    ok(r.status === 200 && r.corpo.campanha.status === 'ativada', 'ativa com confirmação');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/pausar`, {});
    ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada', 'pausa de volta');
    r = await req('a', 'DELETE', `/api/saas/campanhas/${camp.id}`);
    ok(r.status === 409, 'campanha que já existe no Meta não sai da lista pelo sistema');


    console.log('Criativos enviados pelo assinante');
    // PNG 400x400 mínimo válido (cabeçalho) e JPEG com SOF 300x200
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 1, 0x90, 0, 0, 1, 0x90, 8, 6, 0, 0, 0]), Buffer.alloc(20)]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 0x2c, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(30)]);
    const envia = (quem, buf, tipo = 'image/png', nome = 'Promoção ação.png') => req(quem, 'POST', '/api/saas/midias', null, { bruto: buf, headers: { 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) } });
    r = await envia('a', Buffer.from('isso não é imagem'), 'image/png');
    ok(r.status === 400 && /JPG\/PNG/.test(r.corpo.erro), 'arquivo que não é imagem é recusado');
    r = await envia('a', Buffer.alloc(0));
    ok(r.status === 400, 'envio vazio é recusado');
    r = await envia(null, png);
    ok(r.status === 401, 'sem login não envia');
    r = await envia('a', png);
    const m1 = r.corpo.midia;
    ok(r.status === 200 && m1.mime === 'image/png' && m1.largura === 400 && m1.altura === 400 && m1.token === `midia:${m1.id}` && m1.nome === 'Promoção ação.png', 'PNG aceito com dimensões e nome');
    r = await envia('a', jpg, 'image/jpeg', 'foto.jpg');
    const m2 = r.corpo.midia;
    ok(r.status === 200 && m2.mime === 'image/jpeg' && m2.largura === 300 && m2.altura === 200, 'JPEG aceito com dimensões lidas');
    r = await envia('a', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 50, 0, 0, 0, 50]), Buffer.alloc(20)]));
    ok(r.status === 400 && /pequena/.test(r.corpo.erro), 'imagem pequena demais é recusada');
    r = await req('a', 'GET', '/api/saas/midias');
    ok(r.corpo.midias.length === 2, 'lista as imagens do cliente');
    r = await req('b', 'GET', '/api/saas/midias');
    ok(r.corpo.midias.length === 0, 'o outro assinante não vê as imagens da Ana');
    r = await req('b', 'GET', `/api/saas/midias/${m1.id}/arquivo`);
    ok(r.status === 404, 'nem baixa a imagem dela (404)');
    r = await req('b', 'DELETE', `/api/saas/midias/${m1.id}`);
    ok(r.status === 404, 'nem exclui a imagem dela (404)');
    { const f = await fetch(`http://127.0.0.1:${PORTA}/api/saas/midias/${m1.id}/arquivo`, { headers: { cookie: jar.a } });
      ok(f.status === 200 && f.headers.get('content-type') === 'image/png' && Buffer.compare(Buffer.from(await f.arrayBuffer()), png) === 0, 'a Ana baixa a própria imagem intacta'); }

    const base = { ...camp.spec }; delete base.imagem_url; delete base.imagens_urls;
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Com imagem enviada', imagem_url: m1.token } });
    const cImg = r.corpo.campanha;
    ok(r.status === 200 && cImg.spec.imagem_url === m1.token && !(cImg.pendencias || []).some((x) => /imagem/.test(x)), 'rascunho aceita a imagem enviada e não pede link');
    r = await req('a', 'DELETE', `/api/saas/midias/${m1.id}`);
    ok(r.status === 409, 'imagem usada em rascunho não pode ser excluída');
    r = await req('a', 'POST', `/api/saas/campanhas/${cImg.id}/conferir`);
    ok(r.corpo.ok === true && r.corpo.avisos.some((x) => /Imagens enviadas/.test(x)), 'conferir reconhece a imagem enviada');
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${cImg.id}/subir`, { confirmado: true });
    ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada', 'sobe campanha com a imagem enviada');
    { const esc = chamadas().filter((c) => c.alvo === 'meta' && c.m === 'POST');
      const img = esc.find((c) => /adimages$/.test(c.u.split('?')[0]));
      const cr = esc.find((c) => /adcreatives$/.test(c.u.split('?')[0]));
      ok(img && /bytes=/.test(img.body) && img.auth === `Bearer ${tokA}`, 'a imagem sobe ao Meta (adimages) com o token da Ana');
      ok(cr && /image_hash/.test(decodeURIComponent(cr.body)) && !/picture/.test(decodeURIComponent(cr.body)), 'o criativo usa image_hash em vez de link');
      ok(esc.length === 5 && !esc.some((c) => /status=ACTIVE/.test(c.body)), 'imagem + criativo + campanha + conjunto + anúncio, nada ativo'); }
    // carrossel misturando imagem enviada e link
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Carrossel misto', imagens_urls: [m2.token, 'https://exemplo.com/b.jpg'] } });
    const cCar = r.corpo.campanha;
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${cCar.id}/subir`, { confirmado: true });
    { const cr = chamadas().find((c) => c.alvo === 'meta' && /adcreatives$/.test(c.u.split('?')[0]));
      const dec = cr ? decodeURIComponent(cr.body) : '';
      ok(r.status === 200 && /image_hash/.test(dec) && /exemplo\.com\/b\.jpg/.test(dec), 'carrossel mistura imagem enviada (hash) e link (picture)'); }
    // ----- vídeo -----
    const caixa = (tipo, ...partes) => { const c = Buffer.concat(partes); const h = Buffer.alloc(8); h.writeUInt32BE(8 + c.length, 0); h.write(tipo, 4, 'latin1'); return Buffer.concat([h, c]); };
    const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(5000, 16);
    const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(1080 * 65536, 76); tkhd.writeUInt32BE(1920 * 65536, 80);
    const ftyp = caixa('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isommp41'));
    const mp4 = Buffer.concat([ftyp, caixa('moov', caixa('mvhd', mvhd), caixa('trak', caixa('tkhd', tkhd))), caixa('mdat', Buffer.alloc(2000, 7))]);
    r = await envia('a', Buffer.concat([ftyp, caixa('mdat', Buffer.alloc(500))]), 'video/mp4', 'cortado.mp4');
    ok(r.status === 400 && /incompleto|corrompido/.test(r.corpo.erro), 'vídeo sem índice (cortado) é recusado');
    r = await envia('a', Buffer.concat([png.subarray(0, 33), Buffer.alloc(9 * 1024 * 1024)]), 'image/png', 'enorme.png');
    ok(r.status === 400 && /8 MB/.test(r.corpo.erro), 'imagem acima de 8 MB é recusada');
    r = await envia('a', mp4, 'video/mp4', 'Reels do verão.mp4');
    const v1 = r.corpo.midia;
    ok(r.status === 200 && v1.tipo === 'video' && v1.mime === 'video/mp4' && v1.duracao === 5 && v1.largura === 1080 && v1.altura === 1920 && v1.token === `midia:${v1.id}`, 'MP4 aceito com duração e dimensões lidas');
    r = await req('a', 'GET', '/api/saas/midias');
    ok(r.corpo.midias.some((x) => x.id === v1.id && x.tipo === 'video') && r.corpo.midias.some((x) => x.tipo === 'imagem'), 'a biblioteca lista imagens e vídeos com o tipo');
    { const f = await fetch(`http://127.0.0.1:${PORTA}/api/saas/midias/${v1.id}/arquivo`, { headers: { cookie: jar.a, range: 'bytes=0-9' } });
      const pedaco = Buffer.from(await f.arrayBuffer());
      ok(f.status === 206 && pedaco.length === 10 && f.headers.get('content-range') === `bytes 0-9/${mp4.length}` && Buffer.compare(pedaco, mp4.subarray(0, 10)) === 0, 'o vídeo é entregue em partes (Range) para tocar e avançar');
      const g = await fetch(`http://127.0.0.1:${PORTA}/api/saas/midias/${v1.id}/arquivo?cliente=${encodeURIComponent(1e9)}`, { headers: { cookie: jar.a } });
      ok(g.status === 404, 'cliente informado na URL que não é da conta não abre o arquivo'); }
    r = await req('b', 'GET', `/api/saas/midias/${v1.id}/arquivo`);
    ok(r.status === 404, 'outro assinante não baixa o vídeo da Ana');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Anúncio em vídeo', imagem_url: v1.token } });
    const cVid = r.corpo.campanha;
    r = await req('a', 'POST', `/api/saas/campanhas/${cVid.id}/conferir`);
    ok(r.corpo.ok === true && r.corpo.avisos.some((x) => /Vídeos enviados/.test(x)) && /vídeo/.test(r.corpo.resumo), 'conferir reconhece o vídeo enviado');
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${cVid.id}/subir`, { confirmado: true });
    ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada', 'sobe campanha com vídeo enviado');
    { const esc = chamadas().filter((c) => c.alvo === 'meta' && c.m === 'POST');
      const vd = esc.find((c) => /advideos$/.test(c.u.split('?')[0]));
      const cr = esc.find((c) => /adcreatives$/.test(c.u.split('?')[0]));
      const dec = cr ? decodeURIComponent(cr.body) : '';
      ok(vd && vd.auth === `Bearer ${tokA}`, 'o vídeo sobe ao Meta (advideos) com o token da Ana');
      ok(/video_data/.test(dec) && /"video_id":"vid\d+"/.test(dec) && /thumb\.jpg/.test(dec) && !/link_data/.test(dec), 'o criativo é video_data com video_id e capa do Meta');
      ok(esc.length === 5 && !esc.some((c) => /status=ACTIVE/.test(c.body)), 'vídeo + criativo + campanha + conjunto + anúncio, nada ativo'); }
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Mesmo vídeo de novo', imagem_url: v1.token } });
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${r.corpo.campanha.id}/subir`, { confirmado: true });
    ok(r.status === 200 && !chamadas().some((c) => /advideos/.test(c.u || '')), 'vídeo já enviado a esta conta de anúncios não sobe de novo');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Carrossel com vídeo', imagens_urls: [m2.token, v1.token] } });
    limparLog();
    r = await req('a', 'POST', `/api/saas/campanhas/${r.corpo.campanha.id}/subir`, { confirmado: true });
    { const cr = chamadas().find((c) => c.alvo === 'meta' && /adcreatives$/.test(c.u.split('?')[0]));
      const dec = cr ? decodeURIComponent(cr.body) : '';
      ok(r.status === 200 && /image_hash/.test(dec) && /child_attachments/.test(dec) && /"video_id":"vid\d+"/.test(dec), 'carrossel mistura imagem e vídeo'); }
    await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Rascunho com vídeo', imagem_url: v1.token } });
    r = await req('a', 'DELETE', `/api/saas/midias/${v1.id}`);
    ok(r.status === 409, 'vídeo usado em rascunho não pode ser excluído');

    // criativos enviados na tela de Campanhas vão para o rascunho gerado pela IA
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Clínica de estética em Recife, R$ 40 por dia, mulheres de 25 a 55 anos, levar para https://clinica.exemplo.com/agendar', midias: [m1.token, v1.token] });
    { const c = r.corpo.campanha; const im = c && c.spec.imagens_urls;
      ok(r.status === 200 && im && im.join() === `${m1.token},${v1.token}` && !c.spec.imagem_url && !(c.pendencias || []).some((x) => /imagem|v[ií]deo|criativo/i.test(x)), 'rascunho da IA já nasce com os criativos enviados e sem pendência de imagem'); }
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Clínica de estética em Recife, R$ 40 por dia, mulheres de 25 a 55 anos, levar para https://clinica.exemplo.com/agendar', midias: [m1.token] });
    ok(r.status === 200 && r.corpo.campanha.spec.imagem_url === m1.token && !r.corpo.campanha.spec.imagens_urls, 'um criativo só vira anúncio simples');
    r = await req('b', 'POST', '/api/saas/campanhas/ia', { briefing: 'Loja de roupas em Olinda, R$ 30 por dia, mulheres de 20 a 40 anos, levar para https://loja.exemplo.com', midias: [m1.token] });
    ok(r.status === 400, 'criativo de outro assinante é recusado na IA');
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Clínica de estética em Recife, R$ 40 por dia, mulheres de 25 a 55 anos, levar para https://clinica.exemplo.com/agendar', midias: ['https://x.com/a.jpg'] });
    ok(r.status === 400, 'só aceita criativos enviados (midia:ID) na IA');

    // imagem de outro cliente não vale
    r = await req('b', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Roubo', imagem_url: m2.token } });
    ok(r.status === 200 && (await req('b', 'POST', `/api/saas/campanhas/${r.corpo.campanha.id}/conferir`)).corpo.ok !== true, 'imagem de outro assinante não funciona na campanha dele');
    r = await req('a', 'DELETE', `/api/saas/midias/${m2.id}`);
    ok(r.status === 409 || r.status === 200, 'exclusão respeita rascunhos');


    // arquivos enviados ao Meta são apagados 1 hora depois (menos os que ainda estão em rascunho)
    r = await envia('a', png, 'image/png', 'temporaria.png'); const m3 = r.corpo.midia;
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { ...base, nome: 'Arquivo temporário', imagem_url: m3.token } });
    await req('a', 'POST', `/api/saas/campanhas/${r.corpo.campanha.id}/subir`, { confirmado: true });
    { const { rows: [a] } = await db.query(`SELECT enviada_em FROM saas_midias WHERE id=$1`, [m3.id]);
      ok(!!a.enviada_em, 'o envio ao Meta marca a hora no arquivo');
      await db.query(`UPDATE saas_midias SET enviada_em = now() - interval '30 minutes' WHERE id=$1`, [m3.id]);
      await req('a', 'GET', '/api/saas/midias');
      ok((await db.query(`SELECT 1 FROM saas_midias WHERE id=$1`, [m3.id])).rowCount === 1, 'com 30 minutos o arquivo ainda fica');
      await db.query(`UPDATE saas_midias SET enviada_em = now() - interval '2 hours' WHERE id=$1`, [m3.id]);
      await req('a', 'GET', '/api/saas/midias');
      ok((await db.query(`SELECT 1 FROM saas_midias WHERE id=$1`, [m3.id])).rowCount === 0, 'passou 1 hora do envio ao Meta: arquivo apagado');
      await db.query(`UPDATE saas_midias SET enviada_em = now() - interval '2 hours' WHERE id=$1`, [v1.id]);
      await req('a', 'GET', '/api/saas/midias');
      ok((await db.query(`SELECT 1 FROM saas_midias WHERE id=$1`, [v1.id])).rowCount === 1, 'arquivo que ainda está em rascunho não é apagado'); }

    console.log('Pedido de suporte para integração');
    r = await req(null, 'POST', '/api/saas/chamados', { plataformas: ['meta'] }); ok(r.status === 401, 'sem login não abre chamado');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: [], contato: '81999990000', janela: 'terça à tarde' }); ok(r.status === 400, 'exige escolher o que integrar');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: ['meta'], contato: '123', janela: 'terça à tarde' }); ok(r.status === 400, 'exige telefone válido');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: ['meta'], contato: '81999990000', janela: '' }); ok(r.status === 400, 'exige dias e horários');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: ['meta', 'google', 'tiktok'], contato: '(81) 99999-0000', janela: 'terça e quinta à tarde', obs: 'Já tenho a página' });
    const ch = r.corpo.chamado;
    ok(r.status === 200 && ch.status === 'aberto' && ch.plataformas.join() === 'meta,google', 'abre o chamado ignorando plataforma desconhecida');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: ['meta'], contato: '81999990000', janela: 'sexta' }); ok(r.status === 409, 'só um pedido em andamento por conta');
    r = await req('b', 'GET', '/api/saas/chamados'); ok(r.corpo.chamados.length === 0, 'o outro assinante não vê o chamado da Ana');
    r = await req('b', 'POST', `/api/saas/chamados/${ch.id}/cancelar`); ok(r.status === 404, 'nem cancela o chamado dela');
    r = await req('a', 'GET', '/api/saas/admin/chamados'); ok(r.status === 403, 'assinante não acessa a lista da administradora');
    r = await req('adm', 'GET', '/api/saas/admin/chamados');
    ok(r.status === 200 && r.corpo.abertos === 1 && r.corpo.chamados[0].email === 'ana@exemplo.com' && r.corpo.chamados[0].contato === '(81) 99999-0000', 'administradora vê o chamado com os dados de contato');
    r = await req('adm', 'PUT', `/api/saas/admin/chamados/${ch.id}`, { status: 'agendado' }); ok(r.status === 400, 'agendar exige data e hora');
    const quando = new Date(Date.now() + 2 * 86400000).toISOString();
    r = await req('adm', 'PUT', `/api/saas/admin/chamados/${ch.id}`, { agendado_para: quando });
    ok(r.status === 200 && r.corpo.chamado.status === 'agendado' && new Date(r.corpo.chamado.agendado_para).toISOString() === quando, 'administradora agenda a configuração');
    r = await req('a', 'GET', '/api/saas/chamados'); ok(r.corpo.chamados[0].status === 'agendado' && r.corpo.chamados[0].agendado_para, 'o assinante vê o agendamento');
    r = await req('adm', 'PUT', `/api/saas/admin/chamados/${ch.id}`, { status: 'concluido' }); ok(r.corpo.chamado.status === 'concluido', 'conclui o chamado');
    r = await req('a', 'POST', '/api/saas/chamados', { plataformas: ['google'], contato: '81999990000', janela: 'sexta' }); ok(r.status === 200, 'depois de concluído pode pedir de novo');
    r = await req('a', 'POST', `/api/saas/chamados/${r.corpo.chamado.id}/cancelar`); ok(r.status === 200 && r.corpo.chamado.status === 'cancelado', 'assinante cancela o próprio pedido');
    r = await req(null, 'GET', '/video/demo-midiaut.mp4'); ok(r.status === 200, 'vídeo demonstrativo é servido');
    console.log('Pagamento por Pix');
    r = await req(null, 'GET', '/api/saas/pix?tipo=mensalidade'); ok(r.status === 401, 'sem login não gera Pix');
    r = await req('a', 'GET', '/api/saas/pix?tipo=outro'); ok(r.status === 400, 'tipo de pagamento inválido é recusado');
    r = await req('a', 'GET', '/api/saas/pix?tipo=avulsas&qtd=0'); ok(r.status === 400, 'quantidade zero é recusada');
    r = await req('a', 'GET', '/api/saas/pix?tipo=mensalidade');
    { const pg = r.corpo; const corpo = (pg.payload || '').slice(0, -4);
      ok(r.status === 200 && pg.valor === 370 && pg.chave === '67679923000192', 'Pix da mensalidade com o valor do plano e a chave certa');
      ok(/^000201/.test(pg.payload) && pg.payload.includes('0014br.gov.bcb.pix0114' + '67679923000192') && pg.payload.includes('5406370.00'), 'copia e cola traz a chave e o valor 370.00');
      const crc = (t) => { let c = 0xffff; for (const ch of t) { c ^= ch.charCodeAt(0) << 8; for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c.toString(16).toUpperCase().padStart(4, '0'); };
      ok(pg.payload.endsWith(crc(corpo)) && /^data:image\/png;base64,/.test(pg.qr), 'CRC do BR Code confere e o QR Code vem em PNG'); }
    r = await req('a', 'GET', '/api/saas/pix?tipo=avulsas&qtd=3'); ok(r.corpo.valor === 45 && r.corpo.payload.includes('540545.00'), 'avulsas: 3 x R$ 15 = R$ 45');
    r = await req('a', 'POST', '/api/saas/pix/informar', { tipo: 'avulsas', qtd: 3 }); const px1 = r.corpo.pedido;
    ok(r.status === 200 && px1.status === 'informado' && px1.valor === 45, 'assinante avisa que pagou');
    r = await req('a', 'POST', '/api/saas/pix/informar', { tipo: 'avulsas', qtd: 3 }); ok(r.status === 409, 'não duplica o aviso em aberto');
    r = await req('a', 'GET', '/api/saas/admin/pix'); ok(r.status === 403, 'assinante não vê a fila da administradora');
    r = await req('adm', 'GET', '/api/saas/admin/pix'); ok(r.corpo.abertos >= 1 && r.corpo.pedidos.some((x) => x.id === px1.id && x.email === 'ana@exemplo.com'), 'administradora vê o aviso');
    { const { rows: [a0] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]);
      r = await req('adm', 'POST', `/api/saas/admin/pix/${px1.id}/confirmar`); ok(r.status === 200 && r.corpo.pedido.status === 'confirmado', 'administradora libera o pagamento');
      const { rows: [a1] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]);
      ok(a1.campanhas_extras === a0.campanhas_extras + 3, 'as 3 campanhas avulsas entram na conta');
      r = await req('adm', 'POST', `/api/saas/admin/pix/${px1.id}/confirmar`); ok(r.status === 409, 'não libera duas vezes');
      await db.query('UPDATE saas_contas SET campanhas_extras=$2 WHERE id=$1', [idA, a0.campanhas_extras]); }
    r = await req('b', 'POST', '/api/saas/pix/informar', { tipo: 'mensalidade' }); const px2 = r.corpo.pedido;
    { const { rows: [o] } = await db.query('SELECT status, periodo_fim, trial_ate FROM saas_contas WHERE id=$1', [idB]);
      r = await req('adm', 'POST', `/api/saas/admin/pix/${px2.id}/confirmar`); ok(r.status === 200, 'libera a mensalidade por Pix');
      const { rows: [n] } = await db.query('SELECT status, periodo_fim FROM saas_contas WHERE id=$1', [idB]);
      const dias = (new Date(n.periodo_fim) - Date.now()) / 86400000;
      ok(n.status === 'ativa' && dias > 29 && dias <= 30.01, 'conta fica ativa por 30 dias');
      r = await req('b', 'GET', '/api/saas/eu'); ok(r.corpo.conta.situacao.ativa === true, 'assinante com Pix em dia usa o sistema');
      await db.query(`UPDATE saas_contas SET periodo_fim = now() - interval '1 day' WHERE id=$1`, [idB]);
      r = await req('b', 'GET', '/api/saas/eu'); ok(r.corpo.conta.situacao.codigo === 'pix_vencido' && r.corpo.conta.situacao.ativa === false, 'Pix vencido bloqueia criar campanhas');
      await db.query('UPDATE saas_contas SET status=$2, periodo_fim=$3, trial_ate=$4 WHERE id=$1', [idB, o.status, o.periodo_fim, o.trial_ate]); }
    r = await req('b', 'POST', '/api/saas/pix/informar', { tipo: 'avulsas', qtd: 2 }); const px3 = r.corpo.pedido;
    r = await req('adm', 'POST', `/api/saas/admin/pix/${px3.id}/recusar`); ok(r.status === 200 && r.corpo.pedido.status === 'recusado', 'administradora recusa um aviso');
    r = await req('a', 'GET', '/api/saas/pix/pedidos'); ok(r.corpo.pedidos.length >= 1 && r.corpo.pedidos.every((x) => !('conta_id' in x)), 'assinante vê só os próprios pedidos');
    console.log('Limite de campanhas por plano e campanhas avulsas');
    {
      const { rows: [orig] } = await db.query(`SELECT status, trial_ate FROM saas_contas WHERE id=$1`, [idA]);
      await db.query(`UPDATE saas_contas SET status='ativa' WHERE id=$1`, [idA]);
      await db.query(`UPDATE saas_campanhas SET cota_mes=NULL WHERE conta_id=$1`, [idA]); // zera a cota do mês sem apagar as campanhas
      r = await req('a', 'GET', '/api/saas/eu');
      ok(r.corpo.conta.campanhas.limite === 10 && r.corpo.conta.campanhas.usadas === 0 && r.corpo.conta.campanhas.preco_avulsa === 15, 'plano Solo: 10 campanhas por mês, avulsa a R$ 15');
      const mk = async (nome) => (await req('a', 'POST', '/api/saas/campanhas', { spec: { ...camp.spec, nome } })).corpo.campanha;
      // enche a cota do mês direto no banco (9 usadas)
      const mes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
      for (let i = 0; i < 9; i++) await db.query(`INSERT INTO saas_campanhas (conta_id, cliente_id, plataforma, spec, status, criada_em, cota_mes) SELECT $1, id, 'meta', '{}', 'criada_pausada', now(), $2 FROM saas_clientes WHERE conta_id=$1 AND principal`, [idA, mes]);
      const c10 = await mk('Décima'); const c11 = await mk('Onze');
      r = await req('a', 'POST', `/api/saas/campanhas/${c10.id}/subir`, { confirmado: true });
      ok(r.status === 200 && r.corpo.campanha.status === 'criada_pausada', 'a 10ª campanha cabe no plano');
      r = await req('a', 'GET', '/api/saas/eu');
      ok(r.corpo.conta.campanhas.usadas === 10 && r.corpo.conta.campanhas.restantes === 0, 'contador mostra 10/10');
      limparLog();
      r = await req('a', 'POST', `/api/saas/campanhas/${c11.id}/subir`, { confirmado: true });
      ok(r.status === 402 && r.corpo.codigo === 'limite_campanhas' && /R\$ 15/.test(r.corpo.erro), 'a 11ª trava com 402 e oferece avulsa de R$ 15');
      ok(chamadas().filter((c) => c.alvo === 'meta').length === 0, 'travou antes de falar com o Meta');
      const { rows: [st] } = await db.query('SELECT status FROM saas_campanhas WHERE id=$1', [c11.id]);
      ok(st.status === 'rascunho', 'a campanha continua rascunho');
      // compra avulsa
      r = await req('a', 'POST', '/api/saas/campanhas-avulsas', { quantidade: 0 }); ok(r.status === 400, 'quantidade inválida é recusada');
      limparLog();
      r = await req('a', 'POST', '/api/saas/campanhas-avulsas', { quantidade: 3 });
      ok(r.status === 200 && /checkout\.stripe\.com/.test(r.corpo.url) && r.corpo.total === 45, 'compra de 3 avulsas = R$ 45 no Stripe');
      const sb = chamadas().find((c) => c.alvo === 'stripe');
      const sd = decodeURIComponent(sb.body);
      ok(/mode=payment/.test(sd) && /unit_amount\]=1500/.test(sd) && /quantity\]=3/.test(sd) && /currency\]=brl/.test(sd), 'sessão de pagamento único, 3 x R$ 15,00 em BRL');
      const sessao = (id, extra = {}) => ({ type: 'checkout.session.completed', data: { object: { id, mode: 'payment', payment_status: 'paid', amount_total: 4500, customer: 'cus_x', client_reference_id: String(idA), metadata: { conta_id: String(idA), tipo: 'campanhas_avulsas', quantidade: '3' }, ...extra } } });
      await webhook(sessao('cs_test_1', { payment_status: 'unpaid' }));
      let { rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]);
      ok(ex.campanhas_extras === 0, 'pagamento ainda não confirmado não libera nada');
      await webhook(sessao('cs_test_1', { amount_total: 100 }));
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(ex.campanhas_extras === 0, 'valor menor que o esperado não libera');
      r = await webhook(sessao('cs_test_1'));
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(r.status === 200 && ex.campanhas_extras === 3, 'pagamento confirmado credita 3 avulsas');
      await webhook(sessao('cs_test_1'));
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(ex.campanhas_extras === 3, 'evento repetido do Stripe não credita de novo');
      r = await req('a', 'POST', `/api/saas/campanhas/${c11.id}/subir`, { confirmado: true });
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(r.status === 200 && ex.campanhas_extras === 2, 'a 11ª sobe usando 1 avulsa (sobram 2)');
      r = await req('a', 'GET', '/api/saas/eu');
      ok(r.corpo.conta.campanhas.usadas === 10 && r.corpo.conta.campanhas.extras === 2, 'contador do plano segue 10/10 e mostra 2 avulsas');
      // falha no Meta devolve a avulsa
      const c12 = await mk('Doze');
      const mockFalha = await db.query(`UPDATE saas_campanhas SET spec = spec || '{"url_destino":"http://sem-https.com"}' WHERE id=$1`, [c12.id]);
      r = await req('a', 'POST', `/api/saas/campanhas/${c12.id}/subir`, { confirmado: true });
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(r.status === 400 && ex.campanhas_extras === 2, 'rascunho inválido não gasta avulsa');
      // Google também conta
      r = await req('b', 'GET', '/api/saas/eu'); ok(r.corpo.conta.campanhas.limite === 10, 'outro assinante tem a própria cota');
      r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { campanhas_extras_somar: 5 });
      ({ rows: [ex] } = await db.query('SELECT campanhas_extras FROM saas_contas WHERE id=$1', [idA]));
      ok(r.status === 200 && ex.campanhas_extras === 7, 'administradora pode liberar avulsas de cortesia');
      await db.query(`UPDATE saas_contas SET plano='agencia' WHERE id=$1`, [idA]);
      r = await req('a', 'GET', '/api/saas/eu'); ok(r.corpo.conta.campanhas.limite === 30, 'plano Agência: 30 por mês');
      await db.query(`UPDATE saas_contas SET plano='solo', campanhas_extras=0 WHERE id=$1`, [idA]);
      await db.query(`UPDATE saas_contas SET status=$2, trial_ate=$3 WHERE id=$1`, [idA, orig.status, orig.trial_ate]);
      r = await req(null, 'GET', '/midiaut'); ok(/10 campanhas novas por mês/.test(r.corpo.raw) && /R\$ 15/.test(r.corpo.raw), 'página de vendas mostra o limite e a avulsa');
    }

    console.log('Cota de IA');
    await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Segunda campanha de estética em Recife com orçamento de 40 reais por dia.' });
    await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Terceira campanha de estética em Recife com orçamento de 40 reais por dia.' });
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Quarta campanha de estética em Recife com orçamento de 40 reais por dia.' });
    ok(r.status === 429 && /rascunhos com IA/.test(r.corpo.erro), 'passou da cota mensal: 429 com mensagem clara');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { nome: 'Manual', objetivo: 'OUTCOME_TRAFFIC' } });
    ok(r.status === 200, 'montar campanha manualmente continua liberado');

    console.log('Período de teste acabou');
    await db.query(`UPDATE saas_contas SET trial_ate = now() - interval '1 day' WHERE id=$1`, [idA]);
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.situacao.ativa === false && r.corpo.conta.situacao.codigo === 'trial_expirado', 'situação vira trial_expirado');
    limparLog();
    r = await req('a', 'POST', '/api/saas/campanhas/ia', { briefing: 'Campanha nova de estética em Recife com orçamento de 40 reais por dia.' });
    ok(r.status === 402 && r.corpo.codigo === 'trial_expirado', 'IA bloqueada com 402');
    r = await req('a', 'POST', `/api/saas/campanhas/${camp.id}/ativar`, { confirmado: true });
    ok(r.status === 402 && chamadas().length === 0, 'ativar bloqueado e nada chega ao Meta');
    const { rows: [ex] } = await db.query(`UPDATE saas_campanhas SET status='ativada' WHERE id=$1 RETURNING id`, [camp.id]);
    r = await req('a', 'POST', `/api/saas/campanhas/${ex.id}/pausar`, {});
    ok(r.status === 200, 'mesmo sem assinatura em dia dá para PAUSAR e parar de gastar');
    r = await req('a', 'GET', '/api/saas/chaves');
    ok(r.status === 200, 'chaves continuam acessíveis');

    console.log('Cobrança (Stripe)');
    limparLog();
    r = await req('a', 'POST', '/api/saas/assinar');
    ok(r.status === 200 && /checkout\.stripe\.com/.test(r.corpo.url), 'cria a sessão de pagamento hospedada no Stripe');
    const st = chamadas().find((c) => c.alvo === 'stripe');
    ok(/mode=subscription/.test(st.body) && /client_reference_id=\d+/.test(st.body) && !/card/i.test(st.body.replace(/payment_method/g, '')), 'o pedido ao Stripe não carrega dados de cartão');
    r = await webhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { conta_id: String(idA) }, current_period_end: Math.floor(Date.now() / 1000) + 2592000 } } }, 't=1,v1=00');
    ok(r.status === 400, 'webhook com assinatura inválida é recusado');
    const velho = Math.floor(Date.now() / 1000) - 4000; const corpoV = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    r = await req(null, 'POST', '/api/saas/webhook', null, { bruto: corpoV, headers: { 'stripe-signature': assinar(corpoV, velho) } });
    ok(r.status === 400, 'webhook com assinatura antiga demais (replay) é recusado');
    r = await webhook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: String(idA) } } });
    ok(r.status === 200, 'checkout concluído é aceito');
    r = await webhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { conta_id: String(idA) }, current_period_end: Math.floor(Date.now() / 1000) + 2592000 } } });
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.status === 'ativa' && r.corpo.conta.situacao.ativa && r.corpo.conta.tem_assinatura && r.corpo.conta.periodo_fim, 'assinatura ativa libera a conta');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { nome: 'Depois de assinar' } });
    ok(r.status === 200, 'volta a poder criar campanhas');
    r = await webhook({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.status === 'inadimplente' && r.corpo.conta.situacao.ativa === false, 'cobrança que falha deixa a conta inadimplente');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { nome: 'x' } });
    ok(r.status === 402 && r.corpo.codigo === 'inadimplente', 'inadimplente não cria campanha');
    r = await webhook({ type: 'invoice.paid', data: { object: { customer: 'cus_1' } } });
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.status === 'ativa', 'pagamento confirmado reativa');
    r = await req('a', 'POST', '/api/saas/portal');
    ok(r.status === 200 && /stripe/.test(r.corpo.url), 'portal para trocar o cartão');
    r = await req('b', 'POST', '/api/saas/portal');
    ok(r.status === 400, 'quem nunca assinou não tem portal');

    console.log('Administrador gere assinantes');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { bloqueada: true });
    ok(r.status === 200, 'administrador bloqueia o assinante');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: { nome: 'x' } });
    ok(r.status === 402 && r.corpo.codigo === 'bloqueada', 'bloqueado não cria campanha');
    await webhook({ type: 'invoice.paid', data: { object: { customer: 'cus_1' } } });
    await webhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { conta_id: String(idA) } } } });
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.status === 'bloqueada', 'o Stripe não desbloqueia uma conta bloqueada pelo administrador');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { bloqueada: false });
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.status === 'ativa', 'desbloqueio devolve a situação anterior (assinatura ativa)');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idB}`, { estender_dias: 14 });
    r = await req('b', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.situacao.dias_trial >= 20, 'administrador estende o período de teste');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idB}`, { cortesia: true });
    r = await req('b', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.situacao.codigo === 'cortesia', 'acesso de cortesia, sem cobrança');
    r = await req('adm', 'POST', `/api/saas/admin/assinantes/${idB}/link-senha`);
    ok(r.status === 200 && /convite=/.test(r.corpo.link), 'link para o assinante criar nova senha');

    console.log('Google Ads');
    r = await req('b', 'POST', '/api/saas/testar/google');
    ok(r.corpo.ok === false && /Faltam/.test(r.corpo.erro), 'sem chaves do Google o teste explica o que falta');
    const gk = [['GOOGLE_ADS_DEVELOPER_TOKEN', 'devtoken-bruno-1234567890'], ['GOOGLE_ADS_CLIENT_ID', '123-abc.apps.googleusercontent.com'], ['GOOGLE_ADS_CLIENT_SECRET', 'GOCSPX-segredo-bruno-123456'], ['GOOGLE_ADS_REFRESH_TOKEN', '1//refresh-token-do-bruno-123456'], ['GOOGLE_ADS_CUSTOMER_ID', '123-456-7890']];
    for (const [k, v] of gk) { r = await req('b', 'PUT', '/api/saas/chaves', { chave: k, valor: v }); ok(r.status === 200, `salva ${k}`); }
    limparLog();
    r = await req('b', 'POST', '/api/saas/testar/google');
    ok(r.corpo.ok === true && r.corpo.conta === 'Conta Google Teste', 'teste do Google mostra o nome da conta');
    const gc = chamadas().filter((c) => c.alvo === 'google');
    ok(gc.length && gc.every((c) => c.dev === 'devtoken-bruno-1234567890' && c.auth === 'Bearer gat-1//refresh-token-do-bruno-123456' && /customers\/1234567890\//.test(c.u)), 'Google recebeu só as credenciais do Bruno e a conta dele');
    r = await req('b', 'GET', '/api/saas/google/campanhas?periodo=LAST_30_DAYS');
    ok(r.status === 200 && r.corpo[0].gasto_brl === 12 && r.corpo[0].conversoes === 2, 'lista campanhas com métricas');
    console.log('Google Analytics 4');
    r = await req('b', 'GET', '/api/saas/analytics'); ok(r.status === 400 && /Faltam/.test(r.corpo.erro), 'sem as chaves do Analytics a tela explica o que falta');
    r = await req('b', 'PUT', '/api/saas/chaves', { chave: 'GA4_PROPERTY_ID', valor: 'G-ABC123' }); ok(r.status === 400, 'ID do GA4 precisa ser numérico');
    r = await req('b', 'PUT', '/api/saas/chaves', { chave: 'GA4_PROPERTY_ID', valor: 'properties/4455667' }); ok(r.status === 200, 'salva o ID da propriedade');
    r = await req('b', 'PUT', '/api/saas/chaves', { chave: 'GA4_REFRESH_TOKEN', valor: '1//refresh-analytics-do-bruno-12345' }); ok(r.status === 200, 'salva o refresh token do Analytics');
    limparLog();
    r = await req('b', 'POST', '/api/saas/testar/ga4'); ok(r.corpo.ok === true && r.corpo.sessoes_7d === 100, 'teste do Analytics mostra as sessões');
    r = await req('b', 'GET', '/api/saas/analytics?dias=30');
    ok(r.status === 200 && r.corpo.dias === 30 && r.corpo.totais.sessoes === 100 && r.corpo.totais.conversoes === 8 && r.corpo.serie.length === 2 && r.corpo.origens[0].origem === 'google / cpc' && r.corpo.paginas[0].pagina === '/', 'traz totais, série, origens e páginas');
    ok(chamadas().filter((c) => c.alvo === 'ga4').every((c) => /properties\/4455667:runReport/.test(c.u) && c.auth === 'Bearer gat-1//refresh-analytics-do-bruno-12345'), 'Analytics usa só as credenciais e a propriedade do Bruno');
    r = await req('a', 'GET', '/api/saas/analytics'); ok(r.status === 400, 'outro assinante não enxerga os dados do Bruno');
    r = await req('b', 'GET', '/api/saas/google/campanhas?periodo=INVENTADO');
    ok(r.status === 400, 'período inválido é recusado');
    const spec = { nome: 'Pesquisa Bruno', orcamento_diario_brl: 30, estrategia: 'MAXIMIZE_CLICKS', titulos: ['Título um', 'Título dois', 'Título três'], descricoes: ['Descrição número um da campanha', 'Descrição número dois da campanha'], url_final: 'https://loja.exemplo/oferta', palavras_exatas: 'loja de sapatos\nsapato feminino' };
    r = await req('b', 'POST', '/api/saas/google/campanhas', { spec });
    ok(r.status === 400, 'criar campanha no Google exige confirmação');
    limparLog();
    r = await req('b', 'POST', '/api/saas/google/campanhas', { spec: { ...spec, orcamento_diario_brl: 5000 }, confirmado: true });
    ok(r.status === 400 && /teto/.test(r.corpo.erro) && chamadas().filter((c) => c.alvo === 'google' && c.m === 'POST' && /mutate/.test(c.u)).length === 0, 'orçamento acima do teto: nada é criado');
    r = await req('b', 'POST', '/api/saas/google/campanhas', { spec: { ...spec, titulos: ['x'.repeat(31), 'b', 'c'] }, confirmado: true });
    ok(r.status === 400 && /30 caracteres/.test(r.corpo.erro), 'título com mais de 30 caracteres é recusado');
    limparLog();
    r = await req('b', 'POST', '/api/saas/google/campanhas', { spec, confirmado: true });
    ok(r.status === 200 && r.corpo.campanha.plataforma === 'google' && r.corpo.campanha.ids.campanha_id === '22', 'cria campanha de Pesquisa');
    const mut = chamadas().filter((c) => c.alvo === 'google' && /mutate/.test(c.u));
    ok(mut.some((c) => /"status":"PAUSED"/.test(c.body) && /campaigns:mutate/.test(c.u)) && mut.filter((c) => /adGroupAds:mutate/.test(c.u)).every((c) => /"status":"PAUSED"/.test(c.body)), 'campanha e anúncio nascem PAUSADOS');
    r = await req('b', 'POST', '/api/saas/google/campanhas/22/status', { status: 'ENABLED' });
    ok(r.status === 400, 'ativar no Google exige confirmação');
    r = await req('b', 'POST', '/api/saas/google/campanhas/22/status', { status: 'ENABLED', confirmado: true });
    ok(r.status === 200, 'ativa no Google com confirmação');
    r = await req('b', 'POST', '/api/saas/google/campanhas/22/orcamento', { valor: 90, confirmado: true });
    ok(r.status === 400 && /20%/.test(r.corpo.erro), 'aumento de orçamento acima de +20% por vez é barrado');
    r = await req('b', 'POST', '/api/saas/google/campanhas/22/orcamento', { valor: 55, confirmado: true });
    ok(r.status === 200 && r.corpo.para_brl === 55, 'aumento dentro do limite passa');
    r = await req('b', 'POST', '/api/saas/google/campanhas/22/status', { status: 'PAUSED' });
    ok(r.status === 200, 'pausar não exige confirmação');
    r = await req('a', 'GET', '/api/saas/google/campanhas');
    ok(r.status === 400 && /não está configurado/.test(r.corpo.erro), 'a Ana, sem chaves do Google, não enxerga a conta do Bruno');

    console.log('Plano, BI e vários clientes');
    r = await req('a', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.plano === 'solo' && r.corpo.conta.clientes_max === 1 && r.corpo.clientes.length === 1 && r.corpo.clientes[0].principal, 'conta nova vem no plano Solo, com 1 cliente principal');
    const principalA = r.corpo.cliente_atual;
    r = await req('a', 'POST', '/api/saas/clientes', { nome: 'Cliente extra' });
    ok(r.status === 403 && /permite 1 cliente/.test(r.corpo.erro), 'plano Solo não adiciona um segundo cliente');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { plano: 'xyz' });
    ok(r.status === 400, 'plano inexistente é recusado pelo administrador');
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { plano: 'agencia', bi: true });
    ok(r.status === 200, 'administrador muda o plano e liga o BI');
    r = await req('a', 'POST', '/api/saas/clientes', { nome: 'Clínica Bella' });
    ok(r.status === 200 && r.corpo.cliente.nome === 'Clínica Bella', 'plano Agência adiciona o 2º cliente');
    const bella = r.corpo.cliente.id;
    r = await req('a', 'POST', '/api/saas/clientes', { nome: 'Loja Sol' });
    ok(r.status === 200, 'plano Agência adiciona o 3º cliente');
    const sol = r.corpo.cliente.id;
    r = await req('a', 'POST', '/api/saas/clientes', { nome: 'Quarto cliente' });
    ok(r.status === 403 && /permite 3 clientes/.test(r.corpo.erro), 'o 4º cliente passa do limite do plano');
    r = await req('a', 'GET', '/api/saas/eu', null, { headers: { 'x-cliente': String(bella) } });
    ok(r.status === 200 && r.corpo.cliente_atual === bella && r.corpo.conta.bi === true && r.corpo.conta.plano_nome === 'Agência', 'cabeçalho x-cliente escolhe o cliente; plano e BI aparecem na conta');
    r = await req('a', 'GET', '/api/saas/chaves', null, { headers: { 'x-cliente': String(bella) } });
    ok(r.corpo.grupos.flatMap((g) => g.campos).every((c) => !c.definido), 'cliente novo começa sem chaves (não herda as do principal)');
    r = await req('a', 'PUT', '/api/saas/chaves', { chave: 'META_ADS_TOKEN', valor: 'TOKEN-DA-BELLA-123456789' }, { headers: { 'x-cliente': String(bella) } });
    ok(r.status === 200, 'grava chave só para a Clínica Bella');
    r = await req('a', 'GET', '/api/saas/chaves', null, { headers: { 'x-cliente': String(sol) } });
    ok(r.corpo.grupos.flatMap((g) => g.campos).every((c) => !c.definido), 'a chave da Bella não aparece na Loja Sol');
    r = await req('a', 'GET', '/api/saas/chaves');
    ok(r.corpo.grupos.flatMap((g) => g.campos).filter((c) => c.definido).length === 3 && !JSON.stringify(r.corpo).includes('BELLA'), 'o cliente principal continua só com as chaves dele');
    r = await req('a', 'POST', '/api/saas/campanhas', { spec: {} }, { headers: { 'x-cliente': String(bella) } });
    ok(r.status === 200, 'cria campanha para a Bella');
    const campBella = r.corpo.campanha.id;
    r = await req('a', 'GET', '/api/saas/campanhas', null, { headers: { 'x-cliente': String(bella) } });
    ok(r.corpo.length === 1 && r.corpo[0].id === campBella, 'a lista da Bella tem só a campanha dela');
    r = await req('a', 'GET', '/api/saas/campanhas', null, { headers: { 'x-cliente': String(sol) } });
    ok(r.corpo.length === 0, 'a Loja Sol não vê campanhas da Bella');
    r = await req('a', 'DELETE', `/api/saas/campanhas/${campBella}`, null, { headers: { 'x-cliente': String(sol) } });
    ok(r.status === 404, 'não dá para mexer na campanha de um cliente estando em outro');
    r = await req('b', 'GET', '/api/saas/eu', null, { headers: { 'x-cliente': String(bella) } });
    ok(r.status === 404, 'um assinante não usa o cliente de outro assinante');
    r = await req('b', 'DELETE', `/api/saas/clientes/${bella}`);
    ok(r.status === 404, 'um assinante não exclui o cliente de outro');
    r = await req('a', 'PUT', `/api/saas/clientes/${sol}`, { nome: 'Loja Sol & Mar' });
    ok(r.status === 200 && r.corpo.cliente.nome === 'Loja Sol & Mar', 'renomeia um cliente');
    r = await req('a', 'DELETE', `/api/saas/clientes/${principalA}`);
    ok(r.status === 400 && /principal/.test(r.corpo.erro), 'o cliente principal não pode ser excluído');
    r = await req('adm', 'GET', '/api/saas/admin/assinantes');
    const linhaA = r.corpo.assinantes.find((x) => x.id === idA);
    ok(linhaA.plano === 'agencia' && linhaA.bi === true && linhaA.clientes === 3 && linhaA.clientes_max === 3, 'painel do administrador mostra plano, BI e clientes usados');
    r = await req('a', 'DELETE', `/api/saas/clientes/${bella}`);
    ok(r.status === 200, 'exclui a Clínica Bella');
    const { rows: [rb] } = await db.query(`SELECT (SELECT count(*) FROM configuracoes WHERE client_id=$1)::int c, (SELECT count(*) FROM saas_campanhas WHERE cliente_id=$2)::int k`, [2000000 + bella, bella]);
    ok(rb.c === 0 && rb.k === 0, 'chaves e campanhas do cliente excluído foram apagadas');
    r = await req('a', 'GET', '/api/saas/eu', null, { headers: { 'x-cliente': String(bella) } });
    ok(r.status === 404, 'o cliente excluído deixa de existir');
    r = await req('a', 'DELETE', `/api/saas/clientes/${sol}`);
    r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${idA}`, { plano: 'solo', bi: false });
    ok(r.status === 200, 'volta a Ana para o plano Solo');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Caio', sobrenome: 'Silva', cpf: cpfDe(6), email: 'caio@exemplo.com', senha: 'senha-forte-3', aceite: true, plano: 'escala', bi: true });
    ok(r.status === 200, 'cadastro vindo da landing com plano Escala e BI');
    const { rows: [cc] } = await db.query(`SELECT c.plano, c.bi, (SELECT count(*) FROM saas_clientes k WHERE k.conta_id=c.id AND k.principal)::int p FROM saas_contas c JOIN users u ON u.id=c.user_id WHERE u.email='caio@exemplo.com'`);
    ok(cc.plano === 'escala' && cc.bi === true && cc.p === 1, 'o plano e o BI escolhidos na landing ficam gravados, com cliente principal');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Dani', sobrenome: 'Silva', cpf: cpfDe(7), email: 'dani@exemplo.com', senha: 'senha-forte-4', aceite: true, plano: 'inventado' });
    const { rows: [dd] } = await db.query(`SELECT c.plano FROM saas_contas c JOIN users u ON u.id=c.user_id WHERE u.email='dani@exemplo.com'`);
    ok(r.status === 200 && dd.plano === 'solo', 'plano desconhecido no cadastro vira Solo');
    await db.query(`DELETE FROM users WHERE email IN ('caio@exemplo.com','dani@exemplo.com')`);

    console.log('Modo suporte (administradora dentro da conta do assinante)');
    r = await req('a', 'POST', `/api/saas/admin/assinantes/${idA}/suporte`);
    ok(r.status === 403, 'assinante não consegue iniciar modo suporte');
    r = await req('adm', 'GET', '/api/saas/eu');
    ok(r.status === 403, 'sem modo suporte, o administrador continua fora da área do assinante');
    r = await req(null, 'POST', `/api/saas/admin/assinantes/${idA}/suporte`, null, { headers: { cookie: jar.adm } });
    ok(r.status === 200 && /pbh_suporte=/.test(r.sc || ''), 'administrador inicia o modo suporte e recebe o cookie de suporte');
    const ckSup = (r.sc || '').split(';')[0];
    const comSup = { headers: { cookie: `${jar.adm}; ${ckSup}` } };
    r = await req(null, 'GET', '/api/saas/eu', null, comSup);
    ok(r.status === 200 && r.corpo.conta.email === 'ana@exemplo.com' && r.corpo.suporte && r.corpo.suporte.admin === 'admin@exemplo.com', 'com o cookie de suporte o administrador vê a conta da Ana e a faixa de suporte');
    r = await req(null, 'GET', '/api/saas/campanhas', null, comSup);
    ok(r.status === 200 && Array.isArray(r.corpo), 'administrador lista as campanhas da Ana');
    r = await req(null, 'GET', '/api/saas/chaves', null, comSup);
    ok(r.status === 200 && !JSON.stringify(r.corpo).includes(TOKEN_ADMIN), 'vê as chaves da Ana sem ver os valores');
    r = await req(null, 'POST', '/api/saas/campanhas', { spec: {} }, comSup);
    ok(r.status === 200, 'cria rascunho na conta da Ana durante o suporte');
    const campSup = r.corpo.campanha.id;
    r = await req(null, 'POST', `/api/saas/campanhas/${campSup}/ativar`, { confirmado: true }, comSup);
    ok(r.status === 403 && /suporte/.test(r.corpo.erro), 'ativar campanha é bloqueado no modo suporte');
    r = await req(null, 'POST', `/api/saas/campanhas/${campSup}/subir`, { confirmado: true }, comSup);
    ok(r.status === 403, 'subir campanha para o Meta é bloqueado no modo suporte');
    r = await req(null, 'POST', '/api/saas/google/campanhas/123/status', { status: 'ENABLED', confirmado: true }, comSup);
    ok(r.status === 403, 'ativar no Google é bloqueado no modo suporte');
    r = await req(null, 'POST', '/api/saas/google/campanhas/123/orcamento', { valor: '10', confirmado: true }, comSup);
    ok(r.status === 403, 'mudar orçamento do Google é bloqueado no modo suporte');
    for (const [caminho, corpo] of [['/api/saas/assinar', {}], ['/api/saas/portal', {}], ['/api/saas/conta/excluir', { senha: 'senha-forte-1' }]]) {
      r = await req(null, 'POST', caminho, corpo, comSup);
      ok(r.status === 403 && /suporte/.test(r.corpo.erro), `${caminho} é bloqueado no modo suporte`);
    }
    r = await req(null, 'DELETE', `/api/saas/campanhas/${campSup}`, null, comSup);
    ok(r.status === 200, 'apagar o rascunho de teste é permitido');
    const { rows: ev } = await db.query(`SELECT tipo, detalhe FROM saas_eventos WHERE conta_id=$1 AND tipo IN ('suporte_iniciado','suporte_acao') ORDER BY id`, [idA]);
    ok(ev.some((e) => e.tipo === 'suporte_iniciado' && e.detalhe === 'admin@exemplo.com') && ev.filter((e) => e.tipo === 'suporte_acao').length >= 2, 'início e ações do suporte ficam registrados no histórico da conta');
    const falso = ckSup.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
    r = await req(null, 'GET', '/api/saas/eu', null, { headers: { cookie: `${jar.adm}; ${falso}` } });
    ok(r.status === 403, 'cookie de suporte adulterado é recusado');
    r = await req(null, 'GET', '/api/saas/eu', null, { headers: { cookie: ckSup } });
    ok(r.status === 401, 'cookie de suporte sozinho, sem login de administrador, não abre nada');
    r = await req(null, 'POST', '/api/saas/suporte/sair', null, comSup);
    ok(r.status === 200 && /pbh_suporte=;/.test(r.sc || ''), 'administrador sai do modo suporte');
    r = await req('adm', 'GET', '/api/saas/eu');
    ok(r.status === 403, 'depois de sair, volta a não ter acesso à área do assinante');

    console.log('Exclusão da conta (LGPD)');
    r = await req('b', 'POST', '/api/saas/conta/excluir', { senha: 'errada' });
    ok(r.status === 400, 'exclusão pede a senha');
    r = await req('a', 'POST', '/api/saas/conta/excluir', { senha: 'senha-forte-1' });
    ok(r.status === 400 && /Cancele a assinatura/.test(r.corpo.erro), 'quem tem assinatura paga precisa cancelar antes');
    r = await req('b', 'POST', '/api/saas/conta/excluir', { senha: 'senha-forte-2' });
    ok(r.status === 200, 'exclui a conta');
    const { rows: restos } = await db.query(`SELECT (SELECT count(*) FROM configuracoes WHERE client_id=$1)::int c, (SELECT count(*) FROM saas_campanhas WHERE conta_id=$2)::int k, (SELECT count(*) FROM users WHERE email='bruno@exemplo.com')::int u`, [1000000 + idB, idB]);
    ok(restos[0].c === 0 && restos[0].k === 0 && restos[0].u === 0, 'usuário, campanhas e chaves foram apagados');
    r = await req('a', 'GET', '/api/saas/chaves');
    ok(r.corpo.grupos.flatMap((g) => g.campos).filter((c) => c.definido).length === 3, 'as chaves da Ana continuam intactas');

    console.log('Backup do sistema interno não toca nos assinantes');
    r = await req('adm', 'GET', '/api/backup');
    ok(r.status === 200 && !JSON.stringify(r.corpo).includes('ana@exemplo.com'), 'backup não inclui assinantes');
    r = await req('adm', 'POST', '/api/restaurar', r.corpo);
    const { rows: [sob] } = await db.query(`SELECT (SELECT count(*) FROM saas_contas)::int c, (SELECT count(*) FROM saas_campanhas)::int k`);
    ok(r.status === 200 && sob.c === 1 && sob.k >= 1, 'restaurar um backup não apaga contas nem campanhas dos assinantes');

    console.log('Identidade MidIAut e endereços do site');
    for (const rota of ['/midiaut', '/gestoragent', '/gestoragente', '/assinar', '/agente', '/agente-de-trafego']) {
      r = await req(null, 'GET', rota);
      ok(rota === '/midiaut' ? (r.status === 200 && /MidIAut/.test(r.corpo.raw || '')) : r.status === 301, `${rota} abre ou redireciona para a página da MidIAut`);
    }
    r = await req(null, 'GET', '/midiaut');
    ok(/R\$ 370/.test(r.corpo.raw) && /R\$ 760/.test(r.corpo.raw) && /R\$ 950/.test(r.corpo.raw) && /Tráfego em piloto automático\./.test(r.corpo.raw), 'landing traz os três planos e o slogan');
    for (const rota of ['/cadastro', '/entrar', '/assinante']) { r = await req(null, 'GET', rota); ok(r.status === 200 && /MidIAut/.test(r.corpo.raw || '') && !/Agente de Tráfego|A Melhor Mídia/.test(r.corpo.raw || ''), `${rota} usa a marca MidIAut`); }
    r = await req(null, 'GET', '/brand/midiaut/logo-escuro.svg'); ok(r.status === 200, 'logo da MidIAut é servido');
    r = await req(null, 'GET', '/fonts/Manrope.ttf'); ok(r.status === 200, 'fonte Manrope é servida');

    console.log('Site e Blog');
    r = await req('a', 'GET', '/api/site/posts'); ok(r.status === 403 || r.status === 401, 'assinante não acessa o editor do blog');
    r = await req(null, 'GET', '/api/site/posts'); ok(r.status === 401, 'sem login não acessa o editor do blog');
    r = await req('adm', 'POST', '/api/site/posts', { titulo: 'Como criar anúncios no Instagram' });
    const post = r.corpo.post; ok(r.status === 200 && post.slug === 'como-criar-anuncios-no-instagram' && post.status === 'rascunho', 'cria rascunho com endereço limpo');
    r = await req(null, 'GET', '/blog/' + post.slug); ok(r.status === 404, 'rascunho não aparece no site');
    r = await req('adm', 'PUT', `/api/site/posts/${post.id}`, { titulo: post.titulo, status: 'publicado' }); ok(r.status === 400, 'não publica sem resumo e texto');
    r = await req('adm', 'POST', '/api/site/previa', { corpo: '## Oi\n<script>alert(1)</script> **forte** [x](javascript:alert(1)) [ok](https://exemplo.com)\n- a\n- b' });
    ok(/<h3>Oi<\/h3>/.test(r.corpo.html) && !/<script/.test(r.corpo.html) && !/href="javascript/.test(r.corpo.html) && /<strong>forte<\/strong>/.test(r.corpo.html) && /<ul>/.test(r.corpo.html) && /href="https:\/\/exemplo.com"/.test(r.corpo.html), 'Markdown vira HTML e escapa script e links perigosos');
    r = await req('adm', 'PUT', `/api/site/posts/${post.id}`, { titulo: 'Como criar anúncios no Instagram', resumo: 'Passo a passo simples.', corpo: '## Comece\nTexto <b>cru</b>.', capa_url: 'http://inseguro.com/a.jpg', status: 'publicado' });
    ok(r.status === 400, 'capa precisa ser https');
    r = await req('adm', 'PUT', `/api/site/posts/${post.id}`, { titulo: 'Como criar anúncios no Instagram', resumo: 'Passo a passo simples.', corpo: '## Comece\nTexto <b>cru</b>.', status: 'publicado' });
    ok(r.status === 200 && r.corpo.post.status === 'publicado' && r.corpo.post.publicado_em, 'publica o artigo');
    r = await req(null, 'GET', '/blog/' + post.slug);
    ok(r.status === 200 && /<h1>Como criar anúncios no Instagram<\/h1>/.test(r.corpo.raw) && /&lt;b&gt;cru&lt;\/b&gt;/.test(r.corpo.raw) && /BlogPosting/.test(r.corpo.raw) && /rel="canonical"/.test(r.corpo.raw), 'artigo público com SEO e texto escapado');
    {
      const seeds = require('../blog-seed'); const slugs = seeds.map((a) => a.slug);
      ok(seeds.length === 6, 'seis artigos iniciais de SEO');
      r = await req(null, 'GET', '/sitemap.xml'); ok(slugs.every((sl) => r.corpo.raw.includes('/blog/' + sl)), 'sitemap lista os artigos iniciais');
      ok(seeds.every((a) => a.seo_titulo.length <= 60 && a.seo_desc.length >= 100 && a.seo_desc.length <= 160), 'títulos SEO até 60 e descrições entre 100 e 160 caracteres');
      const links = seeds.flatMap((a) => [...a.corpo.matchAll(/\]\(\/blog\/([a-z0-9-]+)\)/g)].map((m) => m[1]));
      ok(links.length >= 6 && links.every((sl) => slugs.includes(sl)), 'links internos entre os artigos apontam para artigos que existem');
      for (const a of seeds) { r = await req(null, 'GET', '/blog/' + a.slug); ok(r.status === 200 && r.corpo.raw.includes('<h1>') && /rel="canonical"/.test(r.corpo.raw) && /BlogPosting/.test(r.corpo.raw), 'artigo no ar: ' + a.slug); }
    }
    r = await req(null, 'GET', '/blog'); ok(r.status === 200 && /Como criar anúncios no Instagram/.test(r.corpo.raw), 'lista do blog mostra o artigo');
    r = await req(null, 'GET', '/sitemap.xml'); ok(/\/blog\/como-criar-anuncios-no-instagram/.test(r.corpo.raw) && /\/midiaut/.test(r.corpo.raw), 'sitemap inclui o artigo');
    console.log('App instalável (PWA)');
    r = await req(null, 'GET', '/manifest.webmanifest');
    ok(r.status === 200 && r.corpo.display === 'standalone' && r.corpo.icons.length === 3 && r.corpo.start_url.startsWith('/assinante'), 'manifesto do app');
    for (const ic of r.corpo.icons) { const x = await req(null, 'GET', ic.src); ok(x.status === 200, `ícone ${ic.src} existe`); }
    r = await req(null, 'GET', '/sw.js'); ok(r.status === 200 && /\/api\//.test(r.corpo.raw), 'service worker não guarda chamadas da API');
    r = await req(null, 'GET', '/'); ok((r.corpo.raw.match(/data-instalar/g) || []).length === 3, 'home tem o botão Baixar app (topo, destaque e final)');
    r = await req(null, 'GET', '/pwa.js'); ok(/Adicionar à Tela de Início/.test(r.corpo.raw) && /controllerchange/.test(r.corpo.raw), 'guia de instalação do iPhone e atualização automática');
    r = await req(null, 'GET', '/offline.html'); ok(r.status === 200, 'tela sem internet');
    for (const pg of ['/assinante', '/entrar', '/']) { r = await req(null, 'GET', pg); ok(/rel="manifest"/.test(r.corpo.raw || '') && /\/pwa\.js/.test(r.corpo.raw || ''), `${pg} liga o manifesto e o pwa.js`); }
    r = await req(null, 'GET', '/robots.txt'); ok(/Sitemap:/.test(r.corpo.raw) && /Disallow: \/api\//.test(r.corpo.raw), 'robots.txt aponta o sitemap');
    r = await req('adm', 'PUT', `/api/site/posts/${post.id}`, { titulo: 'Outro título', resumo: 'x', corpo: 'y', slug: 'mudou' });
    ok(r.corpo.post.slug === post.slug, 'endereço publicado não muda');
    r = await req('adm', 'PUT', `/api/site/posts/${post.id}`, { titulo: 'Outro título', resumo: 'x', corpo: 'y', status: 'rascunho' });
    r = await req(null, 'GET', '/blog/' + post.slug); ok(r.status === 404, 'tirar do ar remove da página pública');
    r = await req(null, 'GET', '/midiaut'); ok(/href="\/blog"/.test(r.corpo.raw), 'a página inicial linka o blog');
    ok(/<link rel="canonical" href="http:\/\/[^"]+\/midiaut">/.test(r.corpo.raw) && /property="og:image" content="http:\/\//.test(r.corpo.raw) && !/\{\{BASE\}\}/.test(r.corpo.raw), 'página de vendas com canonical e imagem social absolutos');
    ok(/"@type":"FAQPage"/.test(r.corpo.raw) && /"@type":"Question"/.test(r.corpo.raw) && /"name":"Grátis"/.test(r.corpo.raw), 'dados estruturados: FAQ e plano Grátis');
    r = await req(null, 'GET', '/'); ok(r.status === 200 && /Gestão de Tráfego Pago com IA/.test(r.corpo.raw), 'a raiz do site é a página de vendas');
    r = await req(null, 'GET', '/?convite=abc'); ok(r.status === 200 && /id="conviteForm"/.test(r.corpo.raw), 'link de convite continua abrindo o painel');
    r = await req(null, 'GET', '/assinar'); ok(r.status === 301, 'endereços antigos redirecionam para /midiaut (sem conteúdo duplicado)');
    r = await req(null, 'GET', '/sitemap.xml'); ok(/<loc>[^<]+\/midiaut<\/loc><lastmod>\d{4}-\d\d-\d\d/.test(r.corpo.raw), 'sitemap traz a data da página de vendas');
    r = await req('adm', 'DELETE', `/api/site/posts/${post.id}`); ok(r.status === 200, 'exclui o artigo');
    // ---- plano Grátis ----
    r = await req('g', 'POST', '/api/saas/cadastro', { nome: 'Gabi', sobrenome: 'Silva', cpf: cpfDe(8), empresa: 'Loja Gabi', email: 'gabi@exemplo.com', senha: 'senha-forte-9', aceite: true, plano: 'gratis' });
    ok(r.status === 200, 'cadastro direto no plano Grátis');
    r = await req('g', 'GET', '/api/saas/eu');
    ok(r.corpo.conta.plano === 'gratis' && r.corpo.conta.situacao.ativa === true && r.corpo.conta.situacao.codigo === 'gratis', 'Grátis nasce ativo, sem teste');
    ok(r.corpo.conta.campanhas.limite === 1 && r.corpo.conta.ia.limite === 3, 'Grátis: 1 campanha e 3 rascunhos de IA por mês');
    ok(Array.isArray(r.corpo.planos) && r.corpo.planos.length === 4 && r.corpo.planos[0].id === 'gratis' && r.corpo.planos.find((x) => x.id === 'solo').campanhas === 10 && r.corpo.planos.find((x) => x.id === 'escala').campanhas === 50, 'lista tem 4 planos e os volumes dos outros não mudaram');
    {
      r = await req('adm', 'GET', '/api/saas/admin/assinantes'); const cg = { id: r.corpo.assinantes.find((x) => x.email === 'gabi@exemplo.com').id };
      await db.query(`UPDATE saas_contas SET trial_ate = now() - interval '30 days' WHERE id=$1`, [cg.id]);
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.situacao.ativa === true, 'Grátis não expira');
      for (let i = 0; i < 1; i++) await db.query(`INSERT INTO saas_campanhas (conta_id, cliente_id, plataforma, spec, status, criada_em, cota_mes) SELECT $1, id, 'google', '{}', 'criada_pausada', now(), $2 FROM saas_clientes WHERE conta_id=$1 AND principal`, [cg.id, new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)]);
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.campanhas.usadas === 1 && r.corpo.conta.campanhas.restantes === 0, 'campanha em qualquer plataforma gasta a cota única');
      for (const [k, v] of [['META_ADS_TOKEN', 'EAAB-token-da-gabi-1234567890abcdef'], ['META_AD_ACCOUNT_ID', '2222222222'], ['META_PAGE_ID', '66666']]) await req('g', 'PUT', '/api/saas/chaves', { chave: k, valor: v });
      r = await req('g', 'POST', '/api/saas/campanhas', { spec: { ...camp.spec, nome: 'Segunda do mês' } }); const g2 = r.corpo.campanha;
      ok(r.status === 200, 'Grátis ainda pode guardar rascunho depois de usar a cota');
      r = await req('g', 'POST', `/api/saas/campanhas/${g2.id}/subir`, { confirmado: true });
      ok(r.status === 402 && r.corpo.codigo === 'limite_campanhas' && /assine um plano/.test(r.corpo.erro) && /a campanha deste mês/.test(r.corpo.erro), 'Grátis: a 2ª campanha do mês trava com 402 e oferece avulsa ou plano');
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.situacao.ativa === true, 'a conta Grátis segue ativa depois de travar (só novas campanhas param)');
      await db.query(`UPDATE saas_campanhas SET cota_mes='2000-01' WHERE conta_id=$1`, [cg.id]);
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.campanhas.restantes === 1, 'no mês seguinte a cota volta a 1');
      await db.query(`UPDATE saas_campanhas SET cota_mes=$2 WHERE conta_id=$1 AND status='criada_pausada'`, [cg.id, new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)]);
      r = await req('g', 'POST', '/api/saas/assinar', {}); ok(r.status === 400, 'conta Grátis precisa escolher um plano pago ao assinar');
      r = await req('g', 'POST', '/api/saas/pix/informar', { tipo: 'mensalidade' }); ok(r.status === 400, 'Pix de mensalidade da conta Grátis exige plano');
      r = await req('g', 'POST', '/api/saas/pix/informar', { tipo: 'mensalidade', plano: 'agencia' }); const pg = r.corpo.pedido;
      ok(r.status === 200 && pg.plano === 'agencia', 'Pix para subir do Grátis ao Agência');
      r = await req('adm', 'POST', `/api/saas/admin/pix/${pg.id}/confirmar`); ok(r.status === 200, 'administradora confirma');
      r = await req('g', 'GET', '/api/saas/eu');
      ok(r.corpo.conta.plano === 'agencia' && r.corpo.conta.situacao.ativa === true && r.corpo.conta.campanhas.limite === 30, 'depois do Pix a conta vira Agência com 30 campanhas');
      // ---- dashboard de KPIs (pacote BI + relatórios) ----
      r = await req('g', 'GET', '/api/saas/dashboard'); ok(r.status === 402 && r.corpo.codigo === 'bi_necessario', 'sem o pacote BI o dashboard pede a assinatura');
      r = await req('g', 'GET', '/api/saas/pix?tipo=bi'); ok(r.status === 200 && r.corpo.valor === 50 && /5405\d*50\.00/.test(r.corpo.payload), 'Pix do BI cobra R$ 50');
      r = await req('g', 'POST', '/api/saas/pix/informar', { tipo: 'bi' }); const pbi = r.corpo.pedido; ok(r.status === 200 && pbi.tipo === 'bi', 'avisa o Pix do BI');
      r = await req('adm', 'POST', `/api/saas/admin/pix/${pbi.id}/confirmar`); ok(r.status === 200, 'administradora libera o BI');
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.bi === true && !!r.corpo.conta.bi_ate && r.corpo.conta.plano === 'agencia', 'BI liberado por 30 dias sem mexer no plano');
      r = await req('g', 'GET', '/api/saas/dashboard?periodo=last_30d');
      const dt = r.corpo.total;
      ok(r.status === 200 && dt.gasto === 150.5 && dt.impressoes === 15000 && dt.cliques === 350, 'dashboard soma investimento, impressões e cliques');
      ok(dt.conversoes === 15 && dt.custo_conversao === 10.03 && dt.ctr === 2.33 && dt.cpc === 0.43, 'conversões sem contar duas vezes a mesma compra; CTR, CPC e custo por conversão');
      ok(r.corpo.campanhas[0].nome === 'Meta Vendas' && r.corpo.plataformas.meta.gasto === 150.5 && r.corpo.plataformas.google.gasto === 0, 'ranking por investimento e divisão por plataforma');
      ok(r.corpo.conectado.meta.ok === true && r.corpo.conectado.google.ok === false && /Google/.test(r.corpo.conectado.google.erro), 'plataforma sem chaves aparece como aviso, sem derrubar o dashboard');
      ok(chamadas().some((c) => c.alvo === 'meta' && /date_preset=last_30d/.test(c.u || '')), 'o período escolhido vai para o Meta');
      r = await req('g', 'GET', '/api/saas/dashboard?periodo=inventado'); ok(r.status === 200 && r.corpo.periodo === 'last_7d', 'período inválido volta para 7 dias');
      r = await req('g', 'POST', '/api/saas/pix/informar', { tipo: 'bi' }); ok(r.status === 200, 'pode renovar o BI por Pix');
      await db.query(`UPDATE saas_contas SET bi_ate = now() - interval '1 day' WHERE id=$1`, [cg.id]);
      r = await req('g', 'GET', '/api/saas/dashboard'); ok(r.status === 402, 'BI vencido volta a pedir renovação');
      r = await req('g', 'GET', '/api/saas/eu'); ok(r.corpo.conta.bi === false, 'BI vencido aparece como desligado');
      r = await req('adm', 'PUT', `/api/saas/admin/assinantes/${cg.id}`, { bi: true });
      r = await req('g', 'GET', '/api/saas/dashboard'); ok(r.status === 200, 'BI liberado pela administradora não vence');
      r = await req('g', 'GET', '/api/saas/pix?tipo=bi'); ok(r.status === 409, 'quem já tem o BI incluído não paga de novo');
      {
        const dsh = require('../dashboard');
        ok(dsh.conversoesMeta([{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'lead', value: '1' }]) === 4 && dsh.conversoesMeta(undefined) === 0, 'conversões do Meta: maior valor por grupo');
        const z = dsh.montar({}); ok(z.total.ctr === null && z.total.custo_conversao === null && z.campanhas.length === 0, 'sem dados: sem divisão por zero');
      }

    }
    // ---- perfil de assinante da administradora ----
    r = await req('a', 'POST', '/api/saas/admin/meu-perfil', {}); ok(r.status === 403, 'assinante não cria perfil de administradora');
    r = await req('adm', 'GET', '/api/saas/eu'); ok(r.status === 403, 'sem perfil, a administradora não entra na área do assinante');
    r = await req('adm', 'POST', '/api/saas/admin/meu-perfil', {});
    ok(r.status === 200 && r.corpo.criada === true && Array.isArray(r.corpo.trazidas) && r.corpo.trazidas.includes('META_ADS_TOKEN'), 'cria o perfil de assinante da administradora');
    r = await req('adm', 'GET', '/api/saas/eu');
    ok(r.status === 200 && r.corpo.conta.admin === true && r.corpo.conta.plano === 'escala' && r.corpo.conta.bi === true && r.corpo.conta.situacao.ativa === true, 'perfil com acesso liberado, plano Escala e BI');
    r = await req('adm', 'POST', '/api/saas/admin/meu-perfil', {}); ok(r.status === 200 && r.corpo.criada === false, 'repetir não duplica o perfil');
    r = await req('adm', 'GET', '/api/saas/admin/assinantes'); const meu = r.corpo.assinantes.find((x) => x.email === 'admin@exemplo.com');
    ok(!!meu, 'o perfil aparece na lista de assinantes');
    r = await req('adm', 'DELETE', `/api/saas/admin/assinantes/${meu.id}`); ok(r.status === 409, 'o perfil da administradora não pode ser excluído');
    r = await req('adm', 'GET', '/api/me'); ok(r.status !== 500, 'o login de administradora continua funcionando');
  } catch (e) {
    console.error('ERRO NO TESTE', e); falhas++;
  }

  console.log(`\n${n - falhas}/${n} verificações passaram`);
  if (falhas) console.log('--- log do servidor ---\n' + saida.split('\n').slice(-25).join('\n'));
  await fim(falhas ? 1 : 0);
})();
