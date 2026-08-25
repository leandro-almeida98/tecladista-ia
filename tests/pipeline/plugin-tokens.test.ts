/**
 * Testes do FIX 1 — TOKENS/CUSTO no harness:
 *   - event hook acumula tokens por sessão (message.updated + assistant);
 *   - flush no commit (after-hook bash exit 0) => evento `tokens` + auditoria;
 *   - flush na escala humana => evento `tokens` + auditoria;
 *   - report.mjs soma tokens/custo por feature + total (FIX 1.4).
 *
 * NENHUM comando real é executado: node:child_process é mockado; node:fs tem
 * existsSync mockado com fallback ao real. O registry usa fs real em tmpdir.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, type PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { PipelineOrchestrator } from "../../.opencode/pipeline/orchestrator-impl"
import { readAudit } from "../../.opencode/pipeline/audit"
import { createEntry, readRegistry, writeRegistry, type RegistryEntry } from "../../.opencode/pipeline/registry"
import { resetAllSessionTokens } from "../../.opencode/pipeline/metrics"

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, execSync: vi.fn(), execFileSync: vi.fn() }
})

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, existsSync: vi.fn() }
})

const execSyncMock = execSync as unknown as Mock
const execFileSyncMock = execFileSync as unknown as Mock
const existsSyncMock = existsSync as unknown as Mock

let realFs: typeof import("node:fs")

let tmpDir: string
let logs: { level: string; message: string }[]
let sessionGetImpl: () => Promise<unknown>

async function makeHooks() {
  logs = []
  const client = {
    app: {
      log: async (args: { body: { level: string; message: string } }) => {
        logs.push(args.body)
      },
    },
    session: { get: () => sessionGetImpl() },
  }
  return PipelineOrchestrator({ client, directory: tmpDir } as never)
}

type Hooks = Awaited<ReturnType<typeof makeHooks>>

const messages = (): string[] => logs.map((l) => l.message)

async function callEvent(hooks: Hooks, event: unknown): Promise<void> {
  const hook = hooks.event
  if (!hook) throw new Error("hook event ausente")
  await hook({ event } as never)
}

async function callBefore(
  hooks: Hooks,
  tool: string,
  args: Record<string, unknown>,
  sessionID = "sess-1",
): Promise<void> {
  const hook = hooks["tool.execute.before"]
  if (!hook) throw new Error("hook tool.execute.before ausente")
  await hook({ tool, sessionID, callID: "call-1" }, { args } as never)
}

async function callAfterTask(
  hooks: Hooks,
  opts: { subagent_type: string; completed: boolean },
): Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (!hook) throw new Error("hook tool.execute.after ausente")
  await hook(
    { tool: "task", sessionID: "sess-1", callID: "call-1", args: { subagent_type: opts.subagent_type } } as never,
    {
      title: "task",
      metadata: { sessionId: "sub-sessao-1" },
      output: opts.completed ? '... state="completed" ...' : '... state="error" ...',
    } as never,
  )
}

async function callAfterBash(
  hooks: Hooks,
  opts: { command: string; exit?: number; output?: string },
): Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (!hook) throw new Error("hook tool.execute.after ausente")
  await hook(
    { tool: "bash", sessionID: "sess-1", callID: "call-1", args: { command: opts.command } } as never,
    { title: "bash", metadata: { exit: opts.exit ?? 0 }, output: opts.output ?? "" } as never,
  )
}

function statePath(): string {
  return join(tmpDir, ".opencode", "pipeline", "state.json")
}

function metricsPath(): string {
  return join(tmpDir, ".opencode", "pipeline", "metrics.jsonl")
}

function historyPath(): string {
  return join(tmpDir, "docs", "pipeline-audit", "history.jsonl")
}

function criarTarefaAtiva(feature = "Feature de teste"): RegistryEntry {
  const entry = createEntry({ feature })
  writeRegistry(statePath(), { versao: 1, tarefas: [entry] })
  return entry
}

function lerJsonl(path: string): Record<string, unknown>[] {
  if (!realFs.existsSync(path)) return []
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** Evento message.updated do SDK com tokens/custo de uma sessão. */
function msgUpdated(sessionID: string, tokens: unknown, cost?: number): unknown {
  return {
    type: "message.updated",
    properties: {
      info: { sessionID, role: "assistant", tokens, ...(cost !== undefined ? { cost } : {}) },
    },
  }
}

interface FsFlags {
  pkg?: boolean
  compose?: boolean
  detector?: boolean
}

function setFsFlags(flags: FsFlags = {}): void {
  const { pkg = true, compose = false, detector = false } = flags
  existsSyncMock.mockImplementation((p: PathLike) => {
    const s = String(p)
    if (s.endsWith("package.json")) return pkg
    if (s.endsWith("docker-compose.yml")) return compose
    if (s.includes("detect-antipatterns.mjs")) return detector
    return realFs.existsSync(p)
  })
}

function mkExecError(props: { stdout?: string; stderr?: string; status?: number } = {}): Error {
  const err = new Error(`Command failed: exit ${props.status ?? -1}`) as Error & {
    stdout?: string
    stderr?: string
    status?: number
  }
  err.stdout = props.stdout
  err.stderr = props.stderr
  err.status = props.status
  return err
}

const OUTPUT_FALHA = [
  "RUN v4.1.11",
  "ERROR: Coverage for lines (31.67%) does not meet global threshold (95%) for src/store/useAuthStore.ts",
  "Tests failed",
].join("\n")

function falharBuild(): void {
  execSyncMock.mockImplementation((cmd: string) => {
    if (String(cmd).includes("npm run build")) {
      const err = new Error("Command failed: exit 2") as Error & { stdout: string; stderr: string; status: number }
      err.stdout = OUTPUT_FALHA
      err.stderr = ""
      err.status = 2
      throw err
    }
    return "ok"
  })
}

async function falharTransicao(hooks: Hooks): Promise<void> {
  await callAfterTask(hooks, { subagent_type: "dev-frontend", completed: true })
  return callBefore(hooks, "task", { subagent_type: "code-reviewer" })
}

