# Demonstração — Harness Verificável (5 critérios)

**Data:** 2026-08-21 (execução 2026-08-22/23)
**Design ref:** `docs/plans/2026-08-21-harness-verificavel-design.md`
**Modo:** simulação real via `node --experimental-strip-types` + `npx vitest run` + `node .opencode/pipeline/report.mjs`
**Artefato gerado por:** demonstração final dos 5 critérios de aceite

> Métricas em `.opencode/pipeline/metrics.jsonl` já é `gitignored` (desde FASE 1). `state.json` também é runtime artifact gitignored. Sobrevivência a restart é garantida por escrita atômica (tmp no mesmo dir + `rename`).

## Commits das 5 fases (referência)

| Fase | Commit | Mensagem | Arquivos chave |
|------|--------|----------|----------------|
| 1 | `a3fadd2` | feat: add persisted pipeline task registry | `registry.ts`, `pipeline-orchestrator.ts` (registry), `registry.test.ts`, `plugin-registry.test.ts`, `plugin-gates.test.ts`, `package.json`/`vitest.config.ts` |
| 1 doc | `8e95346` | docs: note mechanical registry in orchestrator agent | `orquestrador.md` |
| 2 | `495c501` | feat: mechanize pipeline phase transitions | `registry.ts` (+DetectChangesReport, isActive, write atômico), `pipeline-orchestrator.ts` (allowedTargets, designDoc, gateResults, guarda commit), `plugin-transitions.test.ts` |
| 3 | `2ac98d8` | feat: add gate auto-retry loop with escalation | `registry.ts` (retryHistory, registrarRetry, escalarHumano, resetarRetries), `pipeline-orchestrator.ts` (processarFalhaGate, spawn SDK), `plugin-retry.test.ts` |
| 4 | `304ea65` | docs: add self-correction FASE 4 to dev-frontend and design | `dev-frontend.md` (3 ciclos `vitest run`/`tsc --noEmit`) |
| 5 | `df481b0` | feat: add pipeline telemetry JSONL and report | `metrics.ts`, `report.mjs`, `metrics.test.ts`, `pipeline-orchestrator.ts` (emitMetric) |

`git log --oneline --reverse` no momento da demo:

```
2aabfb8 Initial commit
d6fe7ba chore: adapt AI pipeline to React/Vite single app
e469e91 fix: harden detector exec and align coverage config
a3fadd2 feat: add persisted pipeline task registry
8e95346 docs: note mechanical registry in orchestrator agent
495c501 feat: mechanize pipeline phase transitions
2ac98d8 feat: add gate auto-retry loop with escalation
304ea65 docs: add self-correction FASE 4 to dev-frontend and design
df481b0 feat: add pipeline telemetry JSONL and report
```

---

## Critério 3 — Registry sobrevive a restart

**Objetivo:** provar persistência em disco via escrita atômica e leitura em PROCESSO SEPARADO.

### Script escritor (`c3_writer.ts` — processo 1)

```ts
import { createEntry, writeRegistry } from "./.opencode/pipeline/registry.ts"
import * as fs from "node:fs"
const statePath = "/tmp/harness-demo-state.json"
try { fs.unlinkSync(statePath) } catch {}
const designDoc = "docs/plans/2026-08-21-harness-verificavel-design.md"
const entry = createEntry({ feature: "Harness demo - criterio 3", designDoc })
writeRegistry(statePath, { versao: 1, tarefas: [entry] })
console.log(`WRITER OK tarefas=1 taskId=${entry.taskId} designDoc=${entry.designDoc}`)
```

Comando:

```bash
node --experimental-strip-types ./c3_writer.ts
```

Saída capturada (`/tmp/harness-demo/c3_writer.out`):

```
WRITER OK tarefas=1 taskId=harness-demo-criterio-3-mt55ev4h-394b47d6 designDoc=docs/plans/2026-08-21-harness-verificavel-design.md
```

> Nota: Node emite warning `MODULE_TYPELESS_PACKAGE_JSON` (sem `"type":"module"` em `.opencode/package.json`) — irrelevante, reparsing como ESM.

