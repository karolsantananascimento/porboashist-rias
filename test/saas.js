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
const jar = {};
async function req(quem, metodo, caminho, corpo, extra = {}) {
  const headers = { 'content-type': 'application/json', ...(jar[quem] ? { cookie: jar[quem] } : {}), ...(extra.headers || {}) };
  const r = await fetch(`http://127.0.0.1:${PORTA}${caminho}`, { method: metodo, headers, body: extra.bruto ?? (corpo ? JSON.stringify(corpo) : undefined), redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && quem) jar[quem] = sc.split(';')[0];
  const t = await r.text(); let c = {}; try { c = t ? JSON.parse(t) : {}; } catch { c = { raw: t }; }
  return { status: r.status, corpo: c, loc: r.headers.get('location') };
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
      ACESSOS_KEY: Buffer.alloc(32, 9).toString('base64'), SESSION_SECRET: 'segredo-de-teste', ADMIN_EMAIL: 'admin@exemplo.com', ADMIN_PASSWORD: 'senhaadmin123',
      ANTHROPIC_API_KEY: 'chave-claude-admin', META_ADS_TOKEN: TOKEN_ADMIN, META_AD_ACCOUNT_ID: 'act_999', META_PAGE_ID: '999',
      STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: WH, SAAS_IA_MES: '3', SAAS_PRECO_TEXTO: 'R$ 97/mês',
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
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', email: 'ana@exemplo.com', senha: 'abc', aceite: true });
    ok(r.status === 400 && /8 caracteres/.test(r.corpo.erro), 'senha curta é recusada');
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', email: 'ana@exemplo.com', senha: 'senha-forte-1' });
    ok(r.status === 400 && /termos/.test(r.corpo.erro), 'sem aceitar os termos não cria conta');
    r = await req('a', 'POST', '/api/saas/cadastro', { nome: 'Ana', empresa: 'Clínica Ana', email: 'ana@exemplo.com', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 200 && jar.a, 'cadastro cria a conta e já entra');
    r = await req('b', 'POST', '/api/saas/cadastro', { nome: 'Bruno', empresa: 'Loja Bruno', email: 'bruno@exemplo.com', senha: 'senha-forte-2', aceite: true });
    ok(r.status === 200, 'segundo assinante criado');
    r = await req(null, 'POST', '/api/saas/cadastro', { nome: 'Ana', email: 'ANA@exemplo.com', senha: 'senha-forte-1', aceite: true });
    ok(r.status === 409, 'e-mail repetido (mesmo em maiúsculas) é recusado');
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
    r = await req('adm', 'GET', '/api/saas/chaves');
    ok(r.status === 403, 'rotas do assinante não abrem para o administrador');
    r = await req('adm', 'GET', '/api/saas/admin/assinantes');
    ok(r.status === 200 && r.corpo.assinantes.length === 2, 'administrador lista os assinantes');
    const idA = r.corpo.assinantes.find((x) => x.email === 'ana@exemplo.com').id; const idB = r.corpo.assinantes.find((x) => x.email === 'bruno@exemplo.com').id;

    console.log('Chaves de API');
    r = await req('a', 'GET', '/api/saas/chaves');
    const campos = r.corpo.grupos.flatMap((g) => g.campos);
    ok(r.status === 200 && r.corpo.grupos.length === 2 && campos.every((c) => c.ajuda && c.ajuda.passos.length), 'todo campo tem o "?" com passo a passo');
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
  } catch (e) {
    console.error('ERRO NO TESTE', e); falhas++;
  }

  console.log(`\n${n - falhas}/${n} verificações passaram`);
  if (falhas) console.log('--- log do servidor ---\n' + saida.split('\n').slice(-25).join('\n'));
  await fim(falhas ? 1 : 0);
})();
