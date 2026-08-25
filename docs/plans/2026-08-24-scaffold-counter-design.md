# Design — Smoke real: scaffold React/Vite + Counter + Playwright

**Data:** 2026-08-24
**Status:** APROVADO pelo usuário
**Tipo:** validação prática do harness com código real de app

## Objetivo

Provar o harness ponta a ponta com código real: scaffold do app React 19 + Vite + TS,
feature `Counter`, testes unitários Vitest + E2E Playwright, atravessando o pipeline
completo (design → dev → gate → review → detect_changes → aprovação → commit → auditoria).

## Escopo

1. Scaffold: `vite.config.ts` (react + vitest + coverage 95%/arquivo), `index.html`,
   `src/main.tsx`, `src/App.tsx`, `src/components/Counter.tsx`, `src/test/setup.ts`
2. Feature `Counter`: incrementar/decrementar
3. Unit: `Counter.test.tsx` (render, increment, decrement, edge)
4. E2E: `e2e/counter.spec.ts` (Playwright)
5. `package.json`: deps react/react-dom/vite/vitest/testing-library/jsdom + scripts
   dev/build/test/test:coverage/test:e2e
6. Cobertura 95%/arquivo no `src/` (main.tsx excluído do coverage — entry point)

## Critérios de aceite

- Gate REAL passa (tsc + vitest + cobertura ≥95%)
- Playwright spec roda (manual)
- Pipeline grava: registry, gateResults, tokens, auditoria, métricas