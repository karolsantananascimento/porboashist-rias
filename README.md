# A Melhor Mídia do Brasil

Central de criação e gestão. A primeira tela mostra os **projetos** (A Melhor Mídia do Brasil, Por Boas Histórias, Disco, Otter, Lumiére e Marconi Car) e o painel **Criar**.

## Projetos e equipe de agentes

| Agente | Função |
| --- | --- |
| **Hugo** | Conteúdo: legendas, carrosséis, roteiros, posts de LinkedIn, blog com SEO |
| **Luiz** | Artes: direção de arte, briefing e prompt de imagem |
| **Davi** | Edição de vídeo: roteiro, decupagem e passo a passo |
| **Camila** | Campanhas de anúncios (Meta, Google, LinkedIn): plano completo |
| **Felipe Macedo** | Mensagens do Instagram/Facebook: sugere a resposta, você aprova e envia |
| **Bianca** | Empregos: busca vagas, avalia aderência, monta proposta e respostas de cadastro com o seu perfil |

Os agentes nunca publicam, enviam ou se candidatam sozinhos: o resultado vai para revisão e só sai com um clique seu. Cada projeto tem um **contexto** (identidade, tom, regras) editável no card do projeto. Variáveis novas: `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_TOKEN` (ver **Integrações** no sistema).

## Campanhas no Meta Ads (Camila, gestora de tráfego)

A Camila monta o **plano** e, em seguida, o sistema gera um **rascunho técnico** da campanha (objetivo, orçamento diário, cidades ou estados exatos, interesses, públicos, destino, texto e criativo). O que o pedido não informar fica como pendência: nada é inventado.

Fluxo (botão **📈 Campanha Meta…** nos cards de tráfego): revisar e editar → **Conferir no Meta** (só leituras) → administrador clica em **Subir pausada** (cria criativo, campanha, conjunto e anúncio, tudo PAUSADO) → administrador confere no Gerenciador de Anúncios e clica em **Ativar** (só então começa a gastar). Dá para **Pausar** de novo pela tela. Nada é excluído no Meta.

Travas: só administrador sobe, ativa e pausa; confirmação em cada passo; orçamento diário máximo por campanha (padrão R$ 100, configurável); no máximo 5 ativações por dia; clique duplo não cria duas campanhas; o token vai só no cabeçalho das chamadas.

Configuração (Integrações → Meta, por cliente ou padrão): `META_ADS_TOKEN` (permissão `ads_management`), `META_AD_ACCOUNT_ID` (`act_...`), `META_PIXEL_ID` (só Leads/Vendas no site) e `META_MAX_DAILY_BUDGET_BRL`. A página do Facebook e o Instagram vêm da conexão já feita em Integrações. Objetivos: Tráfego, Reconhecimento, Leads, Vendas e Engajamento; destinos: site, WhatsApp, engajamento no post e mensagens (Messenger, Instagram Direct). Criativo em imagem (link https) ou carrossel de 2 a 10 imagens; vídeo ainda não. Mensagens, WhatsApp e carrossel ainda não foram validados em conta real.

**Site de vendas e cadastro:** `/assinar` (também `/agente` e `/agente-de-trafego`) é o site de vendas do Agente de Tráfego, sem formulário: funcionalidades, vídeo de demonstração (`public/video/demo-agente-trafego.mp4`) e capturas de tela (`public/img`, dados de exemplo), para quem, passos, segurança, preço e dúvidas. Os botões **Assinar agora** abrem `/cadastro?plano=assinar` (criar conta e seguir direto para o pagamento no Stripe), **Teste sem cartão** abre `/cadastro?plano=testar`, e **Entrar** abre `/entrar`. Preço, dias de teste e link dos termos vêm de `SAAS_PRECO_TEXTO`, `SAAS_TRIAL_DIAS` e `SAAS_TERMOS_URL`. A área logada fica em `/assinante` (a aba aparece no endereço, ex.: `/assinante#chaves`); quem não está logado lá vai para `/cadastro`.

Testes: `npm test` (Meta simulado) e, com um Postgres de teste, `DATABASE_URL=postgresql://usuario@localhost:5432/pbh node test/campanhas-integracao.js`.

## Gestão de conteúdo (Por Boas Histórias)

Sistema para planejar e acompanhar as entregas de cada cliente: posts do feed, stories diários, artigos de blog com SEO e captações de fotos e vídeos.

## O que tem

