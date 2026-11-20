// Cobrança da mensalidade do SaaS pelo Stripe (Checkout hospedado + portal do cliente + webhook).
// O cartão é digitado na página do Stripe: este sistema nunca vê nem guarda número de cartão.
// Variáveis: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (preço mensal recorrente), STRIPE_WEBHOOK_SECRET.

const crypto = require('crypto');

const API = process.env.STRIPE_API_URL || 'https://api.stripe.com/v1';
// Preço de cada plano: STRIPE_PRICE_SOLO, STRIPE_PRICE_AGENCIA, STRIPE_PRICE_ESCALA (e STRIPE_PRICE_BI para o pacote BI + relatórios).
// Sem o preço do plano, cai no STRIPE_PRICE_ID (preço único).
const precoDoPlano = (plano) => process.env[`STRIPE_PRICE_${String(plano || '').toUpperCase()}`] || process.env.STRIPE_PRICE_ID || '';
const configurado = () => !!(process.env.STRIPE_SECRET_KEY && (process.env.STRIPE_PRICE_ID || process.env.STRIPE_PRICE_SOLO || process.env.STRIPE_PRICE_AGENCIA || process.env.STRIPE_PRICE_ESCALA));
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Stripe usa corpo form-encoded com chaves aninhadas: a[b][0]=c
function achatar(obj, prefixo = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (typeof v === 'object') achatar(v, chave, out); else out.append(chave, String(v));
  }
  return out;
}

