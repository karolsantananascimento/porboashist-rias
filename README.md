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
- **Usuários** (administradores): cada pessoa entra com o próprio e-mail. O administrador cadastra o e-mail, recebe uma senha temporária para enviar e a pessoa cria a senha dela no primeiro acesso. Dá para redefinir senha, desativar, excluir e alternar entre Membro e Administrador.
- **Minha conta**: troca de nome e senha.
- **Backup**: download e restauração de todos os dados em JSON (restauração só para administradores; usuários e senhas não entram no backup).

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
DATABASE_URL=postgresql://usuario:senha@localhost:5432/pbh ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=temporaria123 npm start
```

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão com o Postgres |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Criam o primeiro administrador quando ainda não há usuários. A senha é temporária e precisa ser trocada no primeiro acesso. |
| `SESSION_SECRET` | Chave para assinar a sessão (o Render gera sozinho) |
| `DB_SCHEMA` | Schema do banco onde ficam as tabelas (`pbh` no Supabase) |

## Hospedagem

- **App:** serviço web gratuito no Render (`render.yaml`). Ele "dorme" após um período sem acesso e leva alguns segundos para acordar.
- **Banco:** Postgres gratuito no Supabase (projeto `por-boas-historias`, região São Paulo), que não expira (o Supabase pausa projetos gratuitos após uma semana sem nenhum acesso; basta reativar no painel deles). As tabelas ficam no schema `pbh`, acessado por um usuário próprio (`pbh_app`), fora da API pública do Supabase.
- **Backup:** em **Clientes → Baixar backup** você guarda uma cópia de tudo em JSON, que pode ser restaurada em **Clientes → Restaurar backup**.