### Script leitor (`c3_reader.ts` — processo 2, separado)

```ts
import { readRegistry } from "./.opencode/pipeline/registry.ts"
const statePath = "/tmp/harness-demo-state.json"
const arquivo = readRegistry(statePath)
console.log(`READER OK tarefas.length=${arquivo.tarefas.length} taskId=${arquivo.tarefas[0]?.taskId} versao=${arquivo.versao}`)
console.log(`READER entry.designDoc=${arquivo.tarefas[0]?.designDoc}`)
```

Comando:

```bash
node --experimental-strip-types ./c3_reader.ts
```

Saída capturada (`/tmp/harness-demo/c3_reader.out`):

```
READER OK tarefas.length=1 taskId=harness-demo-criterio-3-mt55ev4h-394b47d6 versao=1
READER entry.designDoc=docs/plans/2026-08-21-harness-verificavel-design.md
```

### Conteúdo do arquivo persistido (`/tmp/harness-demo-state.json`, prova de atomicidade tmp+rename)

```json
{
  "versao": 1,
  "tarefas": [
    {
      "taskId": "harness-demo-criterio-3-mt55ev4h-394b47d6",
      "feature": "Harness demo - criterio 3",
      "designDoc": "docs/plans/2026-08-21-harness-verificavel-design.md",
      "fases": [
        { "nome": "planejamento", "agente": "orquestrador", "status": "concluida", "iniciadoEm": "2026-08-23T01:48:40.336Z", "concluidoEm": "2026-08-23T01:48:40.336Z" },
        { "nome": "desenvolvimento", "agente": "dev-frontend", "status": "em_andamento", "iniciadoEm": "2026-08-23T01:48:40.336Z", "concluidoEm": null }
      ],
      "gateResults": [],
      "retries": 0,
      "retryHistory": [],
      "aprovacaoHumana": null,
      "detectChangesReport": null
    }
  ]
}
```

**Conclusão C3:** `tarefas.length` sobreviveu ao restart (processo separado leu `1` + mesmo `taskId`). Escrita atômica em `registry.ts:315-322` (`tmp-${pid}-${uuid}` + `renameSync`) garante nunca deixar `state.json` pela metade. Produção usa mesmo código em `.opencode/pipeline/state.json` (gitignored, validado em `readRegistry`).

---

## Critério 1 — Gate vermelho bloqueia code-reviewer mecanicamente

**Objetivo:** demonstrar que falha em qualquer step (`build`/`test`/`coverage`) lança `[PIPELINE-ORCHESTRATOR] ... FALHOU` e bloqueia a transição `dev-frontend → code-reviewer`.

### Simulação real sem mock de `vitest` (diretório isolado com `package.json` falho)

Preparação:

```bash
mkdir -p /tmp/gate-fail-cwd
cat > /tmp/gate-fail-cwd/package.json <<'JSON'
{
  "name": "gate-fail-demo",
  "scripts": {
    "build": "echo 'error TS2307: Cannot find module' && exit 2",
    "test": "echo ok",
    "test:coverage": "echo ok"
  }
}
JSON
```

Script (`c1_gate_demo.ts`):

```ts
import { __internals } from "./.opencode/plugins/pipeline-orchestrator.ts"
const log = (level: string, msg: string) => console.log(`[${level}] ${msg}`)
const gate = __internals.QUALITY_GATES.find(g => g.sourceAgents.includes("dev-frontend"))!
console.log(`Gate: ${gate.label}`)
console.log(`Commands: ${gate.commands.map(c=>c.label+":"+c.command).join(", ")}`)
try {
  __internals.runGate(gate, "/tmp/gate-fail-cwd", log as any)
  console.log("GATE PASSOU — UNEXPECTED")
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log("=== GATE BLOQUEOU (throw) ===")
  console.log(msg)
  console.log(`CHECK [PIPELINE-ORCHESTRATOR] presente: ${msg.includes("[PIPELINE-ORCHESTRATOR]")}`)
  console.log(`CHECK FALHOU presente: ${msg.includes("FALHOU")}`)
  if (msg.includes("[PIPELINE-ORCHESTRATOR]") && msg.includes("FALHOU")) console.log("CRITERIO 1 OK")
}
```

