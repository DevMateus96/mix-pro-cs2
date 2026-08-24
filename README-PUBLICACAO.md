# MIX PRO — Publicação exata: GitHub Pages + Render + PostgreSQL

Esta pasta está pronta para ser enviada para **um único repositório no GitHub**.

## Arquitetura

```
GitHub Repository
├── GitHub Pages ............ Frontend do MIX PRO
├── backend/ ................ API Node.js
├── database/ ............... Estrutura do banco
├── render.yaml ............. Configuração automática do Render
└── .github/workflows/ ...... Publicação automática do GitHub Pages

GitHub Pages (frontend)
        ↓ HTTPS
Render (API Node.js)
        ↓ DATABASE_URL
PostgreSQL online (Neon)
```

## 1. Criar o repositório no GitHub

1. Crie um repositório novo.
2. Nome sugerido: `mix-pro-cs2`.
3. Deixe como **Public** para simplificar o GitHub Pages.
4. Extraia este ZIP e envie **todo o conteúdo da pasta raiz** para o repositório.
5. Faça o primeiro commit na branch `main`.

### Importante
Não coloque o projeto dentro de uma pasta extra. Na raiz do repositório devem aparecer:

```
index.html
src/
backend/
database/
render.yaml
.github/
README-PUBLICACAO.md
```

## 2. Ativar o GitHub Pages

No GitHub:

**Settings → Pages → Source → GitHub Actions**

Depois disso, o arquivo:

`.github/workflows/deploy-pages.yml`

publicará automaticamente o frontend sempre que houver um `git push` para `main`.

A URL final normalmente será:

`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`

## 3. Criar o banco PostgreSQL online

Crie um projeto PostgreSQL no Neon e copie a **Connection String**.

Ela terá formato parecido com:

```
postgresql://USER:SENHA@HOST/NOME_DO_BANCO?sslmode=require
```

Essa URL é secreta. **Nunca coloque no GitHub.**

## 4. Publicar o backend no Render

1. Crie uma conta no Render.
2. Escolha **New → Blueprint**.
3. Conecte o repositório GitHub do MIX PRO.
4. O Render encontrará automaticamente o arquivo `render.yaml`.
5. Na configuração do serviço, informe:
   - `DATABASE_URL`: a Connection String do PostgreSQL.
   - `CORS_ORIGIN`: a URL exata do seu GitHub Pages.

Exemplo:

```
DATABASE_URL=postgresql://...
CORS_ORIGIN=https://SEU-USUARIO.github.io/mix-pro-cs2
```

6. Faça o deploy.

O comando de inicialização executará:

```
npm run migrate && npm start
```

Isso cria a tabela `app_state` automaticamente antes de iniciar a API.

## 5. Testar o backend

Quando o Render fornecer uma URL, abra:

```
https://SUA-API.onrender.com/health
```

O resultado esperado é:

```json
{"ok":true}
```

## 6. Ligar o frontend ao backend

Abra:

`src/config.js`

Troque:

```js
'https://COLE-AQUI-A-URL-DO-SEU-BACKEND'
```

pela URL fornecida pelo Render, por exemplo:

```js
'https://mix-pro-api.onrender.com'
```

Salve e faça commit/push novamente.

O GitHub Pages republicará automaticamente.

## 7. Fluxo final

Quando abrir o site:

1. O frontend chama `GET /api/state`.
2. Se ainda não houver dados, o site inicia com o estado padrão.
3. Ao adicionar ou alterar jogadores, partidas, Elo, mapas, draft ou outras informações, o frontend chama `PUT /api/state`.
4. A API grava tudo no PostgreSQL.
5. Qualquer computador acessando o mesmo site usa os mesmos dados.

## Desenvolvimento local

### Banco

```bash
docker compose up -d
```

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm start
```

Para desenvolvimento local, configure no `.env`:

```env
DATABASE_URL=postgresql://mixpro:mixpro@localhost:5432/mixpro
CORS_ORIGIN=http://localhost:4173
```

### Frontend

Na raiz:

```bash
python3 -m http.server 4173
```

E em `src/config.js`, durante desenvolvimento local, use:

```js
export const API_BASE_URL = 'http://localhost:3000';
```

## Segurança

- Nunca envie `.env` para o GitHub.
- Nunca publique `DATABASE_URL`.
- `CORS_ORIGIN` deve conter a URL exata do seu site.
- Depois de publicar, mantenha o backend em HTTPS.

## Observação sobre este banco

A versão atual do MIX PRO salva o estado completo da aplicação em uma coluna `JSONB` no PostgreSQL. Isso permite migrar o site para banco de dados sem reescrever todas as funcionalidades atuais.

No futuro, se necessário, o banco pode ser normalizado em tabelas separadas para jogadores, partidas, estatísticas, mapas e histórico.
