---
description: Gera relatório de telemetria do pipeline
---
# Pipeline Report
1. Rode `node .opencode/pipeline/report.mjs` (ou com --json; `--version`/`-v` imprime a versão e sai)
2. Reporte taxa de reprovação, média de retries, tempo por fase, concluídas vs escaladas

## Shape do JSON (`--json`)
- `tempoMedioPorFase`: **objeto** `{ <fase>: <média ms> }` (agrupado por `detalhe.fase` dos eventos `transicao`), não mais um número único. `null`/`{}` quando não há transições com duração. Ex.: `{ "desenvolvimento": 2000 }`.
- `tokens`: `{ input, output, reasoning, cacheRead, cacheWrite, cost }` somado dos eventos `tokens`; `null` quando não há. `cost` é somado de `detalhe.cost` (canônico) — `tokens.cost` é redundante (mesmo valor) e ignorado para evitar duplicação.
- `tokensPorFeature`: `{ <feature>: { input, output, reasoning, cacheRead, cacheWrite, cost } }`; `null` quando não há.