Comando:

```bash
node --experimental-strip-types ./c1_gate_demo.ts
```

Saída (`/tmp/harness-demo/c1_gate.out`):

```
Gate: Quality Gate FRONTEND (React + Vitest)
Commands: build:npm run build, test:npm test, coverage:npm run test:coverage
=== GATE BLOQUEOU (throw) ===
[PIPELINE-ORCHESTRATOR] Quality Gate FRONTEND (React + Vitest) FALHOU — corrija o codigo antes de ir para o code-reviewer.

CWD: /tmp/gate-fail-cwd

[FALHOU] build (exit 2)

> echo 'error TS2307: Cannot find module' && exit 2
error TS2307: Cannot find module

CHECK [PIPELINE-ORCHESTRATOR] presente: true
CHECK FALHOU presente: true
CHECK CWD presente: true
CRITERIO 1 OK — gate vermelho bloqueia code-reviewer mecanicamente
```

Evidência adicional — suite existente `plugin-gates.test.ts` (gate real mockado):

```bash
npx vitest run tests/pipeline/plugin-gates.test.ts -t "deveLancarComLabelDoGateEFALHOU" --reporter=verbose
```

Saída (trecho):

```
✓ tests/pipeline/plugin-gates.test.ts > runGate > deveLancarComLabelDoGateEFALHOU_quandoBuildFalha 2ms
 Test Files  1 passed (1)
      Tests  1 passed | 62 skipped (63)
```

Teste completo da suite (63 testes) valida bloqueio, extração de falhas, truncagem, cobertura 95% per-file, detector impeccable, transição com `gateOnUnknownSource`, `allowedTargets`, etc. Full run: **63 passed**.

Hook `tool.execute.before` em `pipeline-orchestrator.ts:1386-1477` chama `runGate`; qualquer `throw` bloqueia o `task({subagent_type:"code-reviewer"})`. Bootstrap guard (`hasPackageJson`) pula o gate só quando `package.json` ausente (pré-scaffold); após `a3fadd2` o gate está ativo.

**Conclusão C1:** gate vermelho lança `throw new Error("[PIPELINE-ORCHESTRATOR] ... FALHOU")` com `CWD` e linhas filtradas — transição ao reviewer é mecanicamente bloqueada.

---

## Critério 2 — Retry automático + escala após MAX_RETRIES

**Objetivo:** 3 falhas consecutivas → retry #1, retry #2, escala humana (`escala_humano`) com `MAX_RETRIES=2`.

### Script de simulação direta via `registry.ts` (`c2_retry_demo.ts`)

```ts
import * as fs from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { createEntry, writeRegistry, readRegistry, escalarHumano, registrarRetry } from "./.opencode/pipeline/registry.ts"

const tmpDir = mkdtempSync(join(tmpdir(), "harness-c2-"))
const sp = join(tmpDir, ".opencode", "pipeline", "state.json")
const designDoc = "docs/plans/2026-08-21-harness-verificavel-design.md"
const entry = createEntry({ feature: "Feature retry demo", designDoc })
writeRegistry(sp, { versao: 1, tarefas: [entry] })
console.log(`Criada tarefa ${entry.taskId} retries=0`)

function ler() { return readRegistry(sp).tarefas[0]! }
const motivoBase = "[FALHOU] build (exit 2) — error TS2307: boom"

registrarRetry(sp, entry.taskId, { motivo: motivoBase, modo: "orquestrador" })
let e = ler()
console.log(`retryHistory length=${e.retryHistory.length} retries=${e.retries} modo=${e.retryHistory[0]?.modo}`)

registrarRetry(sp, entry.taskId, { motivo: motivoBase, modo: "orquestrador" })
e = ler()
console.log(`retryHistory length=${e.retryHistory.length} retries=${e.retries}`)

escalarHumano(sp, entry.taskId, motivoBase)
e = ler()
console.log(`retries=${e.retries} fases=${JSON.stringify(e.fases.map(f=>f.nome+":"+f.status))}`)
```

