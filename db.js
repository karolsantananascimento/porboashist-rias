const { Pool, types } = require('pg');
const seed = require('./seed/october.json');

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

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  categoria TEXT,
  descricao TEXT,
  url TEXT NOT NULL,
  evitar BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

async function init() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(SCHEMA);
    await seedIfEmpty(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { pool, init, STATUSES, BLOG_CHECKLIST };
