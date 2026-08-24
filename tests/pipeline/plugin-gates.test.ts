/**
 * Testes unitários dos QUALITY GATES do plugin pipeline-orchestrator
 * (helpers puros/semi-puros expostos via __internals + hooks do plugin).
 *
 * NENHUM comando real é executado: node:child_process (execSync/execFileSync)
 * é mockado por inteiro e node:fs.existsSync é mockado com fallback para a
 * implementação real (o registry continua usando fs real dentro de tmpdir).
 *
 * Registry hooks (criação/bloqueio/marcação de fases) NÃO são duplicados aqui:
 * ver tests/pipeline/plugin-registry.test.ts e registry.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, type PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineOrchestrator, __internals } from "../../.opencode/pipeline/orchestrator-impl"
import { createEntry, readRegistry, writeRegistry, type RegistryEntry } from "../../.opencode/pipeline/registry"

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

// ---------------------------------------------------------------------------
// Plataforma (resolveCommand win32) — restaurada no afterEach.
// ---------------------------------------------------------------------------
const originalPlatform = process.platform
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
}

// ---------------------------------------------------------------------------
// tmpdir isolado por teste.
// ---------------------------------------------------------------------------
let tmpDir: string

interface FsFlags {
  pkg?: boolean
  compose?: boolean
  detector?: boolean
}

/** Configura existsSync por sufixo de path; demais paths caem no fs real. */
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

// ---------------------------------------------------------------------------
// Erros de execução simulados (shape do err lançado pelo execSync real).
// ---------------------------------------------------------------------------
interface ExecErrProps {
  stdout?: string | Buffer
  stderr?: string | Buffer
  status?: number
}

function mkExecError(props: ExecErrProps = {}): Error & ExecErrProps {
  const err = new Error(
    `Command failed${props.status != null ? `: exit ${props.status}` : ""}`,
  ) as Error & ExecErrProps
  err.stdout = props.stdout
  err.stderr = props.stderr
  err.status = props.status
  return err
}

/** execSync ok para tudo, exceto comandos que contêm cmdPart (lança). */
function failExecOn(cmdPart: string, props: ExecErrProps = {}): void {
  execSyncMock.mockImplementation((cmd: string) => {
    if (String(cmd).includes(cmdPart)) throw mkExecError(props)
    return "ok"
  })
}

/** Estrutura compatível com QualityGate (interface não exportada). */
interface GateLike {
  sourceAgents: string[]
  label: string
  commands: {
    label: string
    command: string
    timeoutMs?: number
    coverageKey?: string
    coverageSource?: "vitest"
  }[]
  failurePatterns: RegExp[]
  maxFailureLines?: number
}

function makeGate(overrides: Partial<GateLike> = {}): GateLike {
  return {
    sourceAgents: ["dev-frontend"],
    label: "Quality Gate FRONTEND (React + Vitest)",
    commands: [
      { label: "build", command: "npm run build" },
      { label: "test", command: "npm test" },
      {
        label: "coverage",
        command: "npm run test:coverage",
        coverageKey: "root",
        coverageSource: "vitest",
      },
    ],
    failurePatterns: [/\b(error|failed)\b/i],
    maxFailureLines: 40,
    ...overrides,
  }
}

const noopLog = (): void => {}

// ---------------------------------------------------------------------------
// Hooks do plugin: client stub com log capturado.
// ---------------------------------------------------------------------------
type LogBody = { level: string; message: string }
let logs: LogBody[]
let sessionGetImpl: () => Promise<unknown>

async function makeHooks(opts: { failLog?: boolean } = {}) {
  logs = []
  const client = {
    app: {
      log: async (args: { body: LogBody }) => {
        if (opts.failLog) throw new Error("app.log indisponivel")
        logs.push(args.body)
      },
    },
    session: { get: () => sessionGetImpl() },
  }
  return PipelineOrchestrator({ client, directory: tmpDir } as never)
}

type Hooks = Awaited<ReturnType<typeof makeHooks>>

const messages = (): string[] => logs.map((l) => l.message)

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

async function callAfter(
  hooks: Hooks,
  opts: { subagent_type: string; completed: boolean; sessionId?: string },
): Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (!hook) throw new Error("hook tool.execute.after ausente")
  await hook(
    { tool: "task", sessionID: "sess-1", callID: "call-1", args: { subagent_type: opts.subagent_type } } as never,
    {
      args: { subagent_type: opts.subagent_type },
      metadata: { sessionId: opts.sessionId ?? "sub-sessao-1" },
      output: opts.completed ? '... state="completed" ...' : '... state="error" ...',
      title: "task",
    } as never,
  )
}