beforeAll(async () => {
  realFs = await vi.importActual<typeof import("node:fs")>("node:fs")
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plugin-tokens-test-"))
  sessionGetImpl = async () => ({ agent: undefined })
  existsSyncMock.mockImplementation((p: PathLike) => realFs.existsSync(p))
  execSyncMock.mockReset()
  execFileSyncMock.mockReset()
  // acumulador de tokens é module-level (metrics.ts) — isola entre testes
  resetAllSessionTokens()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// event hook — acumulação por sessão
// ---------------------------------------------------------------------------
describe("event hook — acumulação de tokens por sessão (FIX 1)", () => {
  test("deveAcumularTokens_quandoMessageUpdatedAssistantComTokens", async () => {
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-a", { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } }, 0.01))
    await callEvent(hooks, msgUpdated("sess-a", { input: 200, output: 25 }, 0.02))
    await callEvent(hooks, msgUpdated("sess-b", { input: 999 }, 0.5))

    // flush no commit para materializar os tokens acumulados
    criarTarefaAtiva("Feature tokens")
    sessionGetImpl = async () => ({ agent: "code-reviewer" })
    await callAfterBash(hooks, { command: 'git commit -m "feat"' })

    const tokens = lerJsonl(metricsPath()).filter((e) => e["evento"] === "tokens")
    expect(tokens).toHaveLength(1)
    const det = tokens[0]?.["detalhe"] as Record<string, unknown>
    const t = det["tokens"] as Record<string, number>
    expect(t["input"]).toBe(1299)
    expect(t["output"]).toBe(75)
    expect(t["reasoning"]).toBe(10)
    expect(t["cacheRead"]).toBe(5)
    expect(t["cacheWrite"]).toBe(2)
    expect(t["cost"]).toBeCloseTo(0.53)
  })

  test("deveIgnorarEventosNaoAssistant_ouSemTokens", async () => {
    const hooks = await makeHooks()
    // role user
    await callEvent(hooks, { type: "message.updated", properties: { info: { sessionID: "s", role: "user", tokens: { input: 1 } } } })
    // sem tokens
    await callEvent(hooks, { type: "message.updated", properties: { info: { sessionID: "s", role: "assistant" } } })
    // outro tipo de evento
    await callEvent(hooks, { type: "message.removed", properties: {} })
    // sem sessionID
    await callEvent(hooks, msgUpdated("", { input: 1 }))

    criarTarefaAtiva("Feature ignorados")
    sessionGetImpl = async () => ({ agent: "code-reviewer" })
    await callAfterBash(hooks, { command: 'git commit -m "feat"' })

    const tokens = lerJsonl(metricsPath()).filter((e) => e["evento"] === "tokens")
    expect(tokens).toHaveLength(0)
  })

  test("deveNuncaThrow_quandoEventoMalformado", async () => {
    const hooks = await makeHooks()
    await expect(callEvent(hooks, null)).resolves.toBeUndefined()
    await expect(callEvent(hooks, { type: "message.updated", properties: { info: { sessionID: "s", role: "assistant", tokens: { input: "x" } } } })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// flush no commit (after-hook bash exit 0)
// ---------------------------------------------------------------------------
describe("flush de tokens no commit (FIX 1 + FIX 4)", () => {
  test("deveEmitirEventoTokens_eIncluirNaAuditoria_quandoCommitBemSucedido", async () => {
    const entry = criarTarefaAtiva("Feature commitada")
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-c", { input: 300, output: 100, reasoning: 20, cache: { read: 10, write: 4 } }, 0.07))
    sessionGetImpl = async () => ({ agent: "code-reviewer" })

    await callAfterBash(hooks, { command: 'git commit -m "feat: entrega"', exit: 0 })

    // evento tokens com taskId + tokens + cost + feature
    const tokens = lerJsonl(metricsPath()).filter((e) => e["evento"] === "tokens")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.["taskId"]).toBe(entry.taskId)
    const det = tokens[0]?.["detalhe"] as Record<string, unknown>
    expect(det["feature"]).toBe("Feature commitada")
    expect(det["cost"]).toBeCloseTo(0.07)
    const t = det["tokens"] as Record<string, number>
    expect(t["input"]).toBe(300)
    expect(t["output"]).toBe(100)

    // auditoria "concluida" carrega tokens
    const auditoria = readAudit(historyPath())
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0]?.resultado).toBe("concluida")
    expect(auditoria[0]?.tokens?.input).toBe(300)
    expect(auditoria[0]?.tokens?.cost).toBeCloseTo(0.07)
  })

  test("deveNaoEmitirCommitNemTokens_quandoExitCodeNaoZero", async () => {
    criarTarefaAtiva("Feature falha commit")
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-f", { input: 50 }, 0.01))
    sessionGetImpl = async () => ({ agent: "code-reviewer" })

    await callAfterBash(hooks, { command: 'git commit -m "feat"', exit: 1 })

    const eventos = lerJsonl(metricsPath())
    expect(eventos.filter((e) => e["evento"] === "commit")).toHaveLength(0)
    expect(eventos.filter((e) => e["evento"] === "tokens")).toHaveLength(0)
    expect(readAudit(historyPath())).toHaveLength(0)
  })

  test("deveNaoEmitir_quandoComandoNaoCasaCommitPush", async () => {
    criarTarefaAtiva("Feature sem commit")
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-g", { input: 10 }, 0.01))
    sessionGetImpl = async () => ({ agent: "code-reviewer" })

    await callAfterBash(hooks, { command: "git add src/x.ts", exit: 0 })

    const eventos = lerJsonl(metricsPath())
    expect(eventos.filter((e) => e["evento"] === "commit")).toHaveLength(0)
    expect(eventos.filter((e) => e["evento"] === "tokens")).toHaveLength(0)
  })

  test("deveNaoEmitir_quandoAgenteNaoReviewer", async () => {
    criarTarefaAtiva("Feature dev")
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-d", { input: 10 }, 0.01))
    sessionGetImpl = async () => ({ agent: "dev-frontend" })

    await callAfterBash(hooks, { command: 'git commit -m "wip"', exit: 0 })

    const eventos = lerJsonl(metricsPath())
    expect(eventos.filter((e) => e["evento"] === "commit")).toHaveLength(0)
    expect(eventos.filter((e) => e["evento"] === "tokens")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// flush na escala humana
// ---------------------------------------------------------------------------
describe("flush de tokens na escala humana (FIX 1)", () => {
  test("deveEmitirEventoTokens_eIncluirNaAuditoriaEscalada_quandoMaxRetriesEsgotado", async () => {
    const entry = criarTarefaAtiva("Feature escalável")
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()
    await callEvent(hooks, msgUpdated("sess-e", { input: 500, output: 200, reasoning: 50, cache: { read: 20, write: 8 } }, 0.12))

    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #1\/2/)
    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #2\/2/)
    await expect(falharTransicao(hooks)).rejects.toThrow(/\[PIPELINE-ESCALA\]/)

    // evento tokens no flush da escala
    const tokens = lerJsonl(metricsPath()).filter((e) => e["evento"] === "tokens")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.["taskId"]).toBe(entry.taskId)
    const det = tokens[0]?.["detalhe"] as Record<string, unknown>
    expect(det["feature"]).toBe("Feature escalável")
    const t = det["tokens"] as Record<string, number>
    expect(t["input"]).toBe(500)
    expect(t["output"]).toBe(200)
    expect(t["cost"]).toBeCloseTo(0.12)

    // auditoria "escalada" carrega tokens
    const auditoria = readAudit(historyPath())
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0]?.resultado).toBe("escalada")
    expect(auditoria[0]?.tokens?.input).toBe(500)
    expect(auditoria[0]?.tokens?.cost).toBeCloseTo(0.12)
  })
})

// ---------------------------------------------------------------------------
// report.mjs — soma de tokens/custo por feature + total (FIX 1.4)
// ---------------------------------------------------------------------------
describe("report.mjs — soma de tokens/custo (FIX 1.4)", () => {
  const reportPath = fileURLToPath(new URL("../../.opencode/pipeline/report.mjs", import.meta.url))

  test("deveSomarTokensECustoPorFeature_eTotal", async () => {
    // execFileSync está mockado no topo do arquivo; o report.mjs é um processo
    // real => usa o execFileSync REAL (importActual).
    const realChild = await vi.importActual<typeof import("node:child_process")>("node:child_process")
    const m = join(tmpDir, "metrics.jsonl")
    // Shape REAL do flushTokens: tokens.cost === detalhe.cost (mesmo valor).
    // O report deve somar o custo UMA vez (canônico: detalhe.cost), não 2×.
    const linhas = [
      { ts: "2026-08-24T00:00:00.000Z", evento: "tokens", taskId: "t1", detalhe: { feature: "Feature A", tokens: { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2, cost: 0.01 }, cost: 0.01 } },
      { ts: "2026-08-24T00:00:00.000Z", evento: "tokens", taskId: "t1", detalhe: { feature: "Feature A", tokens: { input: 200, output: 25, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02 }, cost: 0.02 } },
      { ts: "2026-08-24T00:00:00.000Z", evento: "tokens", taskId: "t2", detalhe: { feature: "Feature B", tokens: { input: 50, output: 10, reasoning: 5, cacheRead: 1, cacheWrite: 1, cost: 0.005 }, cost: 0.005 } },
      { ts: "2026-08-24T00:00:00.000Z", evento: "transicao", taskId: "t1", detalhe: { fase: "desenvolvimento", duracaoMs: 1000 } },
      { ts: "2026-08-24T00:00:00.000Z", evento: "transicao", taskId: "t1", detalhe: { fase: "desenvolvimento", duracaoMs: 3000 } },
    ]
    writeFileSync(m, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8")

    const out = realChild.execFileSync(process.execPath, [reportPath, "--path", m, "--json"], { encoding: "utf8" })
    const json = JSON.parse(out) as {
      tokens: Record<string, number>
      tokensPorFeature: Record<string, Record<string, number>>
      tempoMedioPorFase: Record<string, number>
    }

    // total: input 350, output 85, reasoning 15, cost 0.035
    expect(json.tokens["input"]).toBe(350)
    expect(json.tokens["output"]).toBe(85)
    expect(json.tokens["reasoning"]).toBe(15)
    expect(json.tokens["cost"]).toBeCloseTo(0.035)
    // por feature
    expect(json.tokensPorFeature?.["Feature A"]?.["input"]).toBe(300)
    expect(json.tokensPorFeature?.["Feature A"]?.["cost"]).toBeCloseTo(0.03)
    expect(json.tokensPorFeature?.["Feature B"]?.["input"]).toBe(50)
    // tempo médio por fase agrupado (FIX 2)
    expect(json.tempoMedioPorFase?.["desenvolvimento"]).toBe(2000)
  })

  test("deveRetornarNulo_quandoSemEventosTokens", async () => {
    const realChild = await vi.importActual<typeof import("node:child_process")>("node:child_process")
    const m = join(tmpDir, "metrics.jsonl")
    writeFileSync(m, JSON.stringify({ ts: "2026-08-24T00:00:00.000Z", evento: "gate_run", taskId: "t1" }) + "\n", "utf-8")
    const out = realChild.execFileSync(process.execPath, [reportPath, "--path", m, "--json"], { encoding: "utf8" })
    const json = JSON.parse(out) as { tokens: unknown; tokensPorFeature: unknown }
    expect(json.tokens).toBeNull()
    expect(json.tokensPorFeature).toBeNull()
  })
})