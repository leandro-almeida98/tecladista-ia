# Design — Investigação de rastreamento de tokens no harness

**Data:** 2026-08-24
**Status:** APROVADO pelo usuário
**Tipo:** investigação (sem mudança de produção)

## Objetivo

Descobrir se o SDK do opencode expõe uso de tokens (entrada/saída) nos hooks de plugin,
para decidir se dá pra adicionar rastreamento de tokens por evento ao harness.

## Escopo

Investigação read-only: tipos do SDK, hooks, eventos de chat, sessão. Nenhuma mudança
de código de produção. Relatório de viabilidade + recomendação.