# Por Boas Histórias — Gestão de conteúdo

Sistema da agência para planejar e acompanhar as entregas de cada cliente: posts do feed, stories diários, artigos de blog com SEO e captações de fotos e vídeos.

## O que tem

- **Painel**: metas do contrato no mês (posts publicados, dias com stories, artigos de blog), andamento por etapa, próximas entregas e alertas (posts sem tema, entregas atrasadas, excesso ou falta de posts em relação à meta).
- **Calendário**: visão mensal com posts, blog e stories por dia. Clique para editar ou no **+** para criar.
- **Quadro**: kanban de produção (Pauta → Conteúdo/copy → Design/edição → Revisão interna → Aprovação do cliente → Agendado → Publicado), com arrastar e soltar.
- **Lista**: todas as tarefas do mês com busca e filtros.
- **Captação**: pautas de produção de fotos e vídeos com checklist por item.
- **Materiais**: banco de links do Drive por categoria, com busca e marcação de "evitar".
- **Clientes**: metas mensais, marcas, rodapé padrão e botão para gerar a estrutura de um mês novo (posts distribuídos, stories diários e artigos de blog).
- **Backup**: download e restauração de todos os dados em JSON.

## Dados iniciais

Na primeira execução o banco é criado com:

- Cliente **La Fleur Collection** (Samoa Beach Resort, Samoa Villa Resort, Villa de Muro Alto), meta de 12 posts/mês, stories diários e 4 artigos de blog/mês.
- Planejamento de **outubro/2026** (posts do feed e editoriais de stories).
- 31 tarefas de stories e 4 artigos de blog com checklist de SEO.
- 3 captações prioritárias (Villa de Muro Alto, buggy na praia, hóspedes na praia de Muro Alto).
- 91 links de fotos e vídeos do Drive organizados por categoria.

## Rodar localmente

```bash
npm install
DATABASE_URL=postgresql://usuario:senha@localhost:5432/pbh APP_PASSWORD=suasenha npm start
```

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão com o Postgres |
| `APP_PASSWORD` | Senha única da equipe. Sem ela, o sistema fica aberto. |
| `SESSION_SECRET` | Chave para assinar a sessão (o Render gera sozinho) |

## Deploy no Render

O arquivo `render.yaml` cria o serviço web e o banco Postgres no plano gratuito.

**Atenção:** o Postgres gratuito do Render expira 30 dias após a criação. Antes disso, baixe um backup em **Clientes → Baixar backup**, crie um banco novo (ou mude para um plano pago) e restaure o arquivo em **Clientes → Restaurar backup**. O serviço web gratuito também "dorme" após um período sem acesso e leva alguns segundos para acordar.
