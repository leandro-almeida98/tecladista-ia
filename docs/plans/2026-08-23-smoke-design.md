# Design — Smoke test do pipeline: flag `--version` no report

**Data:** 2026-08-23
**Status:** APROVADO pelo usuário
**Tipo:** micro-feature de validação ponta a ponta do harness

## Objetivo

Atravessar o pipeline completo (planejamento → dev → gate → review → pré-commit → commit)
com uma feature mínima e real, gerando métricas/auditoria para validar o harness.

## Feature

Flag `--version` / `-v` no CLI `.opencode/pipeline/report.mjs`:

1. Adicionar campo `"version": "0.1.0"` ao `package.json` da raiz
2. `report.mjs`: ao receber `--version` ou `-v`, imprimir a versão lida do
   `package.json` da raiz (resolvido relativo ao próprio script via `import.meta.url`,
   caminho `../../package.json`) e sair com exit 0. Se versão ausente/ilegível,
   imprimir `unknown` (nunca throw).
3. Atualizar `.opencode/commands/pipeline-report.md` citando a flag.

## Fora de escopo

Qualquer outra alteração (scaffold do app continua pendente).

## Critérios de aceite

- `node .opencode/pipeline/report.mjs --version` → imprime `0.1.0`
- Comportamento existente (`--json`, `--path`, default) inalterado
- `npx tsc --noEmit` exit 0 · `npx vitest run` verde (239+)
- Smoke executado em 2026-08-23 — feature commitada em 38dbeb3 (feat: add --version flag to report cli); esta nota valida o registry mecanicamente.

## Testes

Cobertura do gate roda na transição dev→reviewer (build/test/coverage reais).
report.mjs é `.mjs` fora do glob de cobertura — verificação manual do flag
pelo dev + suite existente verde é suficiente.

## Execução

- Validação mecânica executada em 2026-08-23 — registry ativo, entrada criada por hook do plugin.
