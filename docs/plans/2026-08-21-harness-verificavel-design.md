# Design — Harness verificável do pipeline (5 fases)

**Data:** 2026-08-21
**Status:** FASE 1 aprovada pelo usuário (decisões 1–5 + plano de arquivos)
**Spec original:** prompt do usuário (transformar convenção em código verificável)

## Visão geral

Converter as regras de prosa do pipeline multi-agente em mecanismos verificáveis:

| Fase | Entrega | Commit |
|---|---|---|
| 1 | Registry persistido (`.opencode/pipeline/state.json`) + bloqueio mecânico de delegação inválida | separado |
| 2 | Todas as transições mecanizadas (design doc, detect_changes, aprovação humana) | separado |
| 3 | Loop de auto-correção com MAX_RETRIES=2 e escala humana estruturada | separado |
| 4 | Self-correction nos devs (testes locais até verde, máx. 3 ciclos internos) | separado |
| 5 | Telemetria JSONL (`metrics.jsonl`) + comando `pipeline:report` | separado |

## Decisões aprovadas

1. **Infra de testes agora** (pré-requisito): `package.json` raiz mínimo (só devDeps:
   vitest, @vitest/coverage-v8, @opencode-ai/plugin, typescript, @types/node), scripts
   canônicos (`build`=tsc --noEmit, `test`, `test:coverage`), `tsconfig.json` strict,
   `vitest.config.ts` com `thresholds.perFile` 95% escopado ao código do pipeline.
   Efeito: quality gate sai do modo bootstrap e passa a exigir os 95% no código novo.
2. **Registry por feature**: taskId gerado (slug+timestamp), UMA entrada ativa por vez.
   Delegação p/ dev sem entrada ativa = cria entrada (feature extraída dos args);
   delegação p/ reviewer/commit sem entrada ativa = bloqueio mecânico c/ mensagem
   da pré-condição faltante.
3. **Runtime artifacts fora do git**: `.opencode/pipeline/state.json` e `metrics.jsonl`
   no `.gitignore`. Persistência em disco cobre sobrevivência a restart (critério 3).
4. **FASE 4 sem dev-backend**: agente não existe neste projeto (React-only).
   Self-correction aplicada só ao `dev-frontend.md`.
5. **FASE 3 risco SDK**: spawn automático de task de correção depende da superfície
   `client.session.*`. Se não suportar spawn de subagent, fallback = erro estruturado
   que obriga o orquestrador a re-delegar (semi-automático) + registro no registry.

## Restrições (da spec)

- Não quebrar gates existentes nem formato de checkpoint `[ORCH][Fase X]`.
- Config nova sempre em `OPTIONS` do plugin.
- Plugin com testes unitários (bloqueio, retry, limite) — TDD RED→GREEN→REFACTOR.
- Cobertura mínima 95% no código novo do plugin.
- Commit só com aprovação explícita do usuário.

## FASE 1 — plano de arquivos (aprovado)

| Ação | Arquivo |
|---|---|
| NOVO | `package.json`, `tsconfig.json`, `vitest.config.ts` (infra) |
| NOVO | `.opencode/pipeline/registry.ts` — módulo puro (schema, CRUD, write atômico) |
| NOVO | `tests/pipeline/registry.test.ts` — TDD (fora de `plugins/` p/ evitar auto-load do opencode) |
| MODIF | `.opencode/plugins/pipeline-orchestrator.ts` — integra registry + export `__internals` |
| MODIF | `.gitignore`, `AGENTS.md`, `.opencode/agents/orquestrador.md` |

## FASE 2 — decisões (aprovadas em 2026-08-21)

- **planejamento→dev**: criação de entrada exige design doc (`docs/plans/YYYY-MM-DD-*-design.md`)
  extraído dos args da task E existente em disco; ausente → bloqueio nomeando a pré-condição.
- **dev→reviewer**: gate atual roda; cada step vira `GateResult` gravado em `entry.gateResults`.
- **reviewer→final**: after-hook intercepta tool `detect_changes` bem-sucedida → grava
  `entry.detectChangesReport`.