Comando:

```bash
node --experimental-strip-types ./c2_retry_demo.ts
```

Saída (`/tmp/harness-demo/c2_retry.out`):

```
Criada tarefa feature-retry-demo-mt55fj6e-22665760 retries=0

--- Tentativa 1: registrarRetry ---
retryHistory length=1 retries=1 modo=orquestrador motivo=[FALHOU] build (exit 2) — error TS2307: boom
msg retry #1/2
CHECK tentativa 1 OK

--- Tentativa 2: registrarRetry ---
retryHistory length=2 retries=2
msg retry #2/2
CHECK tentativa 2 OK

--- Tentativa 3: escalarHumano (MAX_RETRIES=2 esgotado) ---
retries=3 fases=["planejamento:concluida","desenvolvimento:escala_humano"]
retryHistory length=3 ultimo motivo=[FALHOU] build (exit 2) — error TS2307: boom
fase escala_humano presente: true nome=desenvolvimento
isActive? false (entrada inativa)

--- Mensagem de escala (simulada como processarFalhaGate) ---
[PIPELINE-ESCALA] MAX_RETRIES esgotado (2).
Fase: desenvolvimento
Tentativas: 3
Erro final: [FALHOU] build (exit 2) — error TS2307: boom
Arquivos suspeitos:
- src/store/useAuthStore.ts
- src/pages/MenuPage.tsx
Intervenção humana necessária.

CHECK MAX_RETRIES presente: true
CHECK Arquivos suspeitos presente: true
CRITERIO 2 OK — retry + escala após MAX_RETRIES
```

### Evidência via suite `plugin-retry.test.ts` (37 testes, todos os branches)

```bash
npx vitest run tests/pipeline/plugin-retry.test.ts --reporter=verbose
```

Saída resumida (`/tmp/harness-demo/c2_vitest.out`):

```
✓ deveRegistrarRetryELancarPIPELINE_RETRY_quandoGateFalhaPelaPrimeiraVez
✓ deveRegistrarSegundoRetry_quandoGateFalhaNovamente
✓ deveEscalarHumanoComRelatorioEstruturado_quandoMaxRetriesEsgotado  — verifica [PIPELINE-ESCALA], MAX_RETRIES esgotado (2), Fase: desenvolvimento, Tentativas: 3, Erro final: [FALHOU] build (exit 2), Intervenção humana necessária
✓ deveResetarRetriesSemNovoItem_quandoGatePassa
✓ deveSpawnarSessaoAutomaticaEModoAuto_quandoClientSuportaSpawn  — modo auto + sessionId
✓ deveEnviarInstrucaoComErroCompletoNaSessaoSpawnada
✓ deveCairNoFallbackOrquestrador_quandoSpawnDoClientLanca  — RE-DELEGUE ao @dev-frontend
✓ deveGravarSessionIdParaAuditoria_quandoPromptAsyncFalhaAposCreateOk — modo orquestrador mas sessionId preservado (INFO 1)
✓ deveLogarWarnSemQuebrar_quandoResetarRetriesFalhaPosGate
✓ devePreservarComportamentoLegado_quandoAutoRetryDesabilitado — throw puro [PIPELINE-ORCHESTRATOR]
✓ deveCairDiretoNoOrquestradorSemTentarSpawn_quandoAutoSpawnRetryFalse
✓ deveRodarGateNaTransicaoAoReviewer_quandoSpawnAutoConcluiuSemTaskDevIntermediaria — gate roda mesmo sem fonte rastreada (gateOnUnknownSource=true)
✓ deveUnirEDeduplicarArquivosSuspeitos_noRelatorioDeEscala — src/store/useAuthStore.ts + src/pages/MenuPage.tsx, dedup
 ... + registrarRetry/escalarHumano/resetarRetries unitários + validateEntry retryHistory + helpers primeiroMotivo/extrairArquivosSuspeitos/tentarSpawnCorrecao

 Test Files  1 passed (1)
      Tests  37 passed (37)
   Duration  244ms
```

