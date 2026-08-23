/**
 * Testes do LOOP DE AUTO-CORREÇÃO do quality gate (FASE 3 — harness verificável):
 *   - gate falho => registrarRetry (retryHistory + retries++) e throw [PIPELINE-RETRY];
 *   - retries <= OPTIONS.maxRetries (2): tenta spawn automático via SDK
 *     (client.session.create + promptAsync); indisponível => fallback "orquestrador";
 *   - esgotado => escalarHumano (fase escala_humano) + relatório [PIPELINE-ESCALA]
 *     com arquivos suspeitos (coverage targets ∪ paths citados, dedup);
 *   - gate passou => resetarRetries;
 *   - autoRetryEnabled=false => comportamento legado (throw puro do gate).
 *
 * NENHUM comando real é executado: node:child_process é mockado por inteiro e
 * node:fs.existsSync é mockado com fallback para o fs real (o registry usa fs
 * real dentro de tmpdir). O client SDK é um stub configurável por teste.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import { execFileSync, execSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, type PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineOrchestrator, __internals } from "../../.opencode/plugins/pipeline-orchestrator"
import {
  createEntry,
  readRegistry,
  registrarRetry,
  escalarHumano,
  resetarRetries,
  validateEntry,
  writeRegistry,
  type RegistryEntry,
} from "../../.opencode/pipeline/registry"

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

interface SessionStub {
  createImpl?: () => Promise<unknown>
  promptAsyncImpl?: (...args: unknown[]) => Promise<unknown>
}

/**
 * Hooks do plugin com client stub. Por padrão o client NÃO tem session.create/
 * promptAsync (spawn indisponível => fallback "orquestrador"); passe
 * opts.session para simular SDK com capacidade de spawn.
 */
async function makeHooks(opts: { session?: SessionStub; failLog?: boolean } = {}) {
  logs = []
  const session: Record<string, unknown> = { get: () => sessionGetImpl() }
  if (opts.session?.createImpl) session.create = vi.fn(opts.session.createImpl)
  if (opts.session?.promptAsyncImpl) session.promptAsync = vi.fn(opts.session.promptAsyncImpl)
  const client = {
    app: {
      log: async (args: { body: { level: string; message: string } }) => {
        if (opts.failLog) throw new Error("app.log indisponivel")
        logs.push(args.body)
      },
    },
    session,
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
  opts: { subagent_type: string; completed: boolean },
): Promise<void> {
  const hook = hooks["tool.execute.after"]
  if (!hook) throw new Error("hook tool.execute.after ausente")
  await hook(
    { tool: "task", sessionID: "sess-1", callID: "call-1", args: { subagent_type: opts.subagent_type } } as never,
    {
      args: { subagent_type: opts.subagent_type },
      metadata: { sessionId: "sub-sessao-1" },
      output: opts.completed ? '... state="completed" ...' : '... state="error" ...',
      title: "task",
    } as never,
  )
}

function statePath(): string {
  return join(tmpDir, ".opencode", "pipeline", "state.json")
}

function criarTarefaAtiva(feature = "Feature de teste"): RegistryEntry {
  const entry = createEntry({ feature })
  writeRegistry(statePath(), { versao: 1, tarefas: [entry] })
  return entry
}

function lerEntrada(): RegistryEntry {
  const arquivo = readRegistry(statePath())
  expect(arquivo.tarefas).toHaveLength(1)
  return arquivo.tarefas[0] as RegistryEntry
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

/** Output de gate falho: 1 target de cobertura + linhas de falha citando paths. */
const OUTPUT_FALHA = [
  "RUN v4.1.11",
  "ERROR: Coverage for lines (31.67%) does not meet global threshold (95%) for src/store/useAuthStore.ts",
  "Tests failed",
  "FAIL src/pages/MenuPage.tsx > MenuPage > renderiza",
].join("\n")

/** Configura execSync para falhar APENAS no step de build com OUTPUT_FALHA. */
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

/** Uma transição dev -> reviewer com o gate falhando (fonte rastreada antes). */
async function falharTransicao(hooks: Hooks): Promise<void> {
  await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
  return callBefore(hooks, "task", { subagent_type: "code-reviewer" })
}

beforeAll(async () => {
  realFs = await vi.importActual<typeof import("node:fs")>("node:fs")
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plugin-retry-test-"))
  sessionGetImpl = async () => ({ agent: undefined })
  existsSyncMock.mockImplementation((p: PathLike) => realFs.existsSync(p))
  execSyncMock.mockReset()
  execFileSyncMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Loop de retry no caminho do gate (transição dev -> reviewer)
// ---------------------------------------------------------------------------
describe("FASE 3 — loop de retry do gate", () => {
  test("deveRegistrarRetryELancarPIPELINE_RETRY_quandoGateFalhaPelaPrimeiraVez", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()

    // Spawn indisponível (client sem session.create) => fallback orquestrador.
    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #1\/2/)

    const entry = lerEntrada()
    expect(entry.retries).toBe(1)
    expect(entry.retryHistory).toHaveLength(1)
    expect(entry.retryHistory?.[0]?.modo).toBe("orquestrador")
    // WARN 1 (revisão FASE 3): motivo prefere a linha "[FALHOU] <step>" — não
    // o header genérico "[PIPELINE-ORCHESTRATOR] ... FALHOU" que esconde o step real.
    expect(entry.retryHistory?.[0]?.motivo).toContain("[FALHOU] build")
    expect(entry.retryHistory?.[0]?.ts).toBeTruthy()
  })

  test("deveRegistrarSegundoRetry_quandoGateFalhaNovamente", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()

    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #1\/2/)
    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #2\/2/)

    const entry = lerEntrada()
    expect(entry.retries).toBe(2)
    expect(entry.retryHistory).toHaveLength(2)
  })

  test("deveEscalarHumanoComRelatorioEstruturado_quandoMaxRetriesEsgotado", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()

    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #1\/2/)
    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #2\/2/)
    // 3ª falha: MAX_RETRIES (2) esgotado => escala humana.
    const erro = falharTransicao(hooks)
    await expect(erro).rejects.toThrow(/\[PIPELINE-ESCALA\]/)
    await expect(erro).rejects.toThrow(/MAX_RETRIES esgotado \(2\)/)
    await expect(erro).rejects.toThrow(/Fase: desenvolvimento/)
    await expect(erro).rejects.toThrow(/Tentativas: 3/)
    // WARN 1 (revisão FASE 3): "Erro final" carrega o step real, não o header genérico.
    await expect(erro).rejects.toThrow(/Erro final: \[FALHOU\] build \(exit 2\)/)
    await expect(erro).rejects.toThrow(/Intervenção humana necessária/)

    const entry = lerEntrada()
    // Após a 3ª falha o after-hook já marcou "desenvolvimento" concluida
    // (task do dev terminou); sem fase em_andamento, escalarHumano ANEXA a
    // fase escalada — histórico preservado (dev concluiu; pipeline escalou).
    const escaladas = entry.fases.filter((f) => f.status === "escala_humano")
    expect(escaladas).toHaveLength(1)
    expect(escaladas[0]?.nome).toBe("desenvolvimento")
    // Entrada escalada NÃO está mais ativa (fase final).
    expect(__internals.getActiveEntry(readRegistry(statePath()))).toBeNull()
  })

  test("deveResetarRetriesSemNovoItem_quandoGatePassa", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()

    await expect(falharTransicao(hooks)).rejects.toThrow(/retry #1\/2/)
    expect(lerEntrada().retries).toBe(1)

    // Gate passa na segunda tentativa: retries volta a 0; histórico preservado.
    execSyncMock.mockReturnValue("ok")
    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()

    const entry = lerEntrada()
    expect(entry.retries).toBe(0)
    expect(entry.retryHistory).toHaveLength(1)
  })

  test("deveSpawnarSessaoAutomaticaEModoAuto_quandoClientSuportaSpawn", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks({
      session: {
        createImpl: async () => ({ data: { id: "sess-retry-42" } }),
        promptAsyncImpl: async () => undefined,
      },
    })

    const erro = falharTransicao(hooks)
    await expect(erro).rejects.toThrow(/retry #1\/2/)
    await expect(erro).rejects.toThrow(/AUTOMATICAMENTE/)
    await expect(erro).rejects.toThrow(/sessão sess-retry-42/)

    const entry = lerEntrada()
    expect(entry.retries).toBe(1)
    expect(entry.retryHistory?.[0]?.modo).toBe("auto")
    expect(entry.retryHistory?.[0]?.sessionId).toBe("sess-retry-42")
  })

  test("deveEnviarInstrucaoComErroCompletoNaSessaoSpawnada", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const promptAsyncMock = vi.fn(async (..._args: unknown[]) => undefined)
    const hooks = await makeHooks({
      session: {
        createImpl: async () => ({ data: { id: "sess-instr-1" } }),
        promptAsyncImpl: (...args: unknown[]) => promptAsyncMock(...args),
      },
    })

    await expect(falharTransicao(hooks)).rejects.toThrow(/PIPELINE-RETRY/)

    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    const chamada = promptAsyncMock.mock.calls[0]?.[0] as {
      path: { id: string }
      body: { agent: string; parts: Array<{ type: string; text: string }> }
    }
    expect(chamada.path.id).toBe("sess-instr-1")
    expect(chamada.body.agent).toBe("dev-frontend")
    const texto = chamada.body.parts[0]?.text ?? ""
    expect(texto).toContain("[PIPELINE-ORCHESTRATOR]")
    expect(texto).toContain("verdes")
  })

  test("deveCairNoFallbackOrquestrador_quandoSpawnDoClientLanca", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks({
      session: {
        createImpl: async () => {
          throw new Error("SDK indisponível")
        },
        promptAsyncImpl: async () => undefined,
      },
    })

    const erro = falharTransicao(hooks)
    await expect(erro).rejects.toThrow(/retry #1\/2/)
    await expect(erro).rejects.toThrow(/RE-DELEGUE ao @dev-frontend/)

    const entry = lerEntrada()
    expect(entry.retryHistory?.[0]?.modo).toBe("orquestrador")
    expect(entry.retryHistory?.[0]?.sessionId).toBeUndefined()
  })

  test("deveGravarSessionIdParaAuditoria_quandoPromptAsyncFalhaAposCreateOk", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks({
      session: {
        createImpl: async () => ({ data: { id: "sess-meio-caminho" } }),
        promptAsyncImpl: async () => {
          throw new Error("prompt_async explodiu")
        },
      },
    })

    await expect(falharTransicao(hooks)).rejects.toThrow(/RE-DELEGUE ao @dev-frontend/)
    // INFO 1 (revisão FASE 3): modo "orquestrador", MAS sessionId criado fica
    // gravado no retryHistory para auditoria.
    const item = lerEntrada().retryHistory?.[0]
    expect(item?.modo).toBe("orquestrador")
    expect(item?.sessionId).toBe("sess-meio-caminho")
  })

  test("deveLogarWarnSemQuebrar_quandoResetarRetriesFalhaPosGate", async () => {
    // Entrada com retries=1 e retryHistory INVÁLIDO escrito direto no disco
    // (bypassa writeRegistry): o reset pós-gate falha na validação => warn,
    // fluxo segue (transição resolve).
    const entry = {
      ...createEntry({ feature: "Reset com falha" }),
      retries: 1,
      retryHistory: [{ ts: "2026-08-21T00:00:00Z", motivo: "m", modo: "invalido" as never }],
    }
    realFs.mkdirSync(join(tmpDir, ".opencode", "pipeline"), { recursive: true })
    realFs.writeFileSync(statePath(), JSON.stringify({ versao: 1, tarefas: [entry] }))
    setFsFlags({ pkg: true })
    execSyncMock.mockReturnValue("ok")
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()
    expect(messages().some((m) => m.includes("falha ao resetar retries"))).toBe(true)
  })

  test("devePreservarComportamentoLegado_quandoAutoRetryDesabilitado", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const opt = __internals.OPTIONS as unknown as { autoRetryEnabled: boolean }
    const original = opt.autoRetryEnabled
    opt.autoRetryEnabled = false
    try {
      const hooks = await makeHooks()
      // Throw puro do gate (sem wrapper [PIPELINE-RETRY]).
      await expect(falharTransicao(hooks)).rejects.toThrow(/\[PIPELINE-ORCHESTRATOR\].*FALHOU/s)
      await expect(falharTransicao(hooks)).rejects.not.toThrow(/PIPELINE-RETRY/)

      const entry = lerEntrada()
      expect(entry.retries).toBe(0)
      expect(entry.retryHistory).toHaveLength(0)
    } finally {
      opt.autoRetryEnabled = original
    }
  })

  test("deveCairDiretoNoOrquestradorSemTentarSpawn_quandoAutoSpawnRetryFalse", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const opt = __internals.OPTIONS as unknown as { autoSpawnRetry: boolean }
    const original = opt.autoSpawnRetry
    opt.autoSpawnRetry = false
    try {
      let chamouCreate = false
      const hooks = await makeHooks({
        session: {
          createImpl: async () => {
            chamouCreate = true
            return { data: { id: "sess-nao-deve-ser-criada" } }
          },
          promptAsyncImpl: async () => undefined,
        },
      })

      // INFO 4 (revisão FASE 3): fallback DIRETO p/ orquestrador — nenhuma
      // tentativa de spawn (session.create nunca é chamado).
      await expect(falharTransicao(hooks)).rejects.toThrow(/RE-DELEGUE ao @dev-frontend/)
      expect(chamouCreate).toBe(false)
      expect(lerEntrada().retryHistory?.[0]?.modo).toBe("orquestrador")
      expect(lerEntrada().retryHistory?.[0]?.sessionId).toBeUndefined()
    } finally {
      opt.autoSpawnRetry = original
    }
  })

  test("deveRodarGateNaTransicaoAoReviewer_quandoSpawnAutoConcluiuSemTaskDevIntermediaria", async () => {
    // CRITICAL (revisão FASE 3): a sessão spawnada via session.create/
    // promptAsync NÃO passa pela tool `task` => lastCompletedGateSource nunca
    // rearma. A delegação ao reviewer após a correção automática NÃO pode
    // pular o gate: fonte desconhecida => gate do frontend roda.
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks({
      session: {
        createImpl: async () => ({ data: { id: "sess-auto-1" } }),
        promptAsyncImpl: async () => undefined,
      },
    })

    // Retry #1 lançado automaticamente; o throw instrui o próximo passo.
    const erro = falharTransicao(hooks)
    await expect(erro).rejects.toThrow(/AUTOMATICAMENTE/)
    await expect(erro).rejects.toThrow(
      /Após a sessão de correção concluir, delegue ao @code-reviewer — o quality gate rodará automaticamente/,
    )

    // A sessão spawnada concluiu FORA da tool `task` (nenhuma task dev
    // intermediária). Correção aplicada: gate agora passa.
    execSyncMock.mockReturnValue("ok")
    await expect(callBefore(hooks, "task", { subagent_type: "code-reviewer" })).resolves.toBeUndefined()

    const msgs = messages()
    // GATE RODA (não pula), mesmo sem fonte dev rastreada:
    expect(msgs.some((m) => m.includes("rodando Quality Gate FRONTEND"))).toBe(true)
    expect(msgs.some((m) => m.includes("sem fonte dev rastreada"))).toBe(true)
    expect(msgs.some((m) => m.includes("gate pulado"))).toBe(false)
    // Gate passou => retries zerados (histórico preservado).
    const entry = lerEntrada()
    expect(entry.retries).toBe(0)
    expect(entry.retryHistory).toHaveLength(1)
  })

  test("deveUnirEDeduplicarArquivosSuspeitos_noRelatorioDeEscala", async () => {
    criarTarefaAtiva()
    setFsFlags({ pkg: true })
    falharBuild()
    const hooks = await makeHooks()

    for (let i = 0; i < 3; i++) {
      const promessa = falharTransicao(hooks)
      if (i === 2) {
        // União: target de cobertura (useAuthStore) + path citado em failure
        // line (MenuPage.tsx), SEM duplicação do arquivo que aparece nos dois.
        await expect(promessa).rejects.toThrow(/Arquivos suspeitos:/)
        await expect(promessa).rejects.toThrow(/- src\/store\/useAuthStore\.ts/)
        await expect(promessa).rejects.toThrow(/- src\/pages\/MenuPage\.tsx/)
        const capturado: string = await promessa.then(
          () => "",
          (e: Error) => e.message,
        )
        const secao = capturado.split("Arquivos suspeitos:")[1]?.split("Intervenção")[0] ?? ""
        const ocorrenciasUseAuth = secao.split("src/store/useAuthStore.ts").length - 1
        expect(ocorrenciasUseAuth).toBe(1)
      } else {
        await expect(promessa).rejects.toThrow(/PIPELINE-RETRY/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Helpers de registry FASE 3 (unidade direta)
// ---------------------------------------------------------------------------
describe("registrarRetry / escalarHumano / resetarRetries (registry)", () => {
  test("registrarRetry_deveAppendarHistoricoEIncrementarRetries_persistindoEmDisco", () => {
    const entry = criarTarefaAtiva()
    registrarRetry(statePath(), entry.taskId, { motivo: "build quebrado", modo: "orquestrador" })
    registrarRetry(statePath(), entry.taskId, { motivo: "ainda quebrado", modo: "auto", sessionId: "s1" })

    const depois = lerEntrada()
    expect(depois.retries).toBe(2)
    expect(depois.retryHistory).toEqual([
      expect.objectContaining({ motivo: "build quebrado", modo: "orquestrador" }),
      expect.objectContaining({ motivo: "ainda quebrado", modo: "auto", sessionId: "s1" }),
    ])
  })

  test("registrarRetry_deveLancar_quandoTaskIdInexistente", () => {
    criarTarefaAtiva()
    expect(() =>
      registrarRetry(statePath(), "task-fantasma", { motivo: "x", modo: "auto" }),
    ).toThrow(/task-fantasma/)
  })

  test("escalarHumano_deveMarcarFaseEmAndamento_ePersistirMotivoERetries", () => {
    const entry = criarTarefaAtiva()
    escalarHumano(statePath(), entry.taskId, "MAX_RETRIES esgotado")

    const depois = lerEntrada()
    const desenvolvimento = depois.fases.find((f) => f.nome === "desenvolvimento")
    expect(desenvolvimento?.status).toBe("escala_humano")
    expect(depois.retries).toBe(1)
    expect(depois.retryHistory?.at(-1)).toMatchObject({ motivo: "MAX_RETRIES esgotado", modo: "orquestrador" })
    expect(__internals.getActiveEntry(readRegistry(statePath()))).toBeNull()
  })

  test("escalarHumano_deveAnexarFase_quandoNaoHaFaseEmAndamento", () => {
    const entry = criarTarefaAtiva()
    // Todas as fases concluídas: nenhuma em_andamento para marcar.
    writeRegistry(
      statePath(),
      __internals.updateEntry(readRegistry(statePath()), entry.taskId, {
        fases: entry.fases.map((f) => ({ ...f, status: "concluida" as const, concluidoEm: f.iniciadoEm })),
      }),
    )

    escalarHumano(statePath(), entry.taskId, "sem fase ativa")

    const depois = lerEntrada()
    const anexada = depois.fases.at(-1)
    expect(anexada?.status).toBe("escala_humano")
    expect(anexada?.nome).toBe("desenvolvimento")
  })

  test("escalarHumano_deveLancar_quandoTaskIdInexistente", () => {
    criarTarefaAtiva()
    expect(() => escalarHumano(statePath(), "task-fantasma", "motivo")).toThrow(/task-fantasma/)
  })

  test("resetarRetries_deveZerarContador_semApagarHistorico", () => {
    const entry = criarTarefaAtiva()
    registrarRetry(statePath(), entry.taskId, { motivo: "falha x", modo: "auto", sessionId: "s9" })
    resetarRetries(statePath(), entry.taskId)

    const depois = lerEntrada()
    expect(depois.retries).toBe(0)
    expect(depois.retryHistory).toHaveLength(1)
  })

  test("resetarRetries_deveLancar_quandoTaskIdInexistente", () => {
    criarTarefaAtiva()
    expect(() => resetarRetries(statePath(), "task-fantasma")).toThrow(/task-fantasma/)
  })
})

// ---------------------------------------------------------------------------
// validateEntry — shape de retryHistory (tolerância a legado)
// ---------------------------------------------------------------------------
describe("validateEntry — retryHistory (FASE 3)", () => {
  const base = (): RegistryEntry => {
    const e = createEntry({ feature: "Validação retry" })
    e.retryHistory = []
    return e
  }

  test("deveTolerarRetryHistoryAusente_entradaLegado", () => {
    const e = base()
    delete (e as Partial<RegistryEntry>).retryHistory
    expect(() => validateEntry(e)).not.toThrow()
  })

  test("deveLancar_quandoRetryHistoryNaoEhArray", () => {
    const e = base()
    ;(e as unknown as { retryHistory: unknown }).retryHistory = "não-sou-array"
    expect(() => validateEntry(e)).toThrow(/retryHistory.*array/)
  })

  test("deveLancar_quandoItemNaoEhObjeto", () => {
    const e = base()
    ;(e as unknown as { retryHistory: unknown }).retryHistory = [42]
    expect(() => validateEntry(e)).toThrow(/retryHistory.*objeto/s)
  })

  test.each([
    ["ts vazio", { ts: "", motivo: "m", modo: "auto" }, /retryHistory\[\]\.ts/],
    ["motivo vazio", { ts: "2026-08-21T00:00:00Z", motivo: "", modo: "auto" }, /retryHistory\[\]\.motivo/],
    ["modo inválido", { ts: "2026-08-21T00:00:00Z", motivo: "m", modo: "manual" }, /modo.*auto.*orquestrador/s],
    ["sessionId não-string", { ts: "2026-08-21T00:00:00Z", motivo: "m", modo: "auto", sessionId: 7 }, /sessionId.*string/],
  ])("deveLancar_quandoItemInvalido (%s)", (_nome, item, padrao) => {
    const e = base()
    ;(e as unknown as { retryHistory: unknown }).retryHistory = [item]
    expect(() => validateEntry(e)).toThrow(padrao)
  })

  test("deveAceitarItemValidoComEOuSemSessionId", () => {
    const e = base()
    e.retryHistory = [
      { ts: "2026-08-21T00:00:00Z", motivo: "m1", modo: "auto", sessionId: "s1" },
      { ts: "2026-08-21T00:01:00Z", motivo: "m2", modo: "orquestrador" },
    ]
    expect(() => validateEntry(e)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Helpers puros da FASE 3 (unidade direta — branches de borda)
// ---------------------------------------------------------------------------
describe("helpers FASE 3 — primeiroMotivo / extrairArquivosSuspeitos / tentarSpawnCorrecao", () => {
  test("primeiroMotivo_devePreferirLinhaFALHOU_sobreHeaderGenerico", () => {
    // WARN 1 (revisão FASE 3): header "[PIPELINE-ORCHESTRATOR] ... FALHOU" é
    // genérico; a linha "[FALHOU] <step>" carrega o step real.
    const erro = [
      "[PIPELINE-ORCHESTRATOR] Quality Gate FRONTEND (React + Vitest) FALHOU — corrija o codigo.",
      "",
      "CWD: /tmp/projeto",
      "",
      "[FALHOU] build (exit 2)",
      "error TS2307: boom",
    ].join("\n")
    expect(__internals.primeiroMotivo(erro)).toBe("[FALHOU] build (exit 2)")
  })

  test("primeiroMotivo_deveConcatenarHeaderEPrimeiraFalha_quandoSemLinhaFALHOU", () => {
    const erro = [
      "[PIPELINE-ORCHESTRATOR] IMPECCABLE DETECTOR encontrou anti-padroes de design — revise antes do code-reviewer.",
      "",
      "CWD: /tmp/projeto",
      "",
      "line 12: [layout-imbalance] grid quebrado",
    ].join("\n")
    expect(__internals.primeiroMotivo(erro)).toBe(
      "[PIPELINE-ORCHESTRATOR] IMPECCABLE DETECTOR encontrou anti-padroes de design — revise antes do code-reviewer. — line 12: [layout-imbalance] grid quebrado",
    )
  })

  test("primeiroMotivo_deveExtrairPrimeiraLinhaNaoVazia_truncadaEm200", () => {
    expect(__internals.primeiroMotivo("\n\n  linha um \nlinha dois")).toBe("linha um — linha dois")
    // Concatenação truncada em 200 (header longo + detalhe).
    const longa = `${"x".repeat(300)}\ndetalhe`
    expect(__internals.primeiroMotivo(longa)).toHaveLength(200)
    expect(__internals.primeiroMotivo("")).toBe("")
  })

  test("extrairArquivosSuspeitos_deveUnirCoverageTargetsEPathsCitados_comDedup", () => {
    const output = [
      "ERROR: Coverage for lines (10%) does not meet global threshold (95%) for src/a.ts",
      "FAIL src/b.tsx > teste",
      "error em src/a.ts novamente",
    ].join("\n")
    expect(__internals.extrairArquivosSuspeitos(output)).toEqual(["src/a.ts", "src/b.tsx"])
  })

  test("extrairArquivosSuspeitos_deveRetornarVazio_quandoNadaCasa", () => {
    expect(__internals.extrairArquivosSuspeitos("nenhum path aqui")).toEqual([])
  })

  test("tentarSpawnCorrecao_deveRetornarNull_quandoClientSemCapacidade", async () => {
    expect(await __internals.tentarSpawnCorrecao({}, "instrucao", "titulo", "dev-frontend")).toBeNull()
    expect(
      await __internals.tentarSpawnCorrecao(
        { session: { create: vi.fn() } },
        "i",
        "t",
        "dev-frontend",
      ),
    ).toBeNull()
  })

  test("tentarSpawnCorrecao_deveRetornarNull_quandoCreateNaoDevolveId", async () => {
    const nulo = await __internals.tentarSpawnCorrecao(
      { session: { create: async () => ({ data: {} }), promptAsync: async () => undefined } },
      "i",
      "t",
      "dev-frontend",
    )
    expect(nulo).toBeNull()
  })

  test("processarFalhaGate_deveRethrowErroOriginal_quandoRegistryIlegivel", async () => {
    const gateError = new Error("[PIPELINE-ORCHESTRATOR] gate FALHOU")
    await expect(
      __internals.processarFalhaGate({
        gateError,
        rootDir: join(tmpDir, "sem-state"),
        client: {},
        log: async () => {},
        sourceAgent: "dev-frontend",
      }),
    ).rejects.toBe(gateError)
  })

  test("processarFalhaGate_deveRethrowErroOriginal_quandoSemEntradaAtiva", async () => {
    const entry = criarTarefaAtiva()
    escalarHumano(statePath(), entry.taskId, "escalado antes")
    const gateError = new Error("[PIPELINE-ORCHESTRATOR] gate FALHOU de novo")

    await expect(
      __internals.processarFalhaGate({
        gateError,
        rootDir: tmpDir,
        client: {},
        log: async () => {},
        sourceAgent: "dev-frontend",
      }),
    ).rejects.toBe(gateError)
  })
})
