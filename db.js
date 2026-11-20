const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

// Datas (DATE) voltam como texto 'AAAA-MM-DD', sem conversão de fuso.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
});

// Conexão ociosa derrubada pelo banco (reinício, pausa, manutenção) emite 'error' no pool; sem este handler o Node encerra o processo.
pool.on('error', (e) => console.error('Conexão ociosa com o Postgres encerrada:', e.message));

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
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_semanal INT NOT NULL DEFAULT 2;   -- posts por semana
CREATE TABLE IF NOT EXISTS midia (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, dados BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS midias JSONB NOT NULL DEFAULT '[]'::jsonb;   -- fotos e vídeos escolhidos no Google Drive
-- Social media: agendamento depois da aprovação humana (esteira = agendada -> publicando -> publicada)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agendada_para TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plataformas TEXT;       -- facebook,instagram,linkedin
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS publicar_texto TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS publicar_imagem TEXT;
CREATE INDEX IF NOT EXISTS tasks_agendadas ON tasks (agendada_para) WHERE esteira = 'agendada';

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

-- Campanhas de anúncios (gestor de tráfego): rascunho montado a partir do plano da Camila -> criada PAUSADA no Meta -> ativada por uma pessoa
CREATE TABLE IF NOT EXISTS campanhas (
  id SERIAL PRIMARY KEY,
  task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
  client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  spec JSONB NOT NULL DEFAULT '{}',
  pendencias JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'rascunho',     -- rascunho | criando | criada_pausada | ativando | ativada | erro
  ids JSONB NOT NULL DEFAULT '{}',             -- campanha_id, conjunto_id, criativo_id, anuncio_id (Meta)
  erro TEXT,
  criado_por TEXT,
  criada_em TIMESTAMPTZ,
  ativada_por TEXT,
  ativada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campanhas_task ON campanhas (task_id, id DESC);
CREATE INDEX IF NOT EXISTS campanhas_cliente ON campanhas (client_id, id DESC);

-- SaaS do gestor de tráfego: assinantes com conta isolada. Ficam fora de clients/tasks de propósito
-- (backup, restauração e telas internas não tocam nelas). O escopo das chaves em "configuracoes" é 1000000 + id da conta.
ALTER TABLE users ADD COLUMN IF NOT EXISTS aceite_termos_em TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS saas_contas (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  empresa TEXT,
  status TEXT NOT NULL DEFAULT 'trial',        -- trial | ativa | inadimplente | cancelada | bloqueada
  trial_ate TIMESTAMPTZ,
  periodo_fim TIMESTAMPTZ,
  cortesia BOOLEAN NOT NULL DEFAULT false,     -- liberada pelo administrador, sem cobrança
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  ia_mes TEXT,                                 -- AAAA-MM do contador de usos da IA
  ia_usos INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_contas_stripe ON saas_contas (stripe_customer_id);
ALTER TABLE saas_contas ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'solo';   -- solo | agencia | escala
ALTER TABLE saas_contas ADD COLUMN IF NOT EXISTS bi BOOLEAN NOT NULL DEFAULT false;     -- pacote BI + relatórios
-- Clientes do assinante (planos Agência e Escala gerenciam vários). Cada cliente tem as próprias chaves de API:
-- "escopo" é o client_id usado em configuracoes. O cliente principal usa 1000000 + id da conta (como antes); os outros, 2000000 + id do cliente.
CREATE TABLE IF NOT EXISTS saas_clientes (
  id SERIAL PRIMARY KEY,
  conta_id INT NOT NULL REFERENCES saas_contas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  escopo INT NOT NULL UNIQUE,
  principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_clientes_conta ON saas_clientes (conta_id);
CREATE UNIQUE INDEX IF NOT EXISTS saas_clientes_principal ON saas_clientes (conta_id) WHERE principal;
INSERT INTO saas_clientes (conta_id, nome, escopo, principal)
  SELECT c.id, COALESCE(NULLIF(c.empresa, ''), 'Meu cliente'), 1000000 + c.id, true FROM saas_contas c
  WHERE NOT EXISTS (SELECT 1 FROM saas_clientes k WHERE k.conta_id = c.id AND k.principal);
CREATE TABLE IF NOT EXISTS saas_campanhas (
  id SERIAL PRIMARY KEY,
  conta_id INT NOT NULL REFERENCES saas_contas(id) ON DELETE CASCADE,
  plataforma TEXT NOT NULL DEFAULT 'meta',     -- meta | google
  spec JSONB NOT NULL DEFAULT '{}',
  pendencias JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'rascunho',     -- rascunho | criando | criada_pausada | ativando | ativada | erro
  ids JSONB NOT NULL DEFAULT '{}',
  erro TEXT,
  briefing TEXT,
  criada_em TIMESTAMPTZ,
  ativada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_campanhas_conta ON saas_campanhas (conta_id, id DESC);
ALTER TABLE saas_campanhas ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES saas_clientes(id) ON DELETE CASCADE;
UPDATE saas_campanhas x SET cliente_id = (SELECT k.id FROM saas_clientes k WHERE k.conta_id = x.conta_id AND k.principal) WHERE x.cliente_id IS NULL;
CREATE INDEX IF NOT EXISTS saas_campanhas_cliente ON saas_campanhas (cliente_id, id DESC);
CREATE TABLE IF NOT EXISTS site_posts (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  resumo TEXT NOT NULL DEFAULT '',
  corpo TEXT NOT NULL DEFAULT '',
  capa_url TEXT NOT NULL DEFAULT '',
  seo_titulo TEXT NOT NULL DEFAULT '',
  seo_desc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'rascunho',      -- rascunho | publicado
  autor TEXT NOT NULL DEFAULT '',
  publicado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saas_midias (
  id SERIAL PRIMARY KEY,
  conta_id INT NOT NULL REFERENCES saas_contas(id) ON DELETE CASCADE,
  cliente_id INT NOT NULL REFERENCES saas_clientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  tamanho INT NOT NULL,
  largura INT,
  altura INT,
  dados BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_midias_cliente ON saas_midias (cliente_id, id DESC);
CREATE TABLE IF NOT EXISTS saas_chamados (
  id SERIAL PRIMARY KEY,
  conta_id INT NOT NULL REFERENCES saas_contas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'integracao',
  plataformas TEXT NOT NULL DEFAULT '',          -- meta,google
  contato TEXT NOT NULL DEFAULT '',              -- WhatsApp ou telefone para combinar o horário
  janela TEXT NOT NULL DEFAULT '',               -- dias e horários que o assinante pode
  obs TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto',         -- aberto | agendado | concluido | cancelado
  agendado_para TIMESTAMPTZ,
  nota_admin TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_chamados_status ON saas_chamados (status, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_chamados_conta ON saas_chamados (conta_id, id DESC);
CREATE TABLE IF NOT EXISTS saas_eventos (
  id SERIAL PRIMARY KEY,
  conta_id INT REFERENCES saas_contas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  detalhe TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_eventos_conta ON saas_eventos (conta_id, id DESC);

-- Currículos e portfólios (arquivos) para anexar em candidaturas
CREATE TABLE IF NOT EXISTS documentos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  rotulo TEXT,
  idioma TEXT,
  mime TEXT NOT NULL,
  tamanho INT NOT NULL,
  dados BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

  // Pautas de novembro do Disco (planilha da agência) com as artes já prontas, aguardando a aprovação humana
  await aplicar('disco_novembro_v1', async () => {
    const fs = require('fs'); const path = require('path');
    const { rows: [cl] } = await c.query(`SELECT c.id FROM clients c JOIN projects p ON p.id=c.project_id WHERE p.nome='Disco' AND c.nome='Disco' LIMIT 1`);
    if (!cl) return;
    const pautas = JSON.parse(fs.readFileSync(path.join(__dirname, 'seeds', 'disco-novembro.json'), 'utf8'));
    for (const t of pautas) {
      const { rowCount } = await c.query('SELECT 1 FROM tasks WHERE client_id=$1 AND data=$2 AND tema=$3', [cl.id, t.data, t.tema]);
      if (rowCount) continue;
      await c.query(
        `INSERT INTO tasks (client_id, tipo, formato, data, editorial, tema, legenda, briefing, status, responsavel, arte_url, publicar_imagem, midias, esteira, esteira_msg, esteira_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'aprovacao',$9,$13,$10,$11::jsonb,'aguardando_aprovacao',$12,now())`,
        [cl.id, t.tipo, t.formato, t.data, t.editorial, t.tema, t.legenda, t.briefing, t.responsavel, t.imagem, JSON.stringify(t.midias || []), t.msg, t.canva || t.imagem]);
    }
  });

}

// Projetos e clientes vindos do que já estava cadastrado (aplicado uma única vez)
const PROJETOS_INICIAIS = [
  ['A Melhor Mídia do Brasil', '#b3202a',
    'Marca-mãe e central de criação. Conteúdo próprio da A Melhor Mídia do Brasil.',
    'Identidade visual: vermelho, preto e creme, referências de xadrez e teatro, tipografia bold. Tom de voz, público e regras: complete em Projetos > editar contexto.'],
  ['Por Boas Histórias', '#8a5a44',
    'Agência de conteúdo e gestão de tarefas dos clientes da Por Boas Histórias.',
    'O contexto detalhado de cada cliente fica em Contratos > Contexto do agente.'],
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

// Perfil começa vazio: os dados pessoais ficam só no banco (o repositório é público) e são editados na tela
const PERFIL_INICIAL = { nome: '', observacoes: 'Preencha o perfil: a Bianca só usa o que estiver aqui.' };

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
  // Clientes sem projeto passam a ser do projeto Por Boas Histórias
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

// Kits de marca vindos do Agente de Tráfego (gestoragente): direção visual vigente da Disco e o kit da Operizy
async function seedKitsGestor(c) {
  const fs = require('fs'); const path = require('path');
  const ler = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'kits', n + '.json'), 'utf8'));
  const disco = ler('disco');
  const bloco = [disco.direcao_visual_vigente, disco.regra_redes && `REGRA PARA REDES SOCIAIS: ${disco.regra_redes}`, disco.referencia_site && `REFERÊNCIA DO SITE: ${disco.referencia_site}`].filter(Boolean).join('\n\n');
  // a direção vigente vem primeiro e prevalece sobre o guia anterior
  await c.query(`UPDATE projects SET guia_design = $1 || E'\n\n--- GUIA ANTERIOR (a direção vigente acima prevalece em caso de conflito) ---\n' || COALESCE(guia_design,'') WHERE nome='Disco' AND COALESCE(guia_design,'') NOT LIKE 'DIREÇÃO VISUAL VIGENTE%'`, [bloco]);
  const op = ler('operizy');
  const guiaOp = ['nome', 'identidade', 'posicionamento', 'objetivo_conteudo', 'publico', 'tom_de_voz', 'estilo_comunicacao', 'estilo_visual', 'cores', 'fontes', 'regras_visuais', 'proibido']
    .filter((k) => op[k]).map((k) => `${k.replace(/_/g, ' ').toUpperCase()}: ${op[k]}`).join('\n');
  await c.query(`UPDATE clients SET guia_design=$1 WHERE nome ILIKE 'Operizy%' AND guia_design IS NULL`, [guiaOp]);
}

async function init() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(SCHEMA);
    await seedsIncrementais(c);
    const { rowCount: kg } = await c.query(`INSERT INTO seeds (chave) VALUES ('kits_gestor_v1') ON CONFLICT DO NOTHING`);
    if (kg) await seedKitsGestor(c);
    const { rowCount } = await c.query(`INSERT INTO seeds (chave) VALUES ('projetos_v1') ON CONFLICT DO NOTHING`);
    if (rowCount) await seedProjetos(c);
    // O projeto de carreira passa a ter o nome da própria Karolina
    const { rowCount: kn } = await c.query(`INSERT INTO seeds (chave) VALUES ('karolina_v1') ON CONFLICT DO NOTHING`);
    if (kn) {
      await c.query(`UPDATE projects SET nome='Karolina Nascimento', cor='#1d4e89',
        descricao='Perfil, currículo, portfólio e candidaturas: vagas, funil e propostas prontas. Funciona diferente das tarefas dos outros projetos.' WHERE tipo='empregos'`);
    }
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