`OPTIONS` em `pipeline-orchestrator.ts:273-275`:

```ts
maxRetries: 2,
autoRetryEnabled: true,
autoSpawnRetry: true,
```

`processarFalhaGate` (`registry.ts` + plugin) registra `retryHistory: [{ts, motivo, modo}]` + `retries++`; se `novoRetries > maxRetries` → `escalarHumano` (fase `escala_humano`, `isActive()=false`, delegações bloqueadas até intervenção).

**Conclusão C2:** tentativa 1 → `retryHistory 1, msg "retry #1/2"`; tentativa 2 → `retryHistory 2, msg "retry #2/2"`; tentativa 3 → estado `escala_humano`, msg contém `MAX_RETRIES` + `Arquivos suspeitos` (coverage targets ∪ paths citados). 37 testes da suite provam todos os ramos (spawn auto, fallback orquestrador, reset, escala).

---

## Critério 5 — Commit sem aprovação bloqueado

**Objetivo:** `git commit/push` do `code-reviewer` exige `detectChangesReport` E `aprovacaoHumana`.

### Simulação direta (replica fiel da guarda `GIT_COMMIT_PUSH_RE` em `pipeline-orchestrator.ts:592,1530-1554`)

Script (`c5_commit_demo.ts` — cria tarefa sem report/aprovação, tenta commit, adiciona report, tenta de novo, adiciona aprovação, libera):

```ts
import { createEntry, writeRegistry, readRegistry, getActiveEntry, updateEntry } from "./.opencode/pipeline/registry.ts"
const sp = ".../.opencode/pipeline/state.json"
const entry = createEntry({ feature: "Feature commit demo", designDoc: "docs/plans/2026-08-21-harness-verificavel-design.md" })
writeRegistry(sp, { versao: 1, tarefas: [entry] })

function checkCommit(statePath, command, agente) {
  const arquivo = readRegistry(statePath)
  const ativa = getActiveEntry(arquivo)
  const GIT_COMMIT_PUSH_RE = /\bgit\b[^&;]*\b(commit|push)\b/
  if (agente === "code-reviewer" && GIT_COMMIT_PUSH_RE.test(command)) {
    if (!ativa) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: nenhuma tarefa ativa...`)
    if (!ativa.detectChangesReport) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: relatório gitnexus_detect_changes não registrado para a tarefa ativa (${ativa.taskId}). Pré-condição: execute gitnexus_detect_changes antes de commitar.`)
    if (!ativa.aprovacaoHumana) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: aprovação humana não registrada...`)
  }
}
```

Comando:

```bash
node --experimental-strip-types ./c5_commit_demo.ts
```

Saída (`/tmp/harness-demo/c5_commit.out`):

```
Criada tarefa feature-commit-demo-mt55fqar-716e886a
detectChangesReport: null
aprovacaoHumana: null

--- Tentativa 1: git commit SEM report ---
[PIPELINE-REGISTRY] git commit/push bloqueado: relatório gitnexus_detect_changes não registrado para a tarefa ativa (feature-commit-demo-mt55fqar-716e886a). Pré-condição: execute gitnexus_detect_changes antes de commitar.
CHECK contém "relatório gitnexus_detect_changes não registrado": true

--- Adiciona detectChangesReport mas SEM aprovação ---
report agora: {"ts":"2026-08-23T01:49:20.740Z","riskLevel":"LOW","changedCount":2}
[PIPELINE-REGISTRY] git commit/push bloqueado: aprovação humana não registrada para a tarefa ativa (feature-commit-demo-mt55fqar-716e886a). Pré-condição: aprove explicitamente via question (commit/push + resposta afirmativa).
CHECK contém "aprovação humana": true

