# MIX PRO — Banco de dados e publicação

Este pacote remove a dependência do `localStorage`. O estado completo do sistema é salvo em PostgreSQL através de uma API Node.js.

## Estrutura

- `index.html` e `src/`: frontend original adaptado.
- `backend/`: API REST que lê e grava os dados.
- `database/001_init.sql`: criação da tabela PostgreSQL.
- `docker-compose.yml`: PostgreSQL local para desenvolvimento.

## Rodar localmente

1. Instale Node.js 20+ e Docker Desktop.
2. Na raiz: `docker compose up -d`
3. Em `backend`: copie `.env.example` para `.env`, depois rode `npm install` e `npm run dev`.
4. Na raiz: rode `npm run serve`.
5. Abra `http://localhost:4173`.

## Publicar

O frontend pode ir para GitHub Pages. O backend NÃO roda no GitHub Pages e deve ser hospedado em um serviço que execute Node.js. O PostgreSQL deve ser um banco online.

Depois de publicar a API, altere `src/config.js`:

`export const API_BASE_URL = 'https://SUA-API.exemplo.com';`

Na variável `CORS_ORIGIN` do backend, coloque a URL do GitHub Pages, por exemplo:

`https://seuusuario.github.io`

## Importante

A tabela `app_state` guarda o estado completo do sistema em JSONB. Isso permite manter todas as funcionalidades existentes sem reescrever toda a lógica do frontend. A API usa `version` para impedir que uma sessão sobrescreva silenciosamente uma alteração mais recente.
