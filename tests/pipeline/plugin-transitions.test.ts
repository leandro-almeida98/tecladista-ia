/**
 * Testes das TRANSIÇÕES MECANIZADAS do pipeline (FASE 2 — harness verificável):
 *   - planejamento→dev: design doc obrigatório (referenciado E existente);
 *   - invariante violada (>1 ativas) bloqueia TODA delegação;
 *   - allowedTargets restringe os destinos de delegação;
 *   - dev→reviewer: cada step do gate vira GateResult em entry.gateResults;
 *   - reviewer→final: tool detect_changes bem-sucedida grava detectChangesReport;
 *   - aprovação humana mecânica: tool question (commit/push + afirmativo);
 *   - guarda bash: git commit/push do reviewer exige report + aprovação.
 *
 * NENHUM comando real é executado: node:child_process é mockado; node:fs tem
 * existsSync mockado com fallback ao real e renameSync com flag de falha
 * (para simular erro de escrita atômica). O registry usa fs real em tmpdir.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, renameSync, rmSync, type PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineOrchestrator, __internals } from "../../.opencode/plugins/pipeline-orchestrator"
import {
  createEntry,
  readRegistry,
  writeRegistry,
  type RegistryEntry,
} from "../../.opencode/pipeline/registry"

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, execSync: vi.fn(), execFileSync: vi.fn() }
})

const mockState = vi.hoisted(() => ({ renameShouldFail: false }))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    existsSync: vi.fn(),
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (mockState.renameShouldFail) throw new Error("rename boom")
      return actual.renameSync(...args)
    },
  }
})

const execSyncMock = execSync as unknown as Mock
const execFileSyncMock = execFileSync as unknown as Mock
const existsSyncMock = existsSync as unknown as Mock

let realFs: typeof import("node:fs")

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

async function callAfterTool(
  hooks: Hooks,
  opts: { tool: string; args?: Record<string, unknown>; output?: Record<string, unknown> },
): Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (!hook) throw new Error("hook tool.execute.after ausente")
  await hook(
    { tool: opts.tool, sessionID: "sess-1", callID: "call-1", args: opts.args ?? {} } as never,
    { title: opts.tool, metadata: {}, output: "", ...opts.output } as never,
  )
}

async function callAfterTask(
  hooks: Hooks,
  opts: { subagent_type: string; completed: boolean },
): Promise<void> {
  await callAfterTool(hooks, {
    tool: "task",
    args: { subagent_type: opts.subagent_type },
    output: {
      metadata: { sessionId: "sub-sessao-1" },
      output: opts.completed ? '... state="completed" ...' : '... state="error" ...',
    },
  })
}

function statePath(): string {
  return join(tmpDir, ".opencode", "pipeline", "state.json")
}

function lerTarefas(): RegistryEntry[] {
  return readRegistry(statePath()).tarefas
}

function criarTarefaAtiva(feature = "Feature de teste"): RegistryEntry {
  const entry = createEntry({ feature })
  writeRegistry(statePath(), { versao: 1, tarefas: [entry] })
  return entry
}

function criarDesignDoc(nome = "2026-08-21-tela-login-design.md"): string {
  const dir = join(tmpDir, "docs", "plans")
  realFs.mkdirSync(dir, { recursive: true })
  realFs.writeFileSync(join(dir, nome), "# Design\n", "utf-8")
  return `docs/plans/${nome}`
}

beforeAll(async () => {
  realFs = await vi.importActual<typeof import("node:fs")>("node:fs")
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plugin-transitions-test-"))
  sessionGetImpl = async () => ({ agent: undefined })
  existsSyncMock.mockImplementation((p: PathLike) => realFs.existsSync(p))
  execSyncMock.mockReset()
  execFileSyncMock.mockReset()
  mockState.renameShouldFail = false
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// (6a) allowedTargets
// ---------------------------------------------------------------------------
describe("before task — allowedTargets (FASE 2)", () => {
  test("deveBloquearTargetNaoAutorizado_comEntradaAtiva", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "task", { subagent_type: "git-committer" })).rejects.toThrow(
      /PIPELINE-REGISTRY[\s\S]*'git-committer' não autorizado\. Autorizados: dev-frontend, code-reviewer\./,
    )
  })

  test("deveBloquearTargetNaoAutorizado_semEntradaAtiva_antesDoRegistry", async () => {
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "task", { subagent_type: "dev-backend" })).rejects.toThrow(
      /não autorizado/,
    )
    // Bloqueio ocorre antes do registry: nenhum state.json criado.
    expect(realFs.existsSync(statePath())).toBe(false)
  })

  test("devePermitirTargetsAutorizados_devFrontendECodeReviewer", async () => {
    expect(__internals.OPTIONS.allowedTargets).toEqual(["dev-frontend", "code-reviewer"])
    const designDoc = criarDesignDoc()
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "task", {
        subagent_type: "dev-frontend",
        description: `Feature — design em ${designDoc}`,
      }),
    ).resolves.toBeUndefined()
    // Entrada ativa criada acima; code-reviewer é autorizado (gate pulado sem fonte rastreada).
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()
  })

  test("deveManterComportamentoTargetVazio_ignorado", async () => {
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "task", { subagent_type: "" })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (6b) invariante violada bloqueia TODA delegação (dívida W2)
// ---------------------------------------------------------------------------
describe("before task — invariante de entrada única (FASE 2)", () => {
  test("deveBloquearDelegacaoAoDev_quandoDuasEntradasAtivas", async () => {
    const file = { versao: 1 as const, tarefas: [createEntry({ feature: "A" }), createEntry({ feature: "B" })] }
    writeRegistry(statePath(), file)
    const hooks = await makeHooks()

    await expect(
      callBefore(hooks, "task", { subagent_type: "dev-frontend", description: "terceira" }),
    ).rejects.toThrow(/Invariante violada: 2 entradas ativas/)
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).rejects.toThrow(
      /Invariante violada/,
    )

    // Nenhuma terceira entrada foi criada: estado intacto até correção manual.
    expect(lerTarefas()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// (6c) planejamento→dev: design doc pré-condição
// ---------------------------------------------------------------------------
describe("before task — design doc pré-condição (FASE 2)", () => {
  test("deveBloquearCriacao_quandoDesignDocNaoReferenciado", async () => {
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "task", { subagent_type: "dev-frontend", description: "Tela de login" }),
    ).rejects.toThrow(
      /planejamento→dev bloqueado: pré-condição ausente — design doc aprovado em docs\/plans\/YYYY-MM-DD-\*-design\.md referenciado na tarefa\./,
    )
    expect(realFs.existsSync(statePath())).toBe(false)
  })

  test("deveBloquearCriacao_quandoDesignDocReferenciadoMasAusenteEmDisco", async () => {
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "task", {
        subagent_type: "dev-frontend",
        description: "Ver docs/plans/2026-08-21-fantasma-design.md",
      }),
    ).rejects.toThrow(/pré-condição ausente/)
    expect(realFs.existsSync(statePath())).toBe(false)
  })

  test("deveCriarEntradaComDesignDoc_quandoValido", async () => {
    const designDoc = criarDesignDoc("2026-08-22-cadastro-design.md")
    const hooks = await makeHooks()
    await callBefore(hooks, "task", {
      subagent_type: "dev-frontend",
      description: "Tela de cadastro",
      prompt: `implementar conforme ${designDoc}`,
    })

    const tarefas = lerTarefas()
    expect(tarefas).toHaveLength(1)
    expect((tarefas[0] as RegistryEntry).designDoc).toBe(designDoc)
  })

  test("deveExtrairDesignDocDoPrompt_quandoDescriptionVazia", async () => {
    const designDoc = criarDesignDoc("2026-08-22-menu-design.md")
    const hooks = await makeHooks()
    await callBefore(hooks, "task", {
      subagent_type: "dev-frontend",
      prompt: `seguir ${designDoc} à risca`,
    })
    expect((lerTarefas()[0] as RegistryEntry).designDoc).toBe(designDoc)
  })
})

// ---------------------------------------------------------------------------
// (7b) after-hook: tool detect_changes → detectChangesReport
// ---------------------------------------------------------------------------
describe("after tool detect_changes — detectChangesReport (FASE 2)", () => {
  test("deveGravarReport_quandoToolBemSucedidaEEntradaAtiva", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()

    await callAfterTool(hooks, {
      tool: "gitnexus_detect_changes",
      output: { output: "Análise: risk: HIGH — 12 changed symbols no working tree" },
    })

    const report = (lerTarefas()[0] as RegistryEntry).detectChangesReport
    expect(report?.riskLevel).toBe("HIGH")
    expect(report?.changedCount).toBe(12)
    expect(report?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("deveGravarSomenteTs_quandoOutputSemInfoParseavel_tolerante", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, { tool: "detect_changes", output: { output: "sem dados úteis" } })

    const report = (lerTarefas()[0] as RegistryEntry).detectChangesReport
    expect(report?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report?.riskLevel).toBeUndefined()
    expect(report?.changedCount).toBeUndefined()
  })

  test("deveNormalizarRiskLevelParaMaiusculas", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, {
      tool: "detect_changes",
      output: { output: "risk level: medium" },
    })
    expect((lerTarefas()[0] as RegistryEntry).detectChangesReport?.riskLevel).toBe("MEDIUM")
  })

  test("deveNaoGravar_quandoToolComErro", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, {
      tool: "detect_changes",
      output: { output: "boom", error: new Error("falhou") },
    })
    expect((lerTarefas()[0] as RegistryEntry).detectChangesReport).toBeNull()
  })

  test("deveNaoGravarNemCriarState_quandoSemEntradaAtiva", async () => {
    const hooks = await makeHooks()
    await expect(
      callAfterTool(hooks, { tool: "detect_changes", output: { output: "risk: LOW" } }),
    ).resolves.toBeUndefined()
    expect(realFs.existsSync(statePath())).toBe(false)
  })

  test("deveNaoQuebrarFluxo_quandoRegistryFalha_warn", async () => {
    criarTarefaAtiva()
    realFs.rmSync(statePath())
    const hooks = await makeHooks()
    await expect(
      callAfterTool(hooks, { tool: "detect_changes", output: { output: "risk: LOW" } }),
    ).resolves.toBeUndefined()
    expect(messages().some((m) => m.includes("[REGISTRY] falha ao registrar detect_changes"))).toBe(true)
  })

  test("deveTolerarOutputCircular_semThrow_eGravarSoTs", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await callAfterTool(hooks, { tool: "detect_changes", output: { output: circular } })
    const report = (lerTarefas()[0] as RegistryEntry).detectChangesReport
    expect(report?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ---------------------------------------------------------------------------
// (7c) after-hook: tool question → aprovação humana mecânica
// ---------------------------------------------------------------------------
describe("after tool question — aprovação humana (FASE 2)", () => {
  const perguntaCommit = {
    questions: [{ question: "Posso commitar e fazer push para a main?", header: "Commit" }],
  }

  test("deveAprovar_quandoPerguntaCommitERespostaAfirmativa", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, { tool: "question", args: perguntaCommit, output: { output: "sim" } })

    const aprovacao = (lerTarefas()[0] as RegistryEntry).aprovacaoHumana
    expect(aprovacao?.por).toBe("usuario")
    expect(aprovacao?.em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("deveNaoAprovar_quandoPerguntaNaoRelacionada", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, {
      tool: "question",
      args: { questions: [{ question: "Aprova o design da tela?", header: "Design" }] },
      output: { output: "sim" },
    })
    expect((lerTarefas()[0] as RegistryEntry).aprovacaoHumana).toBeNull()
  })

  test("deveNaoAprovar_quandoRespostaNegativa", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, { tool: "question", args: perguntaCommit, output: { output: "não" } })
    expect((lerTarefas()[0] as RegistryEntry).aprovacaoHumana).toBeNull()
  })

  test("deveNaoAprovar_quandoLabelSelecionadoEmMetadata_afirmativo", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    await callAfterTool(hooks, {
      tool: "question",
      args: perguntaCommit,
      output: { metadata: { answers: ["Só commitar"] } },
    })
    expect((lerTarefas()[0] as RegistryEntry).aprovacaoHumana?.por).toBe("usuario")
  })

  test("deveSerTolerante_quandoArgsCircular_nuncaThrow", async () => {
    criarTarefaAtiva()
    const hooks = await makeHooks()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(
      callAfterTool(hooks, { tool: "question", args: circular, output: { output: "sim" } }),
    ).resolves.toBeUndefined()
    expect((lerTarefas()[0] as RegistryEntry).aprovacaoHumana).toBeNull()
  })

  test("deveNaoQuebrar_quandoSemEntradaAtiva", async () => {
    const hooks = await makeHooks()
    await expect(
      callAfterTool(hooks, { tool: "question", args: perguntaCommit, output: { output: "sim" } }),
    ).resolves.toBeUndefined()
    expect(realFs.existsSync(statePath())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (8) guarda bash: git commit/push do reviewer
// ---------------------------------------------------------------------------
describe("before bash — guarda de commit do reviewer (FASE 2)", () => {
  function reviewer(): void {
    sessionGetImpl = async () => ({ agent: "code-reviewer" })
  }

  test("deveBloquearGitCommit_quandoSemDetectChangesReport", async () => {
    criarTarefaAtiva()
    reviewer()
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "bash", { command: 'git commit -m "feat: x"' }),
    ).rejects.toThrow(/relatório gitnexus_detect_changes não registrado/)
  })

  test("deveBloquearGitPush_quandoComReportMasSemAprovacao", async () => {
    const entry = criarTarefaAtiva()
    writeRegistry(statePath(), {
      versao: 1,
      tarefas: [{ ...entry, detectChangesReport: { ts: "2026-08-21T15:00:00.000Z", riskLevel: "LOW" } }],
    })
    reviewer()
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "bash", { command: "git push origin main" })).rejects.toThrow(
      /aprovação humana não registrada/,
    )
  })

  test("devePassarGitCommit_quandoReportEAprovacaoPresentes", async () => {
    const entry = criarTarefaAtiva()
    writeRegistry(statePath(), {
      versao: 1,
      tarefas: [
        {
          ...entry,
          detectChangesReport: { ts: "2026-08-21T15:00:00.000Z", riskLevel: "LOW", changedCount: 3 },
          aprovacaoHumana: { por: "usuario", em: "2026-08-21T16:00:00.000Z" },
        },
      ],
    })
    reviewer()
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "bash", { command: 'git commit -m "feat" && git push origin main' }),
    ).resolves.toBeUndefined()
  })

  test("gitAdd_deveExigirSomenteEntradaAtiva_semReportNemAprovacao", async () => {
    criarTarefaAtiva()
    reviewer()
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "bash", { command: "git add src/x.ts" })).resolves.toBeUndefined()
  })

  test("gitAdd_deveBloquear_quandoSemEntradaAtiva", async () => {
    reviewer()
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "bash", { command: "git add src/x.ts" })).rejects.toThrow(
      /nenhuma tarefa ativa/,
    )
  })

  test("deveBloquearGitCommit_quandoSemEntradaAtiva", async () => {
    reviewer()
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "bash", { command: 'git commit -m "feat"' }),
    ).rejects.toThrow(/git commit\/push bloqueado: nenhuma tarefa ativa/)
  })

  test("comandoNaoGit_deveSerIntocado_mesmoSemRegistry", async () => {
    reviewer()
    const hooks = await makeHooks()
    await expect(callBefore(hooks, "bash", { command: "ls -la" })).resolves.toBeUndefined()
  })

  test("agenteNaoReviewer_deveSerIntocado_mesmoGitCommitSemPreCondicoes", async () => {
    sessionGetImpl = async () => ({ agent: "dev-frontend" })
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "bash", { command: 'git commit -m "wip"' }),
    ).resolves.toBeUndefined()
  })

  test("deveTratarAgenteDesconhecidoComoNaoReviewer", async () => {
    const hooks = await makeHooks()
    await expect(
      callBefore(hooks, "bash", { command: 'git commit -m "wip"' }),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (9) gate results: cada step vira GateResult em entry.gateResults
// ---------------------------------------------------------------------------
describe("transição dev→reviewer — gateResults (FASE 2)", () => {
  test("deveGravarUmGateResultPorStep_quandoGatePassa", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true, compose: false, detector: false })
    execSyncMock.mockReturnValue("ok")
    const hooks = await makeHooks()

    await callAfterTask(hooks, { subagent_type: "dev-frontend", completed: true })
    await callBefore(hooks, "task", { subagent_type: "code-reviewer" })

    const results = (lerTarefas()[0] as RegistryEntry).gateResults
    expect(results.map((r) => r.step)).toEqual(["build", "test", "coverage"])
    for (const r of results) {
      expect(r.ok).toBe(true)
      expect(r.exitCode).toBe(0)
      expect(r.detalhe).toBeNull()
      expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  test("deveGravarGateResultDeFalha_quandoStepQuebra_ePropagarThrow", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes("npm run build")) {
        throw mkExecError({ stdout: "error TS2307: Cannot find module", stderr: "", status: 2 })
      }
      return "ok"
    })
    const hooks = await makeHooks()

    await callAfterTask(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).rejects.toThrow(
      /FALHOU/,
    )

    const results = (lerTarefas()[0] as RegistryEntry).gateResults
    expect(results).toHaveLength(1)
    const build = results[0] as RegistryEntry["gateResults"][number]
    expect(build.step).toBe("build")
    expect(build.ok).toBe(false)
    expect(build.exitCode).toBe(2)
    expect(build.detalhe).toContain("error TS2307")
  })

  test("deveNaoQuebrarGate_quandoRegistroDoGateResultFalha_warn", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true, compose: false, detector: false })
    execSyncMock.mockReturnValue("ok")
    mockState.renameShouldFail = true // escrita atômica falha => warn, gate segue
    const hooks = await makeHooks()

    await callAfterTask(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()
    expect(
      messages().some((m) => m.includes("[REGISTRY] falha ao registrar gate result")),
    ).toBe(true)
  })
})