function statePath(): string {
  return join(tmpDir, ".opencode", "pipeline", "state.json")
}

function criarTarefaAtiva(feature = "Feature de teste"): void {
  writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature })] })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  realFs = await vi.importActual<typeof import("node:fs")>("node:fs")
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plugin-gates-test-"))
  sessionGetImpl = async () => ({ agent: undefined })
  existsSyncMock.mockImplementation((p: PathLike) => realFs.existsSync(p))
  execSyncMock.mockReset()
  execFileSyncMock.mockReset()
})

afterEach(() => {
  setPlatform(originalPlatform)
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// resolveCommand
// ---------------------------------------------------------------------------
describe("resolveCommand", () => {
  test("deveRetornarComandoCru_noLinux", () => {
    expect(__internals.resolveCommand("npm run build")).toBe("npm run build")
  })

  test("devePrefixarWslBashLc_quandoPlataformaWin32", () => {
    setPlatform("win32")
    expect(__internals.resolveCommand("npm run build")).toBe('wsl bash -lc "npm run build"')
  })

  test("deveEscaparAspasDuplas_quandoWin32", () => {
    setPlatform("win32")
    const cmd = 'npm test -- --reporter="dot"'
    expect(__internals.resolveCommand(cmd)).toBe('wsl bash -lc "npm test -- --reporter=\\"dot\\""')
  })
})

// ---------------------------------------------------------------------------
// extractFailures
// ---------------------------------------------------------------------------
describe("extractFailures", () => {
  const patterns = [/\berror\b/i, /\bfailed\b/i]

  test("deveManterSomenteLinhasQueCasamComAlgumPadrao", () => {
    const raw = ["build started", "error TS2307: boom", "done"].join("\n")
    expect(__internals.extractFailures(raw, patterns, 40)).toBe("error TS2307: boom")
  })

  test("deveUnirMultiplosPadroes_naOrdemDoLog", () => {
    const raw = ["x failed hard", "info ok", "ERROR: broken"].join("\n")
    expect(__internals.extractFailures(raw, patterns, 40)).toBe(
      ["x failed hard", "ERROR: broken"].join("\n"),
    )
  })

  test("deveDeduplicarLinhasIguais", () => {
    const raw = "error a\nerror a\nerror a"
    expect(__internals.extractFailures(raw, patterns, 40)).toBe("error a")
  })

  test("deveRespeitarMaxLinhas", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `error linha ${i}`).join("\n")
    const out = __internals.extractFailures(raw, patterns, 3).split("\n")
    expect(out).toHaveLength(3)
    expect(out[0]).toBe("error linha 0")
  })

  test("deveUsarUltimasLinhasNaoVazias_quandoNadaCasa", () => {
    const raw = ["a", "", "b", "c"].join("\n")
    expect(__internals.extractFailures(raw, [/\bnao-casa\b/], 2)).toBe("b\nc")
  })

  test("deveRetornarStringVazia_quandoEntradaSemLinhasUteis", () => {
    expect(__internals.extractFailures("\n \n", [/\bx\b/], 5)).toBe("")
  })
})

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe("truncate", () => {
  test("deveManterTextoCurtoIntacto", () => {
    expect(__internals.truncate("linha1\nlinha2", 1000)).toBe("linha1\nlinha2")
  })

  test("deveTruncarComSufixo_eManterCorpoDentroDoLimite", () => {
    const text = Array.from({ length: 50 }, (_, i) => `linha-${i}`).join("\n")
    const out = __internals.truncate(text, 100)
    const suffix = "\n...(truncado p/ 100 bytes)"
    expect(out.endsWith(suffix)).toBe(true)
    expect(out).not.toBe(text)
    const corpo = out.slice(0, -suffix.length)
    expect(Buffer.byteLength(corpo, "utf-8")).toBeLessThanOrEqual(100)
  })

  test("deveLimitarPorBytesUtf8_naoPorCaracteres", () => {
    // "á" tem 2 bytes em UTF-8: linha 1 (30 bytes) cabe; linha 2 estoura os 40.
    const text = `${"á".repeat(15)}\n${"é".repeat(15)}`
    const out = __internals.truncate(text, 40)
    const corpo = out.replace(/\n\.\.\.\(truncado p\/ 40 bytes\)$/, "")
    expect(corpo).toBe("á".repeat(15))
    expect(Buffer.byteLength(corpo, "utf-8")).toBeLessThanOrEqual(40)
    expect(out).toContain("(truncado p/ 40 bytes)")
  })

  test("deveRetornarSemSaida_quandoPrimeiraLinhaJaExcedeOLimite", () => {
    expect(__internals.truncate("x".repeat(50), 10)).toBe("(sem saida)")
  })
})

