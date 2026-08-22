---
description: Pipeline completa de revisão — detect_changes + revisão pelo code-reviewer (+ build/teste se preciso).
---

# Revisão Tecladista IA

1. Execute `npx gitnexus analyze` se o índice estiver desatualizado
2. Execute `gitnexus_detect_changes()` para mapear alterações
3. Delegue para `@code-reviewer` revisar o diff completo
4. Build/teste/cobertura são responsabilidade do quality gate automático (plugin pipeline-orchestrator) na transição dev→reviewer; o reviewer apenas consome o relatório do gate
5. Reporte resultado ao usuário ([CRITICAL]/[WARN]/[INFO])
