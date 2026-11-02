const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');
const seed = require('./seed/october.json');
const trello = require('./seed/clientes-trello.json');
const { lerExperiencias } = require('./experiencias');

// Datas (DATE) voltam como texto 'AAAA-MM-DD', sem conversão de fuso.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
});

// Schema próprio (ex.: Supabase, para não expor as tabelas na API pública)
const SCHEMA_NAME = process.env.DB_SCHEMA;
if (SCHEMA_NAME) {
  if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA_NAME)) throw new Error('DB_SCHEMA inválido');
  pool.on('connect', (client) => client.query(`SET search_path TO ${SCHEMA_NAME}`));
}

const STATUSES =['pauta', 'conteudo', 'design', 'revisao', 'aprovacao', 'agendado', 'publicado'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  marcas JSONB NOT NULL DEFAULT '[]',
  site TEXT,
  whatsapp TEXT,
  instagram TEXT,
  meta_posts INT NOT NULL DEFAULT 12,
  meta_stories_dia INT NOT NULL DEFAULT 1,
  meta_blog INT NOT NULL DEFAULT 4,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'post',          -- post | story | blog | captacao | outro
  formato TEXT,                               -- estático | carrossel | reels | story | artigo ...
  data DATE,
  editorial TEXT,
  tema TEXT,
  legenda TEXT,
  briefing TEXT,
  links TEXT,
  status TEXT NOT NULL DEFAULT 'pauta',
  responsavel TEXT,
  prioridade TEXT NOT NULL DEFAULT 'normal',  -- baixa | normal | alta
  palavra_chave TEXT,
  checklist JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_client_data ON tasks (client_id, data);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'membro',      -- admin | membro
  ativo BOOLEAN NOT NULL DEFAULT true,
  trocar_senha BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS convite_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS convite_expira TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS planilha_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS planilha_sync TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS experiencias (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  secao TEXT,
  ordem INT NOT NULL DEFAULT 0,
  periodo TEXT,
  nome TEXT NOT NULL,
  resort TEXT NOT NULL,
  descricao TEXT,
  horario TEXT,
  local TEXT,
  incluso TEXT,
  preco TEXT,
  observacoes TEXT,
  status TEXT,
  task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
  UNIQUE (client_id, nome, resort, periodo)
);

CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  categoria TEXT,
  observacao TEXT,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acessos (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  servico TEXT NOT NULL,
  url TEXT,
  usuario TEXT,
  senha_enc TEXT,
  observacao TEXT,
  restrito BOOLEAN NOT NULL DEFAULT true,   -- true: só administradores veem
  ordem INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seeds (chave TEXT PRIMARY KEY, aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now());

-- Agente de conteúdo: contexto de cada cliente e histórico do que foi gerado
CREATE TABLE IF NOT EXISTS contexto_cliente (
  client_id INT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  tom_de_voz TEXT,
  publico TEXT,
  pilares TEXT,
  regras TEXT,
  rodape TEXT,
  exemplos TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contexto_cliente ADD COLUMN IF NOT EXISTS conhecimento TEXT;

CREATE TABLE IF NOT EXISTS conteudos_gerados (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_id INT,
  tipo TEXT NOT NULL,
  entrada JSONB,
  saida JSONB,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',   -- rascunho | usado
  texto_final TEXT,
  usuario_id INT,
  modelo TEXT,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conteudos_cliente_tipo ON conteudos_gerados (client_id, tipo, status, created_at DESC);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  categoria TEXT,
  descricao TEXT,
  url TEXT NOT NULL,
  evitar BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quadros da home: pautas em A fazer / Em andamento / Finalizado
CREATE TABLE IF NOT EXISTS pautas_home (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coluna TEXT NOT NULL DEFAULT 'fazer',       -- fazer | andamento | finalizado
  nome TEXT NOT NULL,
  link_pauta TEXT,
  link_imagens TEXT,
  descricao TEXT,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pautas_home_cliente ON pautas_home (client_id, coluna, ordem);

-- Projetos: agrupam clientes/marcas (A Melhor Mídia do Brasil, Otter, Disco, Lumiére...)
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  cor TEXT NOT NULL DEFAULT '#b3202a',
  descricao TEXT,
  contexto TEXT,                               -- identidade, tom de voz e regras que os agentes seguem
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;

-- Tabelas abaixo não têm chave estrangeira para clients (o restore de backup trunca clients)
CREATE TABLE IF NOT EXISTS criacoes (
  id SERIAL PRIMARY KEY,
  project_id INT,
  client_id INT,
  agente TEXT NOT NULL,
  formato TEXT,
  pedido TEXT,
  saida TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',     -- rascunho | aprovado
  usuario_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS criacoes_projeto ON criacoes (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mensagens (
  id SERIAL PRIMARY KEY,
  project_id INT,
  canal TEXT NOT NULL DEFAULT 'manual',        -- instagram | facebook | manual
  page_id TEXT,
  remetente_id TEXT,
  remetente_nome TEXT,
  texto TEXT NOT NULL,
  resposta TEXT,
  status TEXT NOT NULL DEFAULT 'nova',         -- nova | respondida | ignorada
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondida_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vagas (
  id SERIAL PRIMARY KEY,
  plataforma TEXT,
  titulo TEXT NOT NULL,
  empresa TEXT,
  url TEXT,
  descricao TEXT,
  orcamento TEXT,
  status TEXT NOT NULL DEFAULT 'nova',         -- nova | salva | candidatado | descartada
  analise TEXT,
  proposta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guia de marca (a "skill" do designer) por projeto e por cliente; marca_propria = o cliente é a própria marca do projeto
ALTER TABLE projects ADD COLUMN IF NOT EXISTS guia_design TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS canva_kit_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS canva_kit_nome TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS guia_design TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS marca_propria BOOLEAN NOT NULL DEFAULT false;

-- Esteira: o time executa a demanda, ela fica aguardando aprovação e, aprovada, segue para publicação
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS esteira TEXT;          -- executando | aguardando_aprovacao | aprovada | publicada | erro
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS esteira_msg TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS esteira_em TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS aprovado_por TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;

-- Relatórios gerados por período
CREATE TABLE IF NOT EXISTS relatorios (
  id SERIAL PRIMARY KEY,
  project_id INT,
  client_id INT,
  de DATE NOT NULL,
  ate DATE NOT NULL,
  dados JSONB NOT NULL DEFAULT '{}',
  resumo TEXT,
  usuario TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tipo de projeto: 'padrao' (clientes e tarefas) ou 'empregos' (vagas e candidaturas, sem tarefas)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'padrao';

-- Canva: kit de marca por projeto e link da arte nas tarefas e criações
ALTER TABLE projects ADD COLUMN IF NOT EXISTS canva_kit_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS canva_kit_nome TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS arte_url TEXT;
ALTER TABLE criacoes ADD COLUMN IF NOT EXISTS arte_url TEXT;

-- Janela de solicitações de cada projeto
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_solicitacao TEXT;
CREATE TABLE IF NOT EXISTS solicitacoes (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  client_id INT,
  titulo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'outro',          -- conteudo | arte | video | campanha | mensagem | outro
  descricao TEXT,
  solicitante TEXT,
  contato TEXT,
  prazo DATE,
  prioridade TEXT NOT NULL DEFAULT 'normal',   -- baixa | normal | alta
  status TEXT NOT NULL DEFAULT 'nova',         -- nova | andamento | concluida | cancelada
  origem TEXT NOT NULL DEFAULT 'interna',      -- interna | formulario
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solicitacoes_projeto ON solicitacoes (project_id, status, created_at DESC);
ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS task_id INT;

-- Contas conectadas (tokens criptografados) e histórico de publicações
CREATE TABLE IF NOT EXISTS conexoes (
  provedor TEXT PRIMARY KEY,                   -- meta | linkedin
  dados_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publicacoes (
  id SERIAL PRIMARY KEY,
  plataforma TEXT NOT NULL,
  texto TEXT,
  imagem_url TEXT,
  externo_id TEXT,
  status TEXT NOT NULL,                        -- publicado | erro
  erro TEXT,
  usuario_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Integrações, mensagens e chaves por cliente (client_id 0 = padrão do sistema)
ALTER TABLE conexoes ADD COLUMN IF NOT EXISTS client_id INT NOT NULL DEFAULT 0;
ALTER TABLE conexoes DROP CONSTRAINT IF EXISTS conexoes_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS conexoes_prov_cli ON conexoes (provedor, client_id);
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS client_id INT NOT NULL DEFAULT 0;
ALTER TABLE configuracoes DROP CONSTRAINT IF EXISTS configuracoes_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_chave_cli ON configuracoes (chave, client_id);
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS client_id INT;
ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS client_id INT;
CREATE TABLE IF NOT EXISTS meta_paginas (page_id TEXT PRIMARY KEY, client_id INT NOT NULL);

CREATE TABLE IF NOT EXISTS perfil_profissional (
  id INT PRIMARY KEY DEFAULT 1,
  dados JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const BLOG_CHECKLIST = [
  'Definir palavra-chave principal e secundárias',
  'Briefing / estrutura do artigo (H1, H2, H3)',
  'Redação do texto',
  'Title (até 60 caracteres) e meta description (até 155)',
  'Imagens com texto alternativo (alt)',
  'Links internos para páginas de reserva e apartamentos',
  'Revisão',
  'Publicação e envio para indexação',
];

const CAPTACOES = [
  {
    tema: 'Mais fotos e vídeos da Villa de Muro Alto',
    itens: [
      'Fotos de hóspedes passeando',
      'Fotos dos restaurantes',
      'Eventos durante o dia',
      'Vídeos rodando pela Villa',
      'Vídeos da recepção dos restaurantes até o interior',
    ],
  },
  {
    tema: 'Fotos de passeio de buggy pela praia de Muro Alto',
    itens: ['Fotos do passeio de buggy pela praia de Muro Alto'],
  },
  {
    tema: 'Mais fotos de hóspedes pela praia de Muro Alto',
    itens: [
      'Famílias brincando próximo às águas',
      'Casais nos guarda-sóis',
      'Mais imagens próximas na Piscina Natural',
    ],
  },
];

const check = (itens) => itens.map((texto) => ({ texto, feito: false }));

async function insertTask(c, t) {
  await c.query(
    `INSERT INTO tasks (client_id,tipo,formato,data,editorial,tema,legenda,briefing,links,status,prioridade,checklist)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [t.client_id, t.tipo, t.formato || null, t.data || null, t.editorial || null, t.tema || null,
      t.legenda || null, t.briefing || null, t.links || null, t.status || 'pauta',
      t.prioridade || 'normal', JSON.stringify(t.checklist || [])]
  );
}

async function seedIfEmpty(c) {
  const { rows } = await c.query('SELECT count(*)::int AS n FROM clients');
  if (rows[0].n > 0) return;

  const { rows: [cl] } = await c.query(
    `INSERT INTO clients (nome, marcas, site, whatsapp, meta_posts, meta_stories_dia, meta_blog, observacoes)
     VALUES ($1,$2,$3,$4,12,1,4,$5) RETURNING id`,
    ['La Fleur Collection',
      JSON.stringify(['Samoa Beach Resort', 'Samoa Villa Resort', 'Villa de Muro Alto']),
      'lafleurcollection.com.br',
      '+55 81 8264-9638',
      'Apartamentos completos em Muro Alto (Porto de Galinhas/PE) com acesso à programação dos Resorts Samoa. Rodapé padrão: 📍 Muro Alto — Porto de Galinhas/PE · Reserve: lafleurcollection.com.br · Link na bio · *Programação sujeita a alterações sem aviso prévio.']
  );
  const client_id = cl.id;

  // Posts do feed e editoriais de stories vindos do planejamento de outubro
  const storyEditorial = {};
  for (const p of seed.posts) {
    if (!p.formato) { storyEditorial[p.data] = p.editorial; continue; }
    await insertTask(c, { client_id, tipo: 'post', ...p });
  }

  // Stories diários de outubro
  for (let d = 1; d <= 31; d++) {
    const data = `2026-10-${String(d).padStart(2, '0')}`;
    await insertTask(c, {
      client_id, tipo: 'story', formato: 'story', data,
      editorial: storyEditorial[data] || null, tema: 'Stories do dia',
    });
  }

  // 4 artigos de blog com SEO
  for (const data of ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']) {
    await insertTask(c, {
      client_id, tipo: 'blog', formato: 'artigo', data,
      tema: 'Artigo de blog (SEO) — definir pauta', checklist: check(BLOG_CHECKLIST),
    });
  }

  // Captações prioritárias
  for (const cap of CAPTACOES) {
    await insertTask(c, {
      client_id, tipo: 'captacao', formato: 'captação', tema: cap.tema,
      prioridade: 'alta', checklist: check(cap.itens),
    });
  }

  for (const m of seed.materials) {
    await c.query(
      'INSERT INTO materials (client_id,categoria,descricao,url,evitar) VALUES ($1,$2,$3,$4,$5)',
      [client_id, m.categoria, m.descricao, m.url, !!m.evitar]
    );
  }
}

// ---------- Senhas (scrypt) ----------
const crypto = require('crypto');

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [alg, salt, hash] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === calc.length && crypto.timingSafeEqual(orig, calc);
}

function senhaTemporaria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const pick = (n) => Array.from({ length: n }, () => letras[crypto.randomInt(letras.length)]).join('');
  return `${pick(4)}-${pick(4)}-${crypto.randomInt(10, 100)}`;
}

// Primeiro administrador, criado a partir de ADMIN_EMAIL / ADMIN_PASSWORD quando não há usuários
async function bootstrapAdmin(c) {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD;
  if (!email || !senha) return;
  const { rows } = await c.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  await c.query(
    `INSERT INTO users (email, nome, senha_hash, papel, trocar_senha) VALUES ($1,$2,$3,'admin',true)`,
    [email, process.env.ADMIN_NAME || null, hashSenha(senha)]
  );
  console.log(`Administrador inicial criado: ${email}`);
}

// Grava/atualiza as experiências de um cliente, preservando as pautas já vinculadas
async function salvarExperiencias(c, clientId, lista) {
  const chaves = [];
  for (const e of lista) {
    await c.query(
      `INSERT INTO experiencias (client_id, secao, ordem, periodo, nome, resort, descricao, horario, local, incluso, preco, observacoes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id, nome, resort, periodo) DO UPDATE SET secao=EXCLUDED.secao, ordem=EXCLUDED.ordem,
         descricao=EXCLUDED.descricao, horario=EXCLUDED.horario, local=EXCLUDED.local, incluso=EXCLUDED.incluso,
         preco=EXCLUDED.preco, observacoes=EXCLUDED.observacoes, status=EXCLUDED.status`,
      [clientId, e.secao, e.ordem, e.periodo, e.nome, e.resort, e.descricao, e.horario, e.local, e.incluso, e.preco, e.observacoes, e.status]);
    chaves.push(`${e.nome}\u0001${e.resort}\u0001${e.periodo || ''}`);
  }
  await c.query(
    `DELETE FROM experiencias WHERE client_id=$1 AND NOT (nome || chr(1) || resort || chr(1) || coalesce(periodo,'') = ANY($2))`,
    [clientId, chaves]);
}

// Dados adicionados depois da primeira versão (aplicados uma única vez)
async function seedsIncrementais(c) {
  const aplicar = async (chave, fn) => {
    const { rowCount } = await c.query('INSERT INTO seeds (chave) VALUES ($1) ON CONFLICT DO NOTHING', [chave]);
    if (rowCount) await fn();
  };

  await aplicar('experiencias_lafleur_v1', async () => {
    const { rows: [lf] } = await c.query(`SELECT id FROM clients WHERE nome='La Fleur Collection'`);
    if (!lf) return;
    await c.query('UPDATE clients SET planilha_url=$1 WHERE id=$2',
      ['https://docs.google.com/spreadsheets/d/1oRIPrVLTZEY4xlqvNIl8W9nBK0X_hxkuA0WHrgFJf6I/edit?gid=1478707839#gid=1478707839', lf.id]);
    const csv = fs.readFileSync(path.join(__dirname, 'seed', 'experiencias-samoa.csv'), 'utf8');
    await salvarExperiencias(c, lf.id, lerExperiencias(csv));
  });

  // Regras que a Karolina já definiu para a La Fleur; tom de voz e público ficam para a equipe preencher
  await aplicar('contexto_lafleur_v1', async () => {
    const { rows: [lf] } = await c.query(`SELECT id, observacoes FROM clients WHERE nome='La Fleur Collection'`);
    if (!lf) return;
    await c.query(
      `INSERT INTO contexto_cliente (client_id, regras, rodape) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [lf.id,
        'Os hóspedes de cada unidade La Fleur têm direito à programação do resort onde estão hospedados (Samoa Villa ou Samoa Beach). Sempre incluir o aviso: Programação sujeita a alterações sem aviso prévio.',
        '📍 Muro Alto — Porto de Galinhas/PE · Reserve: lafleurcollection.com.br · Link na bio · *Programação sujeita a alterações sem aviso prévio.']);
  });

  // Conhecimento da La Fleur extraído dos textos aprovados no planejamento de outubro e do cadastro do cliente.
  // Só preenche o que ainda estiver vazio, sem sobrescrever o que a equipe já editou.
  await aplicar('contexto_lafleur_v2', async () => {
    const { rows: [lf] } = await c.query(`SELECT id FROM clients WHERE nome='La Fleur Collection'`);
    if (!lf) return;
    const padrao = {
      tom_de_voz: 'Acolhedor e elegante, em frases curtas e claras. Fala de hospitalidade, família e tempo bem aproveitado, sem gírias e com poucos emojis (o 📍 no rodapé). Abre com uma ideia simples e humana, explica o benefício e fecha convidando a reservar. (Extraído dos textos aprovados em outubro; revise.)',
      publico: 'Famílias com crianças, casais e grupos que querem viajar para Porto de Galinhas/PE com conforto e liberdade; também leitores interessados em investir em apartamentos em Muro Alto.',
      pilares: 'Experiência do cliente / hospedagens\nProgramação dos Resorts Samoa\nDatas especiais\nDicas de conteúdos para hóspedes e investidores',
      conhecimento: [
        'La Fleur Collection oferece apartamentos completos em Muro Alto (Porto de Galinhas/PE), com acesso à programação dos Resorts Samoa.',
        'Marcas: Samoa Beach Resort, Samoa Villa Resort e Villa de Muro Alto.',
        'Os apartamentos têm de 2 a 3 quartos (quartos separados) e cozinha completa/equipada.',
        'Há opções de pensão completa e meia pensão.',
        'O hóspede de cada unidade La Fleur aproveita a programação do resort em que está hospedado (Samoa Beach ou Samoa Villa).',
        'A programação dos resorts inclui recreação monitorada, oficinas, aulas fitness (yoga, hidro, funcional), música ao vivo e pool party.',
        'Samuka e a Ilha dos Pequenos Exploradores aparecem na programação infantil da Semana da Criança nos Resorts Samoa.',
        'Muro Alto é descrita nos textos do cliente como uma das praias mais bonitas da América Latina.',
        'Reservas: lafleurcollection.com.br ou WhatsApp +55 81 8264-9638.',
        'Detalhes de datas, horários e preços só podem ser usados quando estiverem na planilha de programação como confirmados.',
      ].join('\n'),
    };
    await c.query(
      `INSERT INTO contexto_cliente (client_id, tom_de_voz, publico, pilares, conhecimento) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id) DO UPDATE SET
         tom_de_voz = COALESCE(NULLIF(contexto_cliente.tom_de_voz,''), EXCLUDED.tom_de_voz),
         publico = COALESCE(NULLIF(contexto_cliente.publico,''), EXCLUDED.publico),
         pilares = COALESCE(NULLIF(contexto_cliente.pilares,''), EXCLUDED.pilares),
         conhecimento = COALESCE(NULLIF(contexto_cliente.conhecimento,''), EXCLUDED.conhecimento)`,
      [lf.id, padrao.tom_de_voz, padrao.publico, padrao.pilares, padrao.conhecimento]);
  });

  await aplicar('clientes_marilia_laura_v1', async () => {
    const clientes = [
      ['Marília', 'marilia', 'Quadro original no Trello: "Boas Histórias com Marília". Conteúdos de oftalmologia e blefaroplastia.'],
      ['Laura', 'laura', 'Quadro original no Trello: "Boas Histórias com Laura". Conteúdos sobre NR-1, gestão de riscos psicossociais e Metodologia/Plataforma Farol Psicossocial.'],
    ];
    for (const [nome, chave, obs] of clientes) {
      const { rows: [cl] } = await c.query(
        `INSERT INTO clients (nome, marcas, meta_posts, meta_stories_dia, meta_blog, observacoes) VALUES ($1,'[]',12,0,0,$2) RETURNING id`,
        [nome, obs]);
      for (const t of trello[chave]) {
        await insertTask(c, { ...t, client_id: cl.id, tipo: t.tipo || 'post' });
      }
    }
  });
}

// Projetos e clientes vindos do que já estava cadastrado (aplicado uma única vez)
const PROJETOS_INICIAIS = [
  ['A Melhor Mídia do Brasil', '#b3202a',
    'Marca-mãe e central de criação. Conteúdo próprio da A Melhor Mídia do Brasil.',
    'Identidade visual: vermelho, preto e creme, referências de xadrez e teatro, tipografia bold. Tom de voz, público e regras: complete em Projetos > editar contexto.'],
  ['Por Boas Histórias', '#8a5a44',
    'Agência de conteúdo: La Fleur Collection (Resorts Samoa), Marília e Laura. Tudo o que já existia no sistema está aqui.',
    'Hospitalidade e turismo (La Fleur) e saúde/gestão (Marília e Laura). O contexto detalhado de cada cliente fica em Contratos > Contexto do agente.'],
  ['Disco', '#1f8a4c',
    'Disco Criativo (conteúdo), Disco Mídia (tráfego e aquisição) e Disco Tech (SaaS), com os clientes atendidos pela squad.',
    'Posicionamento: agência de marketing, conteúdo e tecnologia. Tagline: Estratégia • Design • Conteúdo. Conteúdo informa com autoridade sobre marketing e atrai clientes com storytelling e roteiros autorais (sem dancinhas e formatos virais genéricos). Marca preto e verde, fontes Anton e Inter; nas redes sociais usa estilo CLARO (fundo off-white, título preto com a palavra-chave em verde). Cada cliente tem identidade, tom e estilo próprios.'],
  ['Otter', '#1d4e89',
    'Agência Otter (produção cultural em Pernambuco) e demais empresas do Grupo Otter, como a Contrafluxo Pratas.',
    'Grupo Otter: ecossistema de empresas de Karolina. Cultura e produção em Pernambuco; Contrafluxo Pratas vende joias em prata.'],
  ['Lumiére', '#b8860b', 'Projeto Lumiére (Lumiere).', 'Contexto ainda não preenchido: complete identidade, tom e público.'],
  ['Marconi Car', '#3a3f47', 'Projeto Marconi Car.', 'Contexto ainda não preenchido: complete identidade, tom e público.'],
];

// [cliente, projeto, posts/mês, observações]
const CLIENTES_INICIAIS = [
  ['A Melhor Mídia do Brasil', 'A Melhor Mídia do Brasil', 12, 'Conteúdo da própria marca.'],
  ['Disco', 'Disco', 8, 'O Disco Criativo / Disco Mídia (@bydiscomidia). Cadência: 2 posts por semana.'],
  ['Operizy', 'Disco', 30, 'Contrato anual com início em 09/10/2026. Cadência: 1 post por dia.'],
  ['Senhorita Moça', 'Disco', 12, 'Boutique de moda feminina em Candeias. Cadência: 3 posts por semana. CTA padrão: Acesse www.senhoritamoca.com.br ou link na bio.'],
  ['Michie Farfan', 'Disco', 8, 'Cadência: 2 posts por semana.'],
  ['Agência Otter', 'Otter', 8, 'Produção cultural em Pernambuco.'],
  ['Contrafluxo Pratas', 'Otter', 8, 'Loja de joias em prata. Cadência: 2 posts por semana.'],
  ['Lumiere', 'Lumiére', 8, 'Cadência: 2 posts por semana.'],
  ['Marconi Car', 'Marconi Car', 12, ''],
];

const PERFIL_INICIAL = {
  nome: 'Karolina Nascimento', email: 'knasck@gmail.com', telefone: '', cidade: 'Recife, Pernambuco',
  linkedin: '', portfolio: '',
  headline: 'Head de Growth e CRM · Gestora de Tráfego · 15 anos em mídia paga, programática, CRM e automação',
  resumo: 'Profissional de marketing com 15 anos de experiência em mídia paga, publicidade programática, arquitetura de CRM, automação, growth marketing e produção cultural. Head de Growth e CRM na AudiGrowth (consultoria de AdOps programático), fundadora da Agência Otter e gestora de tráfego.',
  experiencias: 'Head de Growth e CRM — AudiGrowth\nFundadora e gestora de tráfego — Agência Otter (Pernambuco)\nDiretora de Marketing (CMO) — Ativos Precatórios (2026)\nCoordenadora de Growth — GoKursos / Grupo Ser Educacional\nGestora sênior de performance — Grupo Ser Educacional\nZoho Corporation LATAM · Sport Club do Recife · E-brands · Ortoestética (Grupo Salute) · Aposta Ganha · Agência LeanX · Agência Reality',
  formacao: 'Marketing — UNIBRA\nMBA — IBMEC (em andamento)',
  idiomas: '', pretensao: '', disponibilidade: '',
  observacoes: 'Complete os campos em branco: a Bianca só usa o que estiver aqui.',
};

async function seedProjetos(c) {
  const ids = {};
  let ordem = 0;
  for (const [nome, cor, descricao, contexto] of PROJETOS_INICIAIS) {
    const { rows: [p] } = await c.query(
      `INSERT INTO projects (nome, cor, descricao, contexto, ordem) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (nome) DO UPDATE SET nome=EXCLUDED.nome RETURNING id`,
      [nome, cor, descricao, contexto, ordem++]);
    ids[nome] = p.id;
  }
  // Tudo o que já existia no sistema (La Fleur, Marília, Laura...) passa a ser do projeto Por Boas Histórias
  await c.query('UPDATE clients SET project_id=$1 WHERE project_id IS NULL', [ids['Por Boas Histórias']]);
  for (const [nome, projeto, posts, obs] of CLIENTES_INICIAIS) {
    const { rows: ja } = await c.query('SELECT id FROM clients WHERE lower(nome)=lower($1)', [nome]);
    if (ja.length) { await c.query('UPDATE clients SET project_id=COALESCE(project_id,$1) WHERE id=$2', [ids[projeto], ja[0].id]); continue; }
    const { rows: [cl] } = await c.query(
      `INSERT INTO clients (nome, marcas, meta_posts, meta_stories_dia, meta_blog, observacoes, project_id)
       VALUES ($1,'[]',$2,0,0,$3,$4) RETURNING id`, [nome, posts, obs, ids[projeto]]);
    if (nome === 'Senhorita Moça') {
      await c.query(`INSERT INTO contexto_cliente (client_id, rodape) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [cl.id, 'Acesse www.senhoritamoca.com.br ou link na bio.']);
    }
  }
  await c.query(`INSERT INTO perfil_profissional (id, dados) VALUES (1,$1) ON CONFLICT DO NOTHING`, [JSON.stringify(PERFIL_INICIAL)]);
}


const GUIA_MELHOR_MIDIA = `MARCA: A Melhor Mídia do Brasil (monograma MM). Posicionamento: marketing, estratégia, tecnologia, negócios e IA com direção e intenção. Conceito visual: estratégia como jogo de alto nível (xadrez, roleta, cartas, dados) e palco/teatro (cortinas, spotlight, cabaré), com rigor técnico. Ousadia controlada; autoridade com estilo; nada de "agência fofa". Mensagem central: "Estratégia não é sorte."

PALETA (use exatamente, só estas cores): Vinho profundo #800010 (atmosfera), Vermelho MM #D3121F (assinatura, ponto de foco), Creme #F6E8DB (papel, texto sobre escuro), Preto #0B0B0B (fundo dominante, texto sobre claro), Cinza prata #C0C0C0 (apoio, linhas finas). Proporção: 60-70% preto ou creme; vermelho em 15-25% como ponto de foco (uma palavra, uma barra, um objeto). Nunca azul, verde, roxo, neon ou degradê colorido. Fundos escuros: vinheta vermelha lateral discreta e granulação leve.

LOGO: dois M sobrepostos, M grande vermelho (#D3121F) e M menor preto (#0B0B0B) por baixo; cortes retos, sem curvas. Fundos: creme (principal), preto ou vinho escuro. Respiro mínimo = metade da altura do M grande. Nunca distorcer, girar, aplicar sombra dura, gradiente ou recolorir fora da paleta. Apoio: "A MELHOR MÍDIA / DO BRASIL" em duas linhas, caixa alta, bold condensado.

TIPOGRAFIA: títulos em Boldonse (caixa alta; fallback Bebas Neue, Anton ou Barlow Condensed ExtraBold, entrelinha 0.9-1.0). Apoio em Syncopate (caixa alta, espaçamento 0.2-0.4em, tamanhos pequenos). Hierarquia: headline gigante em creme com UMA palavra em vermelho; filete vermelho curto abaixo; palavras-chave em Syncopate pequeno (ESTRATÉGIA / DADOS / CRIATIVIDADE / EXECUÇÃO / RESULTADOS). Headlines terminam com ponto final.

VOCABULÁRIO GRÁFICO (use pelo menos 2 por peça): estrela de quatro pontas, filete vermelho, barras horizontais, cruzes "+" nos cantos, xadrez, círculos concêntricos em linha fina, quadrado dividido na diagonal (vermelho/preto), diagonais, linhas de blueprint em cinza sobre creme, microtextos tipo HUD ("REC 00:00"), rodapé em Syncopate: MARKETING · ESTRATÉGIA · TECNOLOGIA · NEGÓCIOS · IA.

IMAGEM: símbolos de estratégia e risco calculado em vermelho + preto + creme (roleta, peças de xadrez, telefone vermelho vintage, dados vermelhos translúcidos, cartas, cortinas de veludo, spotlight, tecido drapeado). Luz dramática, contraste alto, rim light vermelho, fundo preto profundo, granulação. Evitar stock sorridente, pessoas em escritório, gráficos clichê. Prompt-base de imagem: "cinematic still life, [objeto-símbolo] in glossy red, deep black background, cream accents, dramatic rim lighting, shallow depth of field, subtle film grain, editorial luxury advertising, no text".

TOM DE VOZ: frases curtas, afirmativas, com ponto final, máximo 6 palavras nos slogans, verbo forte, sem exclamação. Ex.: "Ideias que movem o mercado." "Estratégia não é sorte." "Marketing com intenção."

FORMATOS: feed 1080x1350 ou 1080x1080; stories/reels 1080x1920; thumbnails 1280x720; slides 16:9. Margens >= 6% da largura; headline ocupa 40-60% da área; um único ponto focal vermelho. Motion: cortes secos creme/preto, easing forte, wipes por barras, glitch curto, sem bounce nem dissolve lento.

CHECKLIST: só as 5 cores; headline bold condensada em caixa alta com uma palavra em vermelho e ponto final; apoio em Syncopate; 2+ elementos do vocabulário gráfico; imagem-símbolo com luz dramática; logo respeitado; contraste AA e legível no celular. Na dúvida: mais preto, menos elementos, tipografia maior, um único destaque vermelho.`;

const GUIA_DISCO = `MARCA: O Disco Criativo (hub). Frentes: Disco Criativo (conteúdo e planejamento), Disco Mídia (@bydiscomidia: tráfego, estratégia, dados e aquisição de clientes) e Disco Tech (SaaS). Conceito: "Órbitas que conectam, ideias que giram". Tagline: Estratégia • Design • Conteúdo.

CORES: preto e verde. [CONFIRMAR: hex exatos do verde e do preto no kit "Disco Mídia" do Canva.]
TIPOGRAFIA: Anton (títulos) e Inter (apoio).
REDES SOCIAIS: estilo CLARO: fundo off-white, título preto com a palavra-chave em verde. O fundo escuro fica reservado para site e peças institucionais.
CONTEÚDO: informa com autoridade sobre marketing e atrai clientes com storytelling; roteiros autorais, sem dancinhas e sem formatos virais genéricos.
SUB-MARCA: a Just Marketing (agência, tom institucional) tem identidade própria; kit do Canva "Just Mkt" (brand_kit_id kAHUqEMtaUA).
REGRA: os clientes atendidos pela Disco (Operizy, Senhorita Moça, Michie Farfan e outros) têm identidade própria. Nunca aplicar este guia às peças deles.`;

const GUIA_OTTER = `MARCA: Agência Otter / Grupo Otter (produção cultural em Pernambuco). O padrão visual é o do kit "Kit Otter" do Canva (cores, fontes e logo): crie sempre com esse kit. [CONFIRMAR: descrever aqui paleta, tipografia e estilo do Otter.]
REGRA: a Contrafluxo Pratas e as demais empresas do grupo têm identidade própria. Nunca aplicar este guia às peças delas.`;

async function seedGuiasMarca(c) {
  const proj = [['A Melhor Mídia do Brasil', GUIA_MELHOR_MIDIA], ['Disco', GUIA_DISCO], ['Otter', GUIA_OTTER]];
  for (const [nome, guia] of proj) await c.query('UPDATE projects SET guia_design=$1 WHERE nome=$2 AND guia_design IS NULL', [guia, nome]);
  // O cliente que é a própria marca do projeto herda o guia e o kit do projeto
  await c.query(`UPDATE clients SET marca_propria=true WHERE nome IN ('A Melhor Mídia do Brasil','Disco','Agência Otter')`);
  await c.query(`UPDATE clients SET canva_kit_id='kAHVxV_gqbI', canva_kit_nome='Disco Mídia' WHERE nome='Disco' AND canva_kit_id IS NULL`);
  await c.query(`UPDATE clients SET canva_kit_id='kAGnnk9vrtI', canva_kit_nome='Kit Otter' WHERE nome='Agência Otter' AND canva_kit_id IS NULL`);
}

async function init() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(SCHEMA);
    await seedIfEmpty(c);
    await seedsIncrementais(c);
    const { rowCount } = await c.query(`INSERT INTO seeds (chave) VALUES ('projetos_v1') ON CONFLICT DO NOTHING`);
    if (rowCount) await seedProjetos(c);
    // Projeto Empregos: área própria (vagas e candidaturas), sem clientes nem tarefas
    const { rowCount: emp } = await c.query(`INSERT INTO seeds (chave) VALUES ('empregos_v1') ON CONFLICT DO NOTHING`);
    if (emp) {
      await c.query(
        `INSERT INTO projects (nome, cor, descricao, contexto, ordem, tipo) VALUES ('Empregos','#2f6f8f',
         'Vagas e projetos freelance: busca, propostas, candidaturas e o seu perfil profissional. Funciona diferente das tarefas dos outros projetos.','',99,'empregos')
         ON CONFLICT (nome) DO UPDATE SET tipo='empregos'`);
    }
    const { rowCount: gm } = await c.query(`INSERT INTO seeds (chave) VALUES ('guias_marca_v1') ON CONFLICT DO NOTHING`);
    if (gm) await seedGuiasMarca(c);
    // Kits de marca que já existem no Canva (só preenche onde ainda está vazio)
    const { rowCount: kits } = await c.query(`INSERT INTO seeds (chave) VALUES ('canva_kits_v1') ON CONFLICT DO NOTHING`);
    if (kits) {
      for (const [nome, kitId, kitNome] of [['Disco', 'kAHVxV_gqbI', 'Disco Mídia'], ['Otter', 'kAGnnk9vrtI', 'Kit Otter']]) {
        await c.query('UPDATE projects SET canva_kit_id=$1, canva_kit_nome=$2 WHERE nome=$3 AND canva_kit_id IS NULL', [kitId, kitNome, nome]);
      }
    }
    await bootstrapAdmin(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { pool, init, salvarExperiencias, STATUSES, BLOG_CHECKLIST, hashSenha, conferirSenha, senhaTemporaria };