- **Área do cliente**: página de cada cliente com botões para os links de trabalho (Trello, planilhas, reservas, unidades), a seção **Materiais** (botões para as pastas e arquivos do Drive, nomeados pelo conteúdo, com busca) e a aba de **acessos** (logins e senhas). As senhas ficam criptografadas no banco (AES-256-GCM, chave em `ACESSOS_KEY`), aparecem só quando alguém clica em Mostrar/Copiar e podem ser restritas a administradores. Acessos não entram no backup.
- **Painel**: metas do contrato no mês (posts publicados, dias com stories, artigos de blog), andamento por etapa, próximas entregas e alertas (posts sem tema, entregas atrasadas, excesso ou falta de posts em relação à meta).
- **Calendário**: visão mensal com posts, blog e stories por dia. Clique para editar ou no **+** para criar.
- **Quadro**: kanban de produção (Pauta → Conteúdo/copy → Design/edição → Revisão interna → Aprovação do cliente → Agendado → Publicado), com arrastar e soltar.
- **Lista**: todas as tarefas do mês com busca e filtros.
- **Programação**: experiências e datas promocionais do cliente lidas da planilha do Google, agrupadas por mês, com botão **Criar pauta** que já leva tema e programação para o briefing. A aba **Planilha ao vivo** mostra a própria planilha embutida. O botão **Atualizar da planilha** relê a planilha quando ela está compartilhada como "qualquer pessoa com o link pode ver".
- **Captação**: pautas de produção de fotos e vídeos com checklist por item.
- **Materiais**: botões para as pastas e arquivos do Drive, agrupados por categoria e nomeados pelo conteúdo, com busca (sem precisar de acento), copiar link e marcação de "evitar".
- **Clientes**: metas mensais, marcas, rodapé padrão e botão para gerar a estrutura de um mês novo (posts distribuídos, stories diários e artigos de blog).
- **Usuários** (administradores): cada pessoa entra com o próprio e-mail. O administrador cadastra o e-mail e recebe um link de acesso (válido por 7 dias, uso único) para enviar; ao abrir, a pessoa cria a própria senha. Dá para gerar um novo link (esqueceu a senha), desativar, excluir e alternar entre Membro e Administrador.
- **Minha conta**: troca de nome e senha.
- **Agente de conteúdo**: dentro de cada tarefa, o botão **Gerar com IA** escreve a legenda do feed (com hashtags e direção visual), o roteiro de stories ou o artigo de blog com SEO, usando o tema e o briefing da tarefa, o **contexto do cliente** (tom de voz, público, pilares, regras e rodapé, editados em **Clientes → Contexto do agente**), os dados da planilha de programação, os materiais marcados para evitar e os últimos textos aprovados. O resultado vem com uma lista **Conferir antes de publicar** (preços, horários ou datas que faltam) e só vai para a tarefa quando alguém clica em **Usar na tarefa** e salva. É possível pedir ajustes ("mais curto", "citar o buggy") e reescrever. Em **Clientes → Sugerir pautas do mês**, o agente propõe tema, editorial e formato para os posts e artigos ainda sem pauta; nada é aplicado sem o clique.
- **Conhecimento e competências do agente**: em **Clientes → Contexto do agente** há uma **base de conhecimento** (fatos confirmados do cliente, um por linha), além de tom de voz, público, pilares, regras e rodapé. Preencha para cada cliente. O agente só afirma fatos que estejam nessa base, na planilha de programação ou no briefing, e lista o que falta em "Conferir antes de publicar". A tela também mostra as competências do agente (planejamento editorial semanal, copy de hospitalidade, sazonalidade, fidelidade à programação, direção visual, SEO local, stories, captação e conferência).
- **Conteúdo da semana**: em **Clientes → Gerar semana**, o agente escreve a semana inteira (segunda a domingo) de acordo com a meta do contrato: legendas completas dos posts, roteiro de stories para cada dia e pauta com SEO do artigo de blog. Considera a planilha de programação do período, o que já foi publicado nas últimas 4 semanas, as prioridades de captação e os materiais a evitar, e aceita um pedido da equipe ("destacar a programação de Halloween"). Ao aplicar, ocupa as tarefas vazias do mês e cria só o que faltar; nada é publicado.
- **Backup**: download e restauração de todos os dados em JSON (restauração só para administradores; usuários e senhas não entram no backup).

## SaaS Gestor de Tráfego (assinantes)

Dentro do sistema há uma versão SaaS só do agente gestor de tráfego. Pessoas se cadastram em `/assinante`, ganham teste grátis, colocam as próprias chaves de API (Meta e Google Ads, com um **?** em cada campo explicando onde pegar) e rodam campanhas. Pagam por Stripe (Checkout + portal do cliente).

