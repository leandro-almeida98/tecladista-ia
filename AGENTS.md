<!--
  AGENTS.md — Leitura obrigatória no início de cada sessão.
  Contexto global do projeto. O agente principal da GUI atua como orquestrador.
-->

# Tecladista IA

## Projeto

- **Stack:** App único na raiz do repo — React 19 + TypeScript strict + Vite
- **Backend:** ainda não existe; quando houver integração, a API externa é consumida via `VITE_API_URL`
- **Testes:** Vitest + Testing Library (unitário) + Cypress (E2E); cobertura mínima de 95% POR ARQUIVO

## Estrutura planejada

```
src/
├── api/          # services axios (1 por módulo)
├── components/   # componentes compartilhados
├── hooks/        # hooks customizados
├── pages/        # páginas (1 arquivo = 1 rota)
│   └── <modulo>/ # páginas agrupadas por módulo
├── store/        # stores Zustand
├── test/         # setup canônico de testes (setup.ts)
├── types/        # tipos/interface TS
└── routes/       # definição de rotas React Router
```

## Regras de Arquitetura

- Pages em `src/pages/`, components em `src/components/`, stores em `src/store/`, API em `src/api/`, rotas em `src/routes/`
- Axios: instância única com interceptor (Bearer token + refresh em 401). Base URL de `VITE_API_URL`
- Estado global: Zustand (`create<StoreType>()(...)`)
- Erros: tratamento no service/hook com feedback na UI (toast)

## Qualidade

- NUNCA editar símbolo sem `gitnexus_impact` primeiro
- NUNCA commitar sem `gitnexus_detect_changes` + revisão
- NUNCA implementar sem testar (TDD: RED → GREEN → REFACTOR)
- TODA nova funcionalidade deve incluir testes unitários (Vitest/Testing Library) e pelo menos um cenário automatizado no Cypress; quando não houver tela, usar cenário de API pelo Cypress
- A meta mínima de cobertura é 95% POR ARQUIVO, priorizando cobertura unitária; nenhuma funcionalidade deve ser considerada concluída sem medir e reportar a cobertura
- O quality gate automático (plugin `pipeline-orchestrator`) roda build, teste unitário e cobertura na transição dev → code-reviewer. Após o gate passar, o plugin sobe o docker compose automaticamente (`docker compose up -d --build`, configurável em `OPTIONS.composeUpOnGatePass`) quando existir `docker-compose.yml` na raiz; se ausente, o compose é pulado sem bloquear.
- SEMPRE tipagem forte (TS strict)
- SEMPRE `ui-ux-pro-max` + `impeccable` antes de criar/modificar UI
- SEMPRE skill `brainstorming` no planejamento do orquestrador: obrigatória antes de qualquer tarefa criativa (nova funcionalidade/componente/página/mudança de comportamento) — explorar contexto, perguntar 1 por vez, propor 2-3 abordagens e apresentar design com aprovação do usuário antes de delegar implementação (HARD-GATE)
- Comandos canônicos na raiz: `npm run build`, `npm test`, `npm run test:coverage`, `npm run test:e2e`

## Fluxo de Trabalho

**O agente principal da GUI é o orquestrador**: ele coordena o pipeline e delega diretamente aos especialistas. Os agentes de QA foram **substituídos por Quality Gate automático** (plugin `.opencode/plugins/pipeline-orchestrator.ts`): build, teste unitário e cobertura rodam de forma síncrona na transição dev → code-reviewer, bloqueando a revisão se qualquer etapa falhar ou a cobertura ficar abaixo de `COVERAGE_THRESHOLDS`.

O agente principal/orquestrador é o único agente autorizado a chamar outros agentes. Ele deve executar as fases abaixo em ordem, interromper em falhas e retornar a correção ao especialista adequado:

1. Planejamento e impacto.
2. Desenvolvimento com `dev-frontend`.
3. Quality gate automático (plugin): ao delegar `code-reviewer`, o plugin roda build + teste unitário + cobertura; falha → volta para o dev de origem corrigir.
4. Revisão com `code-reviewer`.
5. Gate final, `gitnexus_detect_changes` quando disponível e pedido de aprovação antes do commit.

> **Registry mecânico (FASE 1)**: o estado da tarefa vive em `.opencode/pipeline/state.json` e as delegações são validadas mecanicamente pelo plugin — delegar ao dev sem tarefa ativa cria a entrada; delegar a outro agente sem tarefa ativa é bloqueado (`[PIPELINE-REGISTRY]`). Formato de checkpoint `[ORCH][Fase X]` inalterado.

Antes e depois de cada chamada `task_tool_set`, publique um checkpoint curto no chat principal usando este formato:

```text
[ORCH][Fase X] INICIANDO|CONCLUÍDO|BLOQUEADO — agente: <nome> — tarefa: <resumo> — task_id: <id> — resultado: <resumo>
```

O checkpoint deve mostrar o agente, a fase, o task ID, o status, os arquivos/testes relevantes e o bloqueio, quando houver. Não replique raciocínio interno ou cada comando do especialista; mostre marcos operacionais e o relatório final verificável.

| Tag | Especialista | Função |
|-----|-------------|--------|
| `@dev-frontend` | Desenvolvimento frontend | Frontend React/TS |
| `@code-reviewer` | Code reviewer | Revisão de código |
| Quality gate (plugin) | Automático | Build + teste unitário + cobertura na transição dev → review |

## Recursos

| Recurso | Local |
|---------|-------|
| Agente frontend | `.opencode/agents/dev-frontend.md` |
| Agente code-reviewer | `.opencode/agents/code-reviewer.md` |
| Plugin quality gates | `.opencode/plugins/pipeline-orchestrator.ts` |
| Skill tecladista-architecture | `.opencode/skills/tecladista-architecture/` — regras de arquitetura |
| Skill tecladista-guides | `.opencode/skills/tecladista-guides/` — guias de codificação React/TS |
| Skill unit-testing-frontend | `.opencode/skills/unit-testing-frontend/` — obrigatória antes de criar/modificar testes unitários |
| Skill ui-ux-pro-max | `.opencode/skills/ui-ux-pro-max/` — obrigatória antes de criar/modificar UI (styles, paletas, tipografia, UX, charts) |
| Skill impeccable | `.opencode/skills/impeccable/` — obrigatória antes de criar/modificar UI, junto com ui-ux-pro-max (design language, revisão visual, design systems) |
| Skill omniroute-testgen | `.opencode/skills/omniroute-testgen/` — geração de testes via IA |
| Skill brainstorming (global) | `~/.config/opencode/skills/brainstorming/SKILL.md` — obrigatória no planejamento do orquestrador (HARD-GATE) |
| Commands | `.opencode/commands/*.md` |
| Config | `./opencode.json` |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tecladista-ia** (33 symbols, 27 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/tecladista-ia/context` | Codebase overview, check index freshness |
| `gitnexus://repo/tecladista-ia/clusters` | All functional areas |
| `gitnexus://repo/tecladista-ia/processes` | All execution flows |
| `gitnexus://repo/tecladista-ia/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