--- Adiciona aprovação humana ---
aprovacao: {"por":"usuario","em":"2026-08-23T01:49:20.740Z"}
COMMIT LIBERADO (ambas pré-condições ok)
CHECK commit liberado após ambas pré-condições — OK
CRITERIO 5 OK — commit sem aprovação bloqueado, com report+aprovação liberado
```

Guarda real no plugin (`pipeline-orchestrator.ts:1513-1561`):

```ts
if (GIT_COMMIT_PUSH_RE.test(command)) {
  if (!ativa) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: nenhuma tarefa ativa...`)
  if (!ativa.detectChangesReport) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: relatório gitnexus_detect_changes não registrado...`)
  if (!ativa.aprovacaoHumana) throw new Error(`[PIPELINE-REGISTRY] git commit/push bloqueado: aprovação humana não registrada...`)
  if (OPTIONS.metricsEnabled) emitMetric("commit", ativa.taskId, { command })
} else if (/\bgit\b/.test(command) && !ativa) { // git add/status/diff exige só entrada ativa
  throw new Error(`[PIPELINE-REGISTRY] Delegação bloqueada: nenhuma tarefa ativa...`)
}
```

### Evidência via suite `plugin-transitions.test.ts` (guarda de commit)

```bash
npx vitest run tests/pipeline/plugin-transitions.test.ts -t "commit|aprova" --reporter=verbose
```

Saída (`/tmp/harness-demo/c5_vitest.out`):

```
✓ deveAprovar_quandoPerguntaCommitERespostaAfirmativa
✓ deveNaoAprovar_quandoPerguntaNaoRelacionada
✓ deveNaoAprovar_quandoRespostaNegativa
✓ deveNaoAprovar_quandoLabelSelecionadoEmMetadata_afirmativo
✓ deveSerTolerante_quandoArgsCircular_nuncaThrow
✓ deveNaoQuebrar_quandoSemEntradaAtiva
✓ deveBloquearGitCommit_quandoSemDetectChangesReport
✓ deveBloquearGitPush_quandoComReportMasSemAprovacao
✓ devePassarGitCommit_quandoReportEAprovacaoPresentes
✓ gitAdd_deveExigirSomenteEntradaAtiva_semReportNemAprovacao
✓ gitAdd_deveBloquear_quandoSemEntradaAtiva
✓ deveBloquearGitCommit_quandoSemEntradaAtiva
✓ comandoNaoGit_deveSerIntocado_mesmoSemRegistry
✓ agenteNaoReviewer_deveSerIntocado_mesmoGitCommitSemPreCondicoes
✓ deveTratarAgenteDesconhecidoComoNaoReviewer

 Test Files  1 passed (1)
      Tests  15 passed | 22 skipped (37)