// ---------------------------------------------------------------------------
// extractFailedCoverageTargets
// ---------------------------------------------------------------------------
describe("extractFailedCoverageTargets", () => {
  const linhaGlobal = (file: string, pct = "0") =>
    `ERROR: Coverage for lines (${pct}%) does not meet global threshold (95%) for ${file}`
  const linhaPerFile = (file: string) =>
    `ERROR: Coverage for statements (12.5%) does not meet per-file threshold (95%) for ${file}`
  const linhaGlob = (file: string) =>
    `ERROR: Coverage for functions (40%) does not meet "src/**" threshold (95%) for ${file}`

  test("deveExtrairVarianteGlobalThreshold", () => {
    expect(__internals.extractFailedCoverageTargets(linhaGlobal("src/a.ts"))).toEqual(["src/a.ts"])
  })

  test("deveExtrairVariantePerFileThreshold", () => {
    expect(__internals.extractFailedCoverageTargets(linhaPerFile("src/pages/Menu.tsx"))).toEqual([
      "src/pages/Menu.tsx",
    ])
  })

  test("deveExtrairVarianteGlobNomeado", () => {
    expect(__internals.extractFailedCoverageTargets(linhaGlob("src/hooks/useX.ts"))).toEqual([
      "src/hooks/useX.ts",
    ])
  })

  test("deveDeduplicarArquivosRepetidos", () => {
    const raw = [linhaGlobal("src/a.ts"), linhaPerFile("src/a.ts")].join("\n")
    expect(__internals.extractFailedCoverageTargets(raw)).toEqual(["src/a.ts"])
  })

  test("deveUsarFallbackGenerico_quandoPrefixoErrorCoverageAusente", () => {
    const raw = "Lines coverage (10%) does not meet per-file threshold (95%) for src/outro.ts"
    expect(__internals.extractFailedCoverageTargets(raw)).toEqual(["src/outro.ts"])
  })

  test("devePreferirCasamentoPrimario_ignorandoFallbackNoMesmoOutput", () => {
    const raw = [
      linhaGlobal("src/primario.ts"),
      "weird line does not meet threshold (80%) for src/fallback.txt",
    ].join("\n")
    expect(__internals.extractFailedCoverageTargets(raw)).toEqual(["src/primario.ts"])
  })

  test("deveLimitarAoMaximoDeTargets", () => {
    const linhas = Array.from({ length: 25 }, (_, i) => linhaGlobal(`src/f${i}.ts`)).join("\n")
    const out = __internals.extractFailedCoverageTargets(linhas)
    expect(out).toHaveLength(__internals.MAX_COVERAGE_TARGETS)
    expect(out[0]).toBe("src/f0.ts")
  })

  test("deveRetornarVazio_quandoNadaCasa", () => {
    expect(__internals.extractFailedCoverageTargets("tudo certo por aqui")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// execGateStep
// ---------------------------------------------------------------------------
describe("execGateStep", () => {
  const step = { label: "build", command: "npm run build" }

  test("deveRetornarOkComOutput_quandoComandoPassa", () => {
    execSyncMock.mockReturnValue("compilou\n")
    expect(__internals.execGateStep(step, "/tmp/x")).toEqual({ ok: true, output: "compilou\n" })
  })

  test("deveExecutarNaRaizComEncodingStdioETimeoutDefault", () => {
    execSyncMock.mockReturnValue("")
    __internals.execGateStep(step, "/tmp/x")
    expect(execSyncMock).toHaveBeenCalledWith(
      "npm run build",
      expect.objectContaining({
        cwd: "/tmp/x",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10 * 60 * 1000,
      }),
    )
  })

  test("deveRespeitarTimeoutCustomizadoDoStep", () => {
    execSyncMock.mockReturnValue("")
    __internals.execGateStep({ label: "cov", command: "npm run test:coverage", timeoutMs: 12345 }, "/tmp/x")
    expect(execSyncMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 12345 }))
  })

  test("deveRetornarFalhaComStdoutStderrStatus_quandoComandoQuebra", () => {
    execSyncMock.mockImplementation(() => {
      throw mkExecError({ stdout: "linha stdout", stderr: "linha stderr", status: 7 })
    })
    expect(__internals.execGateStep(step, "/tmp/x")).toEqual({
      ok: false,
      output: "linha stdout\nlinha stderr",
      status: 7,
    })
  })

  test("deveConverterBufferParaString_naFalha", () => {
    execSyncMock.mockImplementation(() => {
      throw mkExecError({ stdout: Buffer.from("buf-out"), stderr: Buffer.from("buf-err"), status: 1 })
    })
    const res = __internals.execGateStep(step, "/tmp/x")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.output).toBe("buf-out\nbuf-err")
  })

  test("deveUsarStatusMenosUmEOutputVazio_quandoErroNaoTemProps", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("boom seco")
    })
    expect(__internals.execGateStep(step, "/tmp/x")).toEqual({ ok: false, output: "", status: -1 })
  })
})

