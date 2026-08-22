---
description: Pipeline TDD completo — teste falhando → implementa → refatora → revisa.
---

# Pipeline TDD Tecladista IA

1. Entender requisito
2. Delegar para `@dev-frontend` escrever o teste que falha (RED) — o dev carrega a skill `unit-testing-frontend`, roda o teste e confirma a falha
3. Implementar o mínimo para passar (GREEN)
4. Refatorar se necessário (REFACTOR)
5. Delegar para `@code-reviewer` — o quality gate automático (plugin `pipeline-orchestrator`) roda build + teste unitário + cobertura antes da revisão
6. Perguntar ao usuário: commitar?
