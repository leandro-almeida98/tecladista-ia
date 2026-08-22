# Design — Pipeline de IA React/Vite (tecladista-ia)

**Data:** 2026-08-21
**Status:** APROVADO pelo usuário
**Origem:** réplica adaptada do pipeline do `ssas-pedidoai` (PedidoAI), restrita a React JS/Vite.

## Contexto

O projeto `tecladista-ia` recebeu cópia bruta (via Windows — arquivos `*:Zone.Identifier`)
do pipeline de IA do PedidoAI: `opencode.json`, `AGENTS.md`, 6 agents, 2 plugins,
6 commands e 7 skills. Tudo ainda com branding/behavior PedidoAI (monorepo 3 frontends +
backend Java 21/Spring). O projeto não possui código de aplicação (sem `package.json`,
sem `src/`) — o scaffold virá em prompt posterior.

## Decisões (aprovadas)

| Decisão | Valor |
|---|---|
| Linguagem | TypeScript strict (React 19 + Vite) |
| Estrutura | App único na raiz (`src/`, `package.json`, `vite.config.ts` na raiz) |
| Testes | Vitest + Testing Library + Cypress; cobertura 95% POR ARQUIVO no gate |
| Pós-gate | `docker compose up -d --build` ON + detector impeccable ON |
| GitNexus | Indexar este repo; MCP aponta p/ `.gitnexus/run.cjs` local, repo `tecladista-ia` |

## Escopo da adaptação

1. **`opencode.json`**
   - MCP gitnexus → `node /home/leandro/projetos/tecladista-ia/.gitnexus/run.cjs mcp`,
     `GITNEXUS_MCP_DEFAULT_REPO=tecladista-ia`.
   - Agents mantidos: `orquestrador` (task → só `dev-frontend`+`code-reviewer`),
     `dev-frontend`, `code-reviewer`. Removidos: `dev-backend`, `qa-frontend`, `qa-backend`.
   - Commands renomeados para `*-tecladista`.

2. **`AGENTS.md`** — reescrito: Tecladista IA, app único na raiz
   (`src/{api,components,hooks,pages,store,test,types,routes}`), regras de qualidade
   idênticas (TDD, 95%/arquivo, Cypress obrigatório, gitnexus impact/detect_changes),
   fluxo orquestrador→gate→reviewer, formato de checkpoint.

3. **Agents**
   - `orquestrador.md`: pipeline 3 fases, gate só frontend, 2 subagentes.
   - `dev-frontend.md`: estrutura na raiz, skills obrigatórias
     (`unit-testing-frontend`, `ui-ux-pro-max`, `impeccable`).
   - `code-reviewer.md`: checklist sem Java/mvn; pre-commit = tsc + build + vitest + cypress.
   - DELETE: `dev-backend.md`, `qa-frontend.md`, `qa-backend.md`.

4. **Plugins**
   - `pipeline-orchestrator.ts`: 1 gate (`npm run build` → `npm test` →
     `npm run test:coverage`; exit-code decide via Vitest `thresholds.perFile`);
     preflight Docker/Testcontainers removido; compose ON (skip gracioso se não houver
     `docker-compose.yml`); detector ON (script confirmado em
     `.opencode/skills/impeccable/scripts/detector/detect-antipatterns.mjs`);
     guarda de bootstrap: se `package.json` ausente na raiz, gate é pulado com warn
     (projeto ainda não scaffoldado) — remove-se após o scaffold.
   - `gitnexus-index-refresh.ts`: intocado.

5. **Commands (6)** — `build/test/review/tdd/e2e/commit-tecladista.md`, passos só frontend.

6. **Skills**
   - `sas-architecture` → `tecladista-architecture` (conteúdo reescrito, sem Java).
   - `sas-guides` → `tecladista-guides` (só React/TS/Zustand/Vitest).
   - `unit-testing-frontend`: paths p/ `src/`, comandos canônicos da raiz.
   - DELETE: `unit-testing-backend/` (Java).
   - Intactas: `omniroute-testgen`, `ui-ux-pro-max`, `impeccable`.

7. **GitNexus** — `npx gitnexus analyze` na raiz (cria `.gitnexus/run.cjs`, índice e bloco
   `<!-- gitnexus -->` no AGENTS.md).

8. **Limpeza** — deletar todos `*:Zone.Identifier` (artefatos ADS do Windows; alguns casam
   glob `*.md` e virariam commands fantasmas).

## Fora de escopo (próximo prompt)

Scaffold do app: `package.json` (scripts `build`, `test`, `test:coverage`, `test:e2e`),
`vite.config.ts` com `test.thresholds.perFile = 95`, Cypress, estrutura `src/`.
Enquanto não existir, o quality gate entra em modo bootstrap (skip com warn).

## Riscos

- Plugin novo só carrega após reiniciar o opencode (config lida no start).
- Gate/compose exigem `package.json`/`docker-compose.yml` — guardas de skip evitam falso bloqueio.