- **commit**: guarda no hook `bash` — `git commit/push` do code-reviewer exige
  `detectChangesReport` E `aprovacaoHumana`; `git add` exige entrada ativa.
- **aprovacaoHumana mecânico**: after-hook na tool `question` — pergunta casa `/commit|push/i`
  + label afirmativo → `{por:'usuario', em}` (fail-safe).
- Dívidas FASE 1 quitadas: W2 (invariante violada bloqueia tudo até correção manual do state),
  `OPTIONS.allowedTargets`, validação de shape de `gateResults`.

## FASE 3 — decisões (aprovadas em 2026-08-21)

- Gate falho → registra ciclo de retry (`entry.retryHistory: [{ts, motivo, modo}]`),
  `retries++` (reset a 0 quando o gate passa).
- `retries ≤ OPTIONS.maxRetries (2)`: tenta spawn automático de task de correção no dev
  de origem via SDK (`client.session.*`) com o erro completo; spawn indisponível →
  fallback semi-auto (throw estruturado obrigando o orquestrador a re-delegar).
- Esgotado: fase = `escala_humano` + relatório estruturado (fase, erro, tentativas,
  arquivos suspeitos = coverage targets ∪ paths citados nas linhas de falha).
  Delegações permanecem bloqueadas até intervenção.
- `OPTIONS`: `maxRetries`, `autoRetryEnabled`, `autoSpawnRetry` (capability-detect).

## FASE 4 — decisões (aprovadas em 2026-08-21)

- Self-correction de até 3 ciclos internos no `dev-frontend.md` antes de devolver: `npx vitest run` + `npx tsc --noEmit`, corrigir causa raiz, reportar `ciclos: N/3` (+ motivo quando N>1); reduz retries no quality gate, que segue como rede de segurança.
- Testes leves locais (`vitest run` / `tsc --noEmit`), não o gate completo do plugin (`build` + `test:coverage`); complementa TDD (RED → GREEN → REFACTOR) sem conflitar com a regra de não rodar verificações pesadas fora do gate.
- `dev-backend.md` inaplicável: projeto React-only — arquivo não existe (deletado na adaptação React/Vite); FASE 4 aplicada somente ao `dev-frontend`.

## FASE 5 — decisões (aprovadas em 2026-08-22)

- **Telemetria JSONL**: `.opencode/pipeline/metrics.ts` com tipo `MetricEvent { ts, evento: "gate_run"|"gate_fail"|"retry"|"transicao"|"commit"|"escala_humano", taskId, detalhe? }` e funções `recordMetric(metricsPath, event)` (append JSONL, cria dir, nunca throw), `readMetrics`, `clearMetrics` (útil p/ testes). `metricsPath` default `.opencode/pipeline/metrics.jsonl` relativo à raiz; `.gitignore` desde FASE 1.
- **Report**: `.opencode/pipeline/report.mjs` (node executável, sem deps, shebang, chmod +x) lê JSONL tolerante (ignora vazias/corrompidas) e calcula: taxa reprovação = gate_fail/gate_run, média retries = retry / tasks distintas, tempo médio por fase (média de durações em transicao com detalhe.duracao/duration — senão "N/A"), concluídas vs escaladas (commit vs escala_humano counts), total eventos, tasks distintas. Flags `--path <arquivo>` e `--json`.
- **Plugin**: `OPTIONS.metricsEnabled=true, metricsPath="..."`; importa `recordMetric`; emite em cada ponto relevante dentro de try/catch (gate_run ao iniciar runGate, gate_fail+retry/escala dentro de processarFalhaGate, transicao bem-sucedida após fase concluída e após gate passar, commit via bash guard sucesso). `__internals` expõe `recordMetric` p/ testes.
- **Comando**: `.opencode/commands/pipeline-report.md` com descrição + passos para rodar o report.

## Limitação GitNexus documentada

Índice não cobre `.opencode/plugins/*.ts` (`impact(PipelineOrchestrator)` → not found,
risk UNKNOWN). Blast radius manual: hooks `task`/`bash`; único consumidor é o loader
do opencode. Mitigação: testes unitários obrigatórios (spec) + cobertura 95%.