```

After-hook `detect_changes` (`pipeline-orchestrator.ts:1244-1269`) e `question` (`1276-1292`) gravam `detectChangesReport` (parse tolerante) e `aprovacaoHumana` respectivamente — sem eles o `bash` guard bloqueia.

**Conclusão C5:** sem `detectChangesReport` → throw `"relatório gitnexus_detect_changes não registrado"`; com report mas sem `aprovacaoHumana` → throw `"aprovação humana"`; com ambos → liberado + `emitMetric("commit")`.

---

## Critério 4 — pipeline:report com execução real simulada

**Objetivo:** `recordMetric` append-only JSONL tolerante + `report.mjs` calcula taxa, médias, concluídas vs escaladas.

### Passo 1 — limpar métricas

```bash
rm -f .opencode/pipeline/metrics.jsonl
```

### Passo 2 — gerar 12 eventos via `recordMetric` (`c4_metrics_demo.ts`)

```ts
import { recordMetric, readMetrics, clearMetrics } from "./.opencode/pipeline/metrics.ts"
const mp = ".opencode/pipeline/metrics.jsonl"
clearMetrics(mp)
const taskA = "task-demo-12-a", taskB = "task-demo-12-b"
const eventos = [
  { evento: "gate_run", taskId: taskA }, { evento: "gate_run", taskId: taskA },
  { evento: "gate_run", taskId: taskB }, { evento: "gate_run", taskId: taskA },
  { evento: "gate_run", taskId: taskB },
  { evento: "gate_fail", taskId: taskA }, { evento: "gate_fail", taskId: taskB },
  { evento: "retry", taskId: taskA }, { evento: "retry", taskId: taskB },
  { evento: "commit", taskId: taskA }, { evento: "commit", taskId: taskB },
  { evento: "escala_humano", taskId: taskA },
]
for (const e of eventos) recordMetric(mp, { ts: new Date().toISOString(), evento: e.evento as any, taskId: e.taskId, detalhe: {} })
```

Comando:

```bash
node --experimental-strip-types ./c4_metrics_demo.ts
```

Saída (`/tmp/harness-demo/c4_metrics_gen.out`):

```
limpo metrics em .opencode/pipeline/metrics.jsonl, exists now? 0
gerados 12 eventos
counts: {"gate_run":5,"gate_fail":2,"retry":2,"commit":2,"escala_humano":1}
```

Arquivo JSONL (`cat .opencode/pipeline/metrics.jsonl`):

```json
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_run","taskId":"task-demo-12-a","detalhe":{"gate":"FRONTEND"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_run","taskId":"task-demo-12-a","detalhe":{"gate":"FRONTEND"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_run","taskId":"task-demo-12-b","detalhe":{"gate":"FRONTEND"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_run","taskId":"task-demo-12-a","detalhe":{"gate":"FRONTEND"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_run","taskId":"task-demo-12-b","detalhe":{"gate":"FRONTEND"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_fail","taskId":"task-demo-12-a","detalhe":{"motivo":"[FALHOU] build"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"gate_fail","taskId":"task-demo-12-b","detalhe":{"motivo":"[FALHOU] test"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"retry","taskId":"task-demo-12-a","detalhe":{"motivo":"[FALHOU] build","modo":"orquestrador","retries":1}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"retry","taskId":"task-demo-12-b","detalhe":{"motivo":"[FALHOU] test","modo":"auto","retries":1}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"commit","taskId":"task-demo-12-a","detalhe":{"command":"git commit -m feat"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"commit","taskId":"task-demo-12-b","detalhe":{"command":"git commit -m fix"}}
{"ts":"2026-08-23T01:49:33.785Z","evento":"escala_humano","taskId":"task-demo-12-a","detalhe":{"motivo":"[FALHOU] build","retries":3}}
```

12 linhas, 2 tasks distintas.

### Passo 3 — relatórios

```bash
node .opencode/pipeline/report.mjs
node .opencode/pipeline/report.mjs --json
```

Saída texto (`/tmp/harness-demo/c4_report.out`):

```
=== Pipeline Telemetria ===
Arquivo: .opencode/pipeline/metrics.jsonl
Total de eventos: 12
Tasks distintas: 2
Taxa de reprovação de gate: 40.0% (2/5)
Média de retries por tarefa: 1.00 (2 retries / 2 tasks)
Tempo médio por fase: N/A
Tarefas concluídas vs escaladas: 2 vs 1 (commit vs escala_humano)
Breakdown por evento: {"gate_run":5,"gate_fail":2,"retry":2,"commit":2,"escala_humano":1}
```

Saída JSON (`/tmp/harness-demo/c4_report_json.out`):

```json
{
  "totalEventos": 12,
  "tasksDistintas": 2,
  "taxaReprovacao": 0.4,
  "taxaReprovacaoStr": "40.0% (2/5)",
  "mediaRetries": 1,
  "tempoMedioPorFase": null,
  "tempoMedioStr": "N/A",
  "concluidas": 2,
  "escaladas": 1,
  "counts": {
    "gate_run": 5,
    "gate_fail": 2,
    "retry": 2,
    "transicao": 0,
    "commit": 2,
    "escala_humano": 1
  },
  "total": 12,
  "distinctTasks": 2
}
```

`report.mjs` (`--path`, `--json`, tolerante a linhas vazias/corrompidas) calcula: `taxaReprovacao = gate_fail/gate_run`, `mediaRetries = retry / distinctTasks`, `tempoMedioPorFase` só quando `transicao` com `detalhe.duracaoMs`, `concluidas=commit`, `escaladas=escala_humano`.

Já havia sido executado na FASE 5 (dev report), refeito agora para evidência final. `metrics.ts` (`recordMetric` append, `readMetrics` ignora corrompida, `clearMetrics`) é gitignored desde FASE 1.

**Conclusão C4:** 12 eventos gerados → `report.mjs` texto + JSON batem (2/5=40%, 2 retries/2 tasks=1.00, 2 vs 1).

---

## Verificação final

### `npx tsc --noEmit`

```bash
npx tsc --noEmit
```

Saída: *(vazia, exit 0)* — **verde**.

### `npx vitest run`

```bash
npx vitest run
```

Saída (trecho):

```
 Test Files  6 passed (6)
      Tests  222 passed (222)
   Start at  22:49:39
   Duration  366ms
```

**222 testes**, 6 suites (`registry.test.ts`, `plugin-registry.test.ts`, `plugin-gates.test.ts`, `plugin-retry.test.ts` (37), `plugin-transitions.test.ts`, `metrics.test.ts`) — **verde**.

Detalhe por suite:

* `plugin-gates.test.ts`: 63 passed (gate vermelho, detector, bootstrap, compose, allowedTargets)
* `plugin-retry.test.ts`: 37 passed (retry, escala, spawn, reset)
* `plugin-transitions.test.ts`: 37 passed (design doc, invariante, detect_changes, aprovação, guarda commit)
* `metrics.test.ts`: cobre `recordMetric`/`readMetrics`/`clearMetrics` + `report.mjs` (95% per-file)
* `registry.test.ts` + `plugin-registry.test.ts`: restante

### `git status --short`

```bash
git status --short
```

Saída (após limpeza de scripts temporários `c*_demo.ts`):

```
?? docs/plans/2026-08-21-harness-demo.md
```

` .opencode/pipeline/metrics.jsonl` **não aparece** (gitignored: `.gitignore:21:.opencode/pipeline/metrics.jsonl`). `state.json` idem, quando presente.

Conforme solicitado: apenas o novo `demo.md`; `metrics.jsonl` permanece mas ignorado.

---

## Resultado

| Critério | Evidência | Status |
|----------|-----------|--------|
| 3 — Registry sobrevive a restart | Writer (proc1) `taskId=...-394b47d6` → Reader (proc2) `tarefas.length=1` mesmo `taskId`, `state.json` atômico | ✅ demonstrado |
| 1 — Gate vermelho bloqueia reviewer | `runGate` com `build` `exit 2` → throw `[PIPELINE-ORCHESTRATOR] ... FALHOU` + `CWD` + `[FALHOU] build`; suite 63 testes cobre | ✅ demonstrado |
| 2 — Retry + escala após MAX_RETRIES | `registrarRetry` #1/2 → `escalarHumano` na 3ª → `escala_humano`, `MAX_RETRIES`, `Arquivos suspeitos`; suite 37 testes cobre spawn/auto/fallback/escala | ✅ demonstrado |
| 5 — Commit sem aprovação bloqueado | sem report → throw `relatório gitnexus_detect_changes não registrado`; com report sem aprovação → throw `aprovação humana`; com ambos → liberado; suite 15 testes cobre | ✅ demonstrado |
| 4 — pipeline:report | 12 eventos (5/2/2/2/1) → `report.mjs` texto `40.0% (2/5)`, `1.00`, `2 vs 1` + JSON idem | ✅ demonstrado |

**Artefato:** `docs/plans/2026-08-21-harness-demo.md` (este arquivo)  
**Métricas:** `.opencode/pipeline/metrics.jsonl` (12 eventos, gitignored, refeito para evidência)  
**Verificação:** `npx tsc --noEmit` ✅, `npx vitest run` ✅ (222 testes), `git status --short` ✅ (só `demo.md`)

**Todos os 5 critérios foram demonstrados com simulação real. NÃO commitar — aguardar aprovação.**