async function stripe(caminho, corpo) {
  if (!process.env.STRIPE_SECRET_KEY) throw erro('A cobrança ainda não está configurada. Fale com o administrador.', 503);
  let r;
  try {
    r = await fetch(`${API}/${caminho}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: achatar(corpo), signal: AbortSignal.timeout(20000),
    });
  } catch { throw erro('Não consegui falar com o Stripe agora. Tente de novo.', 504); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Erro do Stripe', r.status, d.error?.message); throw erro('O Stripe recusou o pedido. Tente de novo ou fale com o administrador.', 502); }
  return d;
}

async function criarCheckout({ conta, email, base }) {
  const preco = precoDoPlano(conta.plano);
  if (!preco) throw erro('A cobrança ainda não está configurada. Fale com o administrador.', 503);
  const itens = [{ price: preco, quantity: 1 }];
  if (conta.bi && process.env.STRIPE_PRICE_BI) itens.push({ price: process.env.STRIPE_PRICE_BI, quantity: 1 });
  const corpo = {
    mode: 'subscription', locale: 'pt-BR',
    line_items: itens,
    success_url: `${base}/assinante?assinatura=ok`, cancel_url: `${base}/assinante?assinatura=cancelada`,
    client_reference_id: String(conta.id), allow_promotion_codes: 'true', metadata: { plano: conta.plano },
    subscription_data: { metadata: { conta_id: String(conta.id), plano: conta.plano } },
  };
  if (conta.stripe_customer_id) corpo.customer = conta.stripe_customer_id; else corpo.customer_email = email;
  const s = await stripe('checkout/sessions', corpo);
  return s.url;
}

// Campanhas avulsas: pagamento único (R$ por campanha x quantidade), com preço definido na hora, sem precisar cadastrar produto no Stripe
async function criarCheckoutAvulsa({ conta, email, base, quantidade, precoCentavos }) {
  const corpo = {
    mode: 'payment', locale: 'pt-BR',
    line_items: [{ quantity: quantidade, price_data: { currency: 'brl', unit_amount: precoCentavos, product_data: { name: 'Campanha avulsa MidIAut', description: 'Uma campanha a mais, além do limite mensal do seu plano. Não vence.' } } }],
    success_url: `${base}/assinante?avulsas=ok`, cancel_url: `${base}/assinante?avulsas=cancelada`,
    client_reference_id: String(conta.id),
    metadata: { conta_id: String(conta.id), tipo: 'campanhas_avulsas', quantidade: String(quantidade) },
    payment_intent_data: { metadata: { conta_id: String(conta.id), tipo: 'campanhas_avulsas' } },
  };
  if (conta.stripe_customer_id) corpo.customer = conta.stripe_customer_id; else corpo.customer_email = email;
  const s = await stripe('checkout/sessions', corpo);
  return s.url;
}

async function criarPortal({ conta, base }) {
  if (!conta.stripe_customer_id) throw erro('Você ainda não tem uma assinatura para gerenciar.');
  const s = await stripe('billing_portal/sessions', { customer: conta.stripe_customer_id, return_url: `${base}/assinante` });
  return s.url;
}

// Confere a assinatura do webhook (cabeçalho Stripe-Signature: t=...,v1=...) com tolerância de 5 minutos
function conferirAssinatura(corpoBruto, cabecalho, segredo, agora = Date.now()) {
  if (!segredo || !cabecalho || !corpoBruto) return false;
  const partes = Object.fromEntries(String(cabecalho).split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const t = Number(partes.t);
  if (!t || Math.abs(agora / 1000 - t) > 300) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(`${t}.${corpoBruto.toString('utf8')}`).digest('hex');
  const recebidos = String(cabecalho).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return recebidos.some((v) => v.length === esperado.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(esperado)));
}

// Situação da assinatura no Stripe -> situação da conta
const STATUS = { active: 'ativa', trialing: 'ativa', past_due: 'inadimplente', unpaid: 'inadimplente', canceled: 'cancelada', incomplete_expired: 'cancelada' };
const periodoFim = (sub) => {
  const t = sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
};

// Aplica um evento do Stripe no banco. Devolve a conta afetada (ou null se o evento não interessa).
async function aplicarEvento(pool, ev) {
  const o = ev.data?.object || {};
  const achar = async () => {
    const meta = o.metadata?.conta_id || o.subscription_details?.metadata?.conta_id || o.client_reference_id;
    if (meta && /^\d+$/.test(String(meta))) {
      const { rows: [c] } = await pool.query('SELECT * FROM saas_contas WHERE id=$1', [Number(meta)]);
      if (c) return c;
    }
    const cliente = typeof o.customer === 'string' ? o.customer : o.customer?.id;
    if (cliente) { const { rows: [c] } = await pool.query('SELECT * FROM saas_contas WHERE stripe_customer_id=$1', [cliente]); return c || null; }
    return null;
  };
  const conta = await achar();
  if (!conta) return null;
  const evento = (tipo, detalhe) => pool.query('INSERT INTO saas_eventos (conta_id, tipo, detalhe) VALUES ($1,$2,$3)', [conta.id, tipo, detalhe]);

  const avulsa = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type) && o.mode === 'payment' && o.metadata?.tipo === 'campanhas_avulsas';
  if (avulsa) {
    const qtd = Number(o.metadata.quantidade);
    if (o.payment_status !== 'paid' || !Number.isInteger(qtd) || qtd < 1 || qtd > 100) return conta; // pagamento ainda pendente: o Stripe avisa de novo quando cair
    const minimo = qtd * (Number(process.env.SAAS_PRECO_AVULSA || 15) * 100);
    if (Number(o.amount_total) < minimo) { console.error('Compra avulsa com valor menor que o esperado', o.id); return conta; }
    const { rows } = await pool.query('INSERT INTO saas_compras (session_id, conta_id, quantidade, valor_centavos) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1', [o.id, conta.id, qtd, Number(o.amount_total)]);
    if (rows.length) { // evento repetido do Stripe não credita duas vezes
      await pool.query('UPDATE saas_contas SET campanhas_extras = campanhas_extras + $2, updated_at=now() WHERE id=$1', [conta.id, qtd]);
      await evento('campanhas_avulsas', `${qtd} campanha(s) avulsa(s) paga(s)`);
    }
  } else if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
    await pool.query(`UPDATE saas_contas SET stripe_customer_id=COALESCE($2,stripe_customer_id), stripe_subscription_id=COALESCE($3,stripe_subscription_id),
        plano = CASE WHEN $4 IN ('solo','agencia','escala') THEN $4 ELSE plano END, updated_at=now() WHERE id=$1`,
      [conta.id, typeof o.customer === 'string' ? o.customer : null, typeof o.subscription === 'string' ? o.subscription : null, o.metadata?.plano || null]);
    await evento('assinatura_iniciada', 'Checkout concluído');
  } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(ev.type)) {
    // "bloqueada" é decisão do administrador: o Stripe não reativa
    const status = ev.type === 'customer.subscription.deleted' ? 'cancelada' : (STATUS[o.status] || null);
    if (status) {
      await pool.query(
        `UPDATE saas_contas SET status = CASE WHEN status='bloqueada' THEN status ELSE $2 END, periodo_fim=COALESCE($3,periodo_fim),
           stripe_customer_id=COALESCE($4,stripe_customer_id), stripe_subscription_id=$5, updated_at=now() WHERE id=$1`,
        [conta.id, status, periodoFim(o), typeof o.customer === 'string' ? o.customer : null, o.id]);
      await evento('assinatura_' + status, `Stripe: ${o.status}`);
    }
  } else if (ev.type === 'invoice.payment_failed') {
    await pool.query(`UPDATE saas_contas SET status = CASE WHEN status IN ('ativa','trial') THEN 'inadimplente' ELSE status END, updated_at=now() WHERE id=$1`, [conta.id]);
    await evento('pagamento_falhou', 'Falha na cobrança da mensalidade');
  } else if (ev.type === 'invoice.paid') {
    await pool.query(`UPDATE saas_contas SET status = CASE WHEN status IN ('inadimplente','trial') THEN 'ativa' ELSE status END, updated_at=now() WHERE id=$1`, [conta.id]);
    await evento('pagamento_ok', 'Mensalidade paga');
  } else return null;
  return conta;
}

module.exports = { configurado, criarCheckout, criarCheckoutAvulsa, criarPortal, conferirAssinatura, aplicarEvento, STATUS };