// ---------------------------------------------------------------------------
// execDetectorStep
// ---------------------------------------------------------------------------
describe("execDetectorStep", () => {
  test("deveExecutarBinComArgsVetoriais_semShell", () => {
    execFileSyncMock.mockReturnValue("sem findings")
    const res = __internals.execDetectorStep(
      "node .opencode/skills/impeccable/scripts/detector/detect-antipatterns.mjs",
      ["src/A.tsx", "src/B.css"],
      5000,
      "/tmp/x",
    )
    expect(res).toEqual({ ok: true, output: "sem findings" })
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "node",
      [".opencode/skills/impeccable/scripts/detector/detect-antipatterns.mjs", "src/A.tsx", "src/B.css"],
      expect.objectContaining({ cwd: "/tmp/x", timeout: 5000 }),
    )
  })

  test("deveRetornarFalha_quandoComandoVazio", () => {
    const res = __internals.execDetectorStep("", [], 1000, "/tmp/x")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(-1)
      expect(res.output).toContain("comando vazio")
    }
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  test("deveRetornarFalhaComStatus_quandoExecFileSyncLanca", () => {
    execFileSyncMock.mockImplementation(() => {
      throw mkExecError({ stdout: "finding x", stderr: "", status: 2 })
    })
    const res = __internals.execDetectorStep("node script.mjs", ["a.ts"], 1000, "/tmp/x")
    expect(res).toEqual({ ok: false, output: "finding x", status: 2 })
  })
})