- **Isolamento**: assinantes usam tabelas próprias (`saas_*`), chaves próprias criptografadas e nunca herdam as chaves do admin. Só acessam `/api/saas`.
- **Segurança de gasto**: campanhas sobem pausadas; ativar exige confirmação, com limite diário e teto de orçamento. Google Ads: aumento de orçamento limitado a +20% por ação.
- **Admin**: menu *Assinantes (SaaS)* (cortesia, +7 dias, bloquear, link de senha, excluir).
- **Stripe**: crie um preço mensal, configure o webhook `https://SEU-HOST/api/saas/webhook` (eventos de checkout, assinatura e fatura) e ative o Customer Portal.
- **Variáveis**: `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SAAS_PRECO_TEXTO`, `SAAS_TERMOS_URL`, `SAAS_TRIAL_DIAS` (7), `SAAS_IA_MES` (30), `SAAS_ATIVACOES_DIA` (10), `GOOGLE_ADS_API_VERSION` (v21).
- **Testes**: `PGBASE=postgresql://postgres@localhost:5433 node test/saas.js`.

## Dados iniciais

Na primeira execução o banco é criado com os projetos (A Melhor Mídia do Brasil, Por Boas Histórias, Disco, Otter, Lumiére e Marconi Car) e os clientes de cada um, sem tarefas.

## Rodar localmente

```bash
npm install
DATABASE_URL=postgresql://usuario:senha@localhost:5432/pbh ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=temporaria123 npm start
```

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão com o Postgres |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Criam o primeiro administrador quando ainda não há usuários. A senha é temporária e precisa ser trocada no primeiro acesso. |
| `SESSION_SECRET` | Chave para assinar a sessão (o Render gera sozinho) |
| `ACESSOS_KEY` | Chave do cofre de senhas dos clientes (32 bytes em base64). Sem ela, não dá para salvar nem ler senhas. Se for perdida, as senhas salvas não podem ser recuperadas. |
| `ANTHROPIC_API_KEY` | Chave da API do Claude para o agente de conteúdo. Sem ela o botão **Gerar com IA** avisa que o agente não está ativo. |
| `AGENTE_MODELO` | Opcional. Modelo usado pelo agente (padrão `claude-sonnet-5-5`). |
| `AGENTE_LIMITE_HORA` | Opcional. Máximo de gerações por pessoa por hora (padrão 40). |
| `DB_SCHEMA` | Schema do banco onde ficam as tabelas (`pbh` no Supabase) |

## Hospedagem

- **App:** serviço web gratuito no Render (`render.yaml`). Ele "dorme" após um período sem acesso e leva alguns segundos para acordar.
- **Banco:** Postgres gratuito no Supabase (projeto `por-boas-historias`, região São Paulo), que não expira (o Supabase pausa projetos gratuitos após uma semana sem nenhum acesso; basta reativar no painel deles). As tabelas ficam no schema `pbh`, acessado por um usuário próprio (`pbh_app`), fora da API pública do Supabase.
- **Backup:** em **Clientes → Baixar backup** você guarda uma cópia de tudo em JSON, que pode ser restaurada em **Clientes → Restaurar backup**.

### Caixa de demandas: modo Livre
Além de **Conteúdo**, **Criação** e **Tráfego**, a caixa tem o modo **🧠 Livre**: escreva o pedido do seu jeito, citando vários clientes e vários itens (ex.: "3 posts de Natal para a Disco e uma campanha para a Operizy"). O Claude identifica os clientes (só os da lista, nunca do projeto Empregos) e separa em até 8 demandas por comando, cria as pautas e o time executa em fila (2 por vez). O que faltar vira `[CONFIRMAR: ...]` no briefing e dúvidas aparecem na tela. Tudo termina **aguardando a sua aprovação**; o comando livre não publica, não envia mensagens nem altera configurações. Se um cliente estiver marcado, o pedido fica restrito a ele. Usa o mesmo limite por hora do agente (`AGENTE_LIMITE_HORA`) e a rota `POST /api/comandos`.

### Formato de pauta
Posts do agente saem no padrão da agência: legenda completa + briefing criativo por card/lâmina/cena (texto da arte, imagem, direção de arte), com as pastas do acervo (Materiais) citadas quando existirem. Em **Gerar semana**, o botão "Copiar pautas dos posts marcados" copia tudo no formato `dia. DD/MM/AA · Formato · Tema` / Data / Legenda / Briefing criativo / Link de imagens / Obs.