// ---------------------------------------------------------------------------
// getChangedUiFiles
// ---------------------------------------------------------------------------
describe("getChangedUiFiles", () => {
  test("deveCombinarTrackedEUntracked_filtrandoPorExtensaoUi_caseInsensitive", () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes("git diff")) return "src/A.tsx\nREADME.md\nSRC/B.CSS\n"
      if (String(cmd).includes("ls-files")) return "novo.jsx\nanotacao.txt\n"
      return ""
    })
    const files = __internals.getChangedUiFiles("/tmp/x", [".tsx", ".css", ".jsx"])
    expect(files).toEqual(["src/A.tsx", "SRC/B.CSS", "novo.jsx"])
  })

  test("deveRetornarListaVazia_quandoGitFalha", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("git quebrado")
    })
    expect(__internals.getChangedUiFiles("/tmp/x", [".tsx"])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// hasPackageJson / extrairFeature / constantes
// ---------------------------------------------------------------------------
describe("hasPackageJson, extrairFeature e constantes", () => {
  test("deveDetectarPackageJsonPresenteEAusente", () => {
    setFsFlags({ pkg: true })
    expect(__internals.hasPackageJson("/tmp/x")).toBe(true)
    setFsFlags({ pkg: false })
    expect(__internals.hasPackageJson("/tmp/x")).toBe(false)
  })

  test("extrairFeature_devePreferirDescription_truncar80_eUsarPadrao", () => {
    expect(__internals.extrairFeature({ description: "  Tela de login  " })).toBe("Tela de login")
    expect(__internals.extrairFeature({ prompt: "primeira linha\nsegunda" })).toBe("primeira linha")
    expect(__internals.extrairFeature({ description: "x".repeat(120) }).length).toBe(80)
    expect(__internals.extrairFeature(undefined)).toBe("tarefa sem descrição")
    expect(__internals.extrairFeature({ description: "   " })).toBe("tarefa sem descrição")
  })

  test("gateFrontendDeveEstarCabladoAoDevFrontend_comCoberturaRoot95", () => {
    const gate = __internals.QUALITY_GATES.find((g) => g.sourceAgents.includes("dev-frontend"))
    expect(gate).toBeDefined()
    const cov = gate?.commands.find((c) => c.coverageKey != null)
    expect(cov?.coverageSource).toBe("vitest")
    expect(cov?.coverageKey).toBe("root")
    expect(__internals.COVERAGE_THRESHOLDS.root).toBe(95)
    expect(__internals.OPTIONS.targetAgent).toBe("code-reviewer")
  })
})

// ---------------------------------------------------------------------------
// runGate
// ---------------------------------------------------------------------------
describe("runGate", () => {
  test("devePularGateSemThrow_quandoPackageJsonAusente_bootstrapGuard", () => {
    setFsFlags({ pkg: false })
    const log = vi.fn()
    expect(() => __internals.runGate(makeGate(), "/tmp/x", log)).not.toThrow()
    expect(execSyncMock).not.toHaveBeenCalled()
    const msgs = log.mock.calls.map((c) => String(c[1]))
    expect(msgs.some((m) => m.includes("[BOOTSTRAP]"))).toBe(true)
  })

  test("todosStepsOk_deveSeguirSemThrow_ePularComposeEDetectorAusentes", () => {
    setFsFlags({ pkg: true, compose: false, detector: false })
    execSyncMock.mockReturnValue("ok")
    const log = vi.fn()
    expect(() => __internals.runGate(makeGate(), "/tmp/x", log)).not.toThrow()
    expect(execSyncMock).toHaveBeenCalledTimes(3) // build, test, coverage
    const msgs = log.mock.calls.map((c) => String(c[1]))
    expect(msgs.some((m) => m.includes("[SKIP] docker-compose.yml ausente"))).toBe(true)
    expect(msgs.some((m) => m.includes("[SKIP] detector impeccable ausente"))).toBe(true)
  })

  test("deveLancarComLabelDoGateEFALHOU_quandoBuildFalha", () => {
    setFsFlags({ pkg: true })
    failExecOn("npm run build", { stdout: "error TS2307: Cannot find module", stderr: "", status: 2 })
    try {
      __internals.runGate(makeGate(), "/tmp/x", noopLog)
      expect.unreachable("deveria ter lançado")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain("Quality Gate FRONTEND (React + Vitest)")
      expect(msg).toContain("[FALHOU] build")
      expect(msg).toContain("error TS2307")
    }
  })

  test("coberturaFalha_deveListarArquivosAbaixoDoLimiteEThreshold95", () => {
    setFsFlags({ pkg: true })
    const vitestOut = [
      " RUN  v4.1.11",
      "ERROR: Coverage for lines (31.67%) does not meet global threshold (95%) for .opencode/plugins/pipeline-orchestrator.ts",
      "ERROR: Coverage for lines (88%) does not meet global threshold (95%) for src/store/useAuthStore.ts",
    ].join("\n")
    failExecOn("test:coverage", { stdout: vitestOut, stderr: "", status: 1 })
    try {
      __internals.runGate(makeGate(), "/tmp/x", noopLog)
      expect.unreachable("deveria ter lançado")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain(".opencode/plugins/pipeline-orchestrator.ts")
      expect(msg).toContain("src/store/useAuthStore.ts")
      expect(msg).toContain("95%")
      expect(msg).toContain("[FALHOU] coverage")
    }
  })

  test("coberturaFalhaSemTargets_deveCairNoExtratoDeFalhasTruncado", () => {
    setFsFlags({ pkg: true })
    failExecOn("test:coverage", { stdout: "Tests failed\n1 failed | 12 passed", stderr: "", status: 1 })
    try {
      __internals.runGate(makeGate(), "/tmp/x", noopLog)
      expect.unreachable("deveria ter lançado")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain("[FALHOU] coverage")
      expect(msg).toContain("Tests failed")
    }
  })

  test("composePresenteEOk_deveExecutarDockerComposeESeguirParaDetector", () => {
    setFsFlags({ pkg: true, compose: true, detector: false })
    execSyncMock.mockReturnValue("ok")
    const log = vi.fn()
    expect(() => __internals.runGate(makeGate(), "/tmp/x", log)).not.toThrow()
    expect(execSyncMock).toHaveBeenCalledTimes(4) // build, test, coverage, compose
    const cmds = execSyncMock.mock.calls.map((c) => String(c[0]))
    expect(cmds.some((c) => c.includes("docker compose up -d --build"))).toBe(true)
    const msgs = log.mock.calls.map((c) => String(c[1]))
    expect(msgs.some((m) => m.includes("docker-compose.yml ausente"))).toBe(false)
  })

  test("composePresenteMasFalho_deveLancarErroDeStackAposGateAprovado", () => {
    setFsFlags({ pkg: true, compose: true, detector: false })
    failExecOn("docker compose", { stdout: "", stderr: "Cannot connect to the Docker daemon", status: 1 })
    try {
      __internals.runGate(makeGate(), "/tmp/x", noopLog)
      expect.unreachable("deveria ter lançado")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain("docker compose FALHOU")
      expect(msg).toContain("Cannot connect to the Docker daemon")
    }
  })

  test("detectorSemArquivosUiAlterados_naoDeveChamarExecFileSync", () => {
    setFsFlags({ pkg: true, compose: false, detector: true })
    execSyncMock.mockImplementation((cmd: string) =>
      String(cmd).includes("git diff") ? "docs/readme.md\n" : "",
    )
    expect(() => __internals.runGate(makeGate(), "/tmp/x", noopLog)).not.toThrow()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  test("detectorComArquivoUiEDetectorOk_deveRodarSemShellEVariadic", () => {
    setFsFlags({ pkg: true, compose: false, detector: true })
    execSyncMock.mockImplementation((cmd: string) =>
      String(cmd).includes("git diff") ? "src/Page.tsx\n" : "",
    )
    execFileSyncMock.mockReturnValue("0 anti-patterns found")
    expect(() => __internals.runGate(makeGate(), "/tmp/x", noopLog)).not.toThrow()
    expect(execFileSyncMock).toHaveBeenCalledTimes(1)
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[]
    expect(args).toContain("src/Page.tsx")
  })

  test("detectorComFindingsEBlockOnFindingsTrue_deveBloquearTransicao", () => {
    setFsFlags({ pkg: true, compose: false, detector: true })
    execSyncMock.mockImplementation((cmd: string) =>
      String(cmd).includes("git diff") ? "src/Page.tsx\n" : "",
    )
    execFileSyncMock.mockImplementation(() => {
      throw mkExecError({
        stdout: "src/Page.tsx\n  line 12: [layout-imbalance] <div> solto\n✗ 1 anti-pattern found",
        stderr: "",
        status: 2,
      })
    })
    try {
      __internals.runGate(makeGate(), "/tmp/x", noopLog)
      expect.unreachable("deveria ter lançado")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain("IMPECCABLE DETECTOR")
      expect(msg).toContain("line 12: [layout-imbalance]")
    }
  })

  test("detectorComFindingsEBlockOnFindingsFalse_deveApenasWarnSemThrow", () => {
    setFsFlags({ pkg: true, compose: false, detector: true })
    execSyncMock.mockImplementation((cmd: string) =>
      String(cmd).includes("git diff") ? "src/Page.tsx\n" : "",
    )
    execFileSyncMock.mockImplementation(() => {
      throw mkExecError({ stdout: "line 3: [color-contrast] baixo contraste", stderr: "", status: 2 })
    })
    const det = __internals.OPTIONS.detectorOnGatePass as unknown as { blockOnFindings: boolean }
    const original = det.blockOnFindings
    det.blockOnFindings = false
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(() => __internals.runGate(makeGate(), "/tmp/x", noopLog)).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("anti-padroes"))
    } finally {
      det.blockOnFindings = original
      warnSpy.mockRestore()
    }
  })

  test("detectorDeveTruncarListaDeArquivosEmMaxFiles", () => {
    setFsFlags({ pkg: true, compose: false, detector: true })
    const muitos = Array.from({ length: 60 }, (_, i) => `src/F${i}.tsx`).join("\n")
    execSyncMock.mockImplementation((cmd: string) => (String(cmd).includes("git diff") ? muitos : ""))
    execFileSyncMock.mockReturnValue("ok")
    expect(() => __internals.runGate(makeGate(), "/tmp/x", noopLog)).not.toThrow()
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[]
    const passados = args.filter((a) => a.startsWith("src/F"))
    expect(passados).toHaveLength(__internals.OPTIONS.detectorOnGatePass.maxFiles)
  })
})

// ---------------------------------------------------------------------------
// Hooks do plugin — transição dev -> code-reviewer com gate
// ---------------------------------------------------------------------------
describe("hooks do plugin — transição de gate", () => {
  test("deveRodarGate_quandoDevConcluiETransita_eResetarFonteNoFinally", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true, compose: false, detector: false })
    execSyncMock.mockReturnValue("ok")
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
    await callBefore(hooks, "task", { subagent_type: "code-reviewer" })

    expect(messages().some((m) => m.includes("rodando Quality Gate FRONTEND"))).toBe(true)

    // Fonte resetada no finally: segunda transição sem nova task dev => fonte
    // desconhecida, mas gateOnUnknownSource=true => gate do frontend RODA.
    await callBefore(hooks, "task", { subagent_type: "code-reviewer" })
    const msgs = messages()
    expect(msgs.some((m) => m.includes("sem fonte dev rastreada"))).toBe(true)
    expect(msgs.filter((m) => m.includes("rodando Quality Gate FRONTEND")).length).toBe(2)
  })

  test("deveReRodarGateComRetry2_quandoFonteResetadaEGateFalhaDeNovo", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    failExecOn("npm run build", { stdout: "error TS2307: boom", stderr: "", status: 2 })
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).rejects.toThrow(/FALHOU/)
    // finally resetou a fonte mesmo com throw; a nova transição NÃO pula o
    // gate: roda de novo (fonte desconhecida => gate frontend) e falha de novo.
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).rejects.toThrow(
      /retry #2\/2/,
    )
    expect(messages().some((m) => m.includes("sem fonte dev rastreada"))).toBe(true)
  })

  test("gateOnUnknownSource_deveEstarAtivoPorDefault_camadaMecanica", () => {
    // CRITICAL (revisão FASE 3): spawn automático não passa pela tool `task`;
    // sem este flag, a transição pós-correção automática pularia o gate.
    expect(__internals.OPTIONS.gateOnUnknownSource).toBe(true)
  })

  test("deveRodarGateSemFonteRastreada_quandoGateOnUnknownSourceAtivo", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: false })
    const opt = __internals.OPTIONS as unknown as { gateOnUnknownSource: boolean }
    const original = opt.gateOnUnknownSource
    opt.gateOnUnknownSource = true
    try {
      const hooks = await makeHooks()
      await callBefore(hooks, "task", { subagent_type: "code-reviewer" })
      const msgs = messages()
      expect(msgs.some((m) => m.includes("rodando Quality Gate FRONTEND"))).toBe(true)
      expect(msgs.some((m) => m.includes("[BOOTSTRAP]"))).toBe(true)
    } finally {
      opt.gateOnUnknownSource = original
    }
  })

  test("devePularGateComWarn_quandoGateOnUnknownSourceDesativado", async () => {
    criarTarefaAtiva()
    const opt = __internals.OPTIONS as unknown as { gateOnUnknownSource: boolean }
    const original = opt.gateOnUnknownSource
    opt.gateOnUnknownSource = false
    try {
      const hooks = await makeHooks()
      await callBefore(hooks, "task", { subagent_type: "code-reviewer" })
      const msgs = messages()
      expect(msgs.some((m) => m.includes("sem fonte dev rastreada"))).toBe(true)
      expect(msgs.some((m) => m.includes("gate pulado"))).toBe(true)
    } finally {
      opt.gateOnUnknownSource = original
    }
  })

  test("deveBloquearTargetNaoAutorizado_mesmoComEntradaAtiva_FASE2", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    // FASE 2: allowedTargets restringe delegação a dev-frontend/code-reviewer.
    await expect(callBefore(hooks, "task", { subagent_type: "git-committer" })).rejects.toThrow(
      /não autorizado/,
    )
  })

  test("deveIgnorarRegistryEGate_quandoTargetVazio", async () => {
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "task", { subagent_type: "" })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Hooks do plugin — finish e bloqueio de push
// ---------------------------------------------------------------------------
describe("hooks do plugin — finish e bloqueio de push", () => {
  test("deveRodarGateNoFinish_quandoAgenteMapeado", async () => {
    setFsFlags({ pkg: false })
    sessionGetImpl = async () => ({ agent: "dev-frontend" })
    const hooks = await makeHooks()
    await callBefore(hooks, "finish", {})
    expect(messages().some((m) => m.includes("Finish do dev-frontend"))).toBe(true)
  })

  test("deveSeguirSemGate_noFinish_quandoSessaoFalha", async () => {
    sessionGetImpl = async () => {
      throw new Error("sessão sumiu")
    }
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "finish", {})).resolves.toBeUndefined()
    expect(messages().some((m) => m.includes("Finish do"))).toBe(false)
  })

  test("naoDeveInterferir_noPush_quandoFlagDesativada_ePreCondicoesOk", async () => {
    expect(__internals.OPTIONS.blockGitPushForReviewer).toBe(false)
    // FASE 2: guarda bash exige report + aprovação p/ commit/push do reviewer.
    const entry: RegistryEntry = {
      ...createEntry({ feature: "Feature push ok" }),
      detectChangesReport: { ts: "2026-08-21T15:00:00.000Z", riskLevel: "LOW", changedCount: 2 },
      aprovacaoHumana: { por: "usuario", em: "2026-08-21T16:00:00.000Z" },
    }
    writeRegistry(statePath(), { versao: 1, tarefas: [entry] })
    sessionGetImpl = async () => ({ agent: "code-reviewer" })
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "bash", { command: "git push origin main" })).resolves.toBeUndefined()
  })

  test("deveBloquearPushDoReviewer_quandoFlagAtivada_ePermitirOutrosComandos", async () => {
    const opt = __internals.OPTIONS as unknown as { blockGitPushForReviewer: boolean }
    const original = opt.blockGitPushForReviewer
    opt.blockGitPushForReviewer = true
    try {
      // FASE 2: guarda do registry roda ANTES do flag legacy — satisfazer as
      // pré-condições para alcançar o bloqueio legacy de push.
      const entry: RegistryEntry = {
        ...createEntry({ feature: "Feature push flag" }),
        detectChangesReport: { ts: "2026-08-21T15:00:00.000Z", riskLevel: "LOW", changedCount: 2 },
        aprovacaoHumana: { por: "usuario", em: "2026-08-21T16:00:00.000Z" },
      }
      writeRegistry(statePath(), { versao: 1, tarefas: [entry] })
      sessionGetImpl = async () => ({ agent: "code-reviewer" })
      const hooks = await makeHooks()
      await expect(callBefore(hooks, "bash", { command: "git push origin main" })).rejects.toThrow(
        /BLOQUEADO[\s\S]*push/s,
      )
      await expect(callBefore(hooks, "bash", { command: "ls -la" })).resolves.toBeUndefined()
    } finally {
      opt.blockGitPushForReviewer = original
    }
  })

  test("naoDeveBloquearPush_quandoAgenteNaoEhReviewer_mesmoComFlagAtiva", async () => {
    const opt = __internals.OPTIONS as unknown as { blockGitPushForReviewer: boolean }
    const original = opt.blockGitPushForReviewer
    opt.blockGitPushForReviewer = true
    try {
      sessionGetImpl = async () => ({ agent: "dev-frontend" })
      const hooks = await makeHooks()
      await expect(callBefore(hooks, "bash", { command: "git push origin main" })).resolves.toBeUndefined()
    } finally {
      opt.blockGitPushForReviewer = original
    }
  })
})

// ---------------------------------------------------------------------------
// Hooks do plugin — tool.execute.after bordas e resiliência
// ---------------------------------------------------------------------------
describe("hooks do plugin — tool.execute.after bordas", () => {
  test("deveIgnorarToolsQueNaoSejamTask", async () => {
    const hooks = await makeHooks()
    const hook = hooks["tool.execute.after"]
    if (!hook) throw new Error("hook ausente")
    await expect(
      hook({ tool: "bash", sessionID: "s", callID: "c" } as never, {} as never),
    ).resolves.toBeUndefined()
  })

  test("deveRetornarCedo_quandoSessionIdAusente_semMarcarFase", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true, sessionId: "" })
    const desenvolvimento = readRegistry(statePath()).tarefas[0]?.fases.find((f) => f.nome === "desenvolvimento")
    expect(desenvolvimento?.status).toBe("em_andamento")
  })

  test("fluxoContinua_quandoClientAppLogFalha", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true, compose: false, detector: false })
    execSyncMock.mockReturnValue("ok")
    const hooks = await makeHooks({ failLog: true })
    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()
  })

  test("deveLogarWarnSemQuebrar_quandoRegistryFalhaNaMarcacaoDeFase", async () => {
    criarTarefaAtiva()
    // existsSync falso para o state.json => readRegistry lança dentro do try
    // da marcação de fase; o catch deve engolir com warn (nunca quebra fluxo).
    existsSyncMock.mockImplementation((p: PathLike) =>
      String(p).endsWith("state.json") ? false : realFs.existsSync(p),
    )
    const hooks = await makeHooks()
    await expect(
      callAfter(hooks, { subagent_type: "dev-frontend", completed: true }),
    ).resolves.toBeUndefined()
    expect(messages().some((m) => m.includes("[REGISTRY] falha ao marcar fase"))).toBe(true)
  })
})
