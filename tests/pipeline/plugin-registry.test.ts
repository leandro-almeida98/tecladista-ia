// @vitest-environment node
/**
 * Testes de integração do REGISTRY no plugin pipeline-orchestrator
 * (FASE 1 — harness verificável).
 *
 * O plugin é instanciado com client fake e directory = tmpdir isolado;
 * o state.json é escrito/lido dentro do tmp (sem tocar no repo real).
 * O gate de qualidade NÃO roda comandos aqui: o tmp não tem package.json,
 * então a guarda de bootstrap pula o gate com warn (comportamento existente).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PipelineOrchestrator, __internals } from "../../.opencode/pipeline/orchestrator-impl"
import {
  createEntry,
  readRegistry,
  writeRegistry,
  type RegistryEntry,
} from "../../.opencode/pipeline/registry"

const STATE_REL = join(".opencode", "pipeline", "state.json")

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "plugin-registry-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** Instancia o plugin com client fake (log/session nunca falham). */
async function makeHooks() {
  const client = {
    app: { log: async () => {} },
    session: { get: async () => ({ agent: undefined }) },
  }
  return PipelineOrchestrator({
    client,
    directory: tmpDir,
  } as never)
}

type Hooks = Awaited<ReturnType<typeof makeHooks>>

/** Chama tool.execute.before simulando uma delegação `task`. */
async function callBefore(
  hooks: Hooks,
  args: { subagent_type: string; description?: string; prompt?: string },
): Promise<void> {
  const hook = hooks["tool.execute.before"]
  if (!hook) throw new Error("hook tool.execute.before ausente")
  await hook({ tool: "task", sessionID: "sess-1", callID: "call-1" }, { args } as never)
}

/** Chama tool.execute.after simulando conclusão (ou não) de uma task. */
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
  return join(tmpDir, STATE_REL)
}

function lerTarefas(): RegistryEntry[] {
  return readRegistry(statePath()).tarefas
}

/** Cria um design doc real no tmp e retorna o caminho relativo (FASE 2). */
function criarDesignDoc(nome = "2026-08-21-tela-login-design.md"): string {
  const dir = join(tmpDir, "docs", "plans")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, nome), "# Design\n", "utf-8")
  return `docs/plans/${nome}`
}

describe("__internals", () => {
  test("deveExportarFuncoesDoRegistry_paraTestes", () => {
    expect(typeof __internals.readRegistry).toBe("function")
    expect(typeof __internals.writeRegistry).toBe("function")
    expect(typeof __internals.createEntry).toBe("function")
    expect(typeof __internals.getActiveEntry).toBe("function")
    expect(typeof __internals.updateEntry).toBe("function")
  })
})

describe("tool.execute.before — task com registry habilitado", () => {
  test("deveBloquearDelegacaoACodeReviewer_quandoNenhumaEntradaAtiva", async () => {
    const hooks = await makeHooks()
    await expect(callBefore(hooks, { subagent_type: "code-reviewer" })).rejects.toThrow(
      /PIPELINE-REGISTRY.*nenhuma tarefa ativa|nenhuma tarefa ativa[\s\S]*PIPELINE-REGISTRY/s,
    )
    // Bloqueio não cria state.json como efeito colateral.
    expect(existsSync(statePath())).toBe(false)
  })

  test("deveBloquearOutrosTargets_semEntradaAtiva_exemploCommit", async () => {
    const hooks = await makeHooks()
    await expect(callBefore(hooks, { subagent_type: "git-committer" })).rejects.toThrow(
      /PIPELINE-REGISTRY/,
    )
  })

  test("deveNaoBloquearCodeReviewer_quandoExisteEntradaAtiva", async () => {
    writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature: "Feature ativa" })] })
    const hooks = await makeHooks()
    await expect(callBefore(hooks, { subagent_type: "code-reviewer" })).resolves.toBeUndefined()
  })

  test("deveCriarEntradaAutomatica_quandoDelegaDevFrontendSemEntrada", async () => {
    const designDoc = criarDesignDoc()
    const hooks = await makeHooks()
    await callBefore(hooks, {
      subagent_type: "dev-frontend",
      description: `Tela de login — design em ${designDoc}`,
    })

    const tarefas = lerTarefas()
    expect(tarefas).toHaveLength(1)
    const unica = tarefas[0] as RegistryEntry
    expect(unica.feature).toBe(`Tela de login — design em ${designDoc}`)
    expect(unica.designDoc).toBe(designDoc)
    const desenvolvimento = unica.fases.find((f) => f.nome === "desenvolvimento")
    expect(desenvolvimento?.status).toBe("em_andamento")
    expect(desenvolvimento?.agente).toBe("dev-frontend")
  })

  test("deveReusarEntradaAtiva_quandoSegundaDelegacaoAoDevFrontend_naoCriaSegunda", async () => {
    const designDoc = criarDesignDoc("2026-08-21-primeira-design.md")
    const hooks = await makeHooks()
    await callBefore(hooks, {
      subagent_type: "dev-frontend",
      description: `Primeira — ${designDoc}`,
    })
    await callBefore(hooks, { subagent_type: "dev-frontend", description: "Segunda" })

    const tarefas = lerTarefas()
    expect(tarefas).toHaveLength(1)
    expect((tarefas[0] as RegistryEntry).feature).toContain("Primeira")
  })

  test("deveExtrairFeatureDaPrimeiraLinhaDoPrompt_quandoDescriptionAusente_truncada80", async () => {
    const designDoc = criarDesignDoc("2026-08-21-menu-design.md")
    const hooks = await makeHooks()
    const linha = "Refatorar o menu lateral para suportar temas escuros e claros com persistência"
    await callBefore(hooks, {
      subagent_type: "dev-frontend",
      prompt: `${linha}\nDetalhes adicionais que nao devem entrar\ndesign doc: ${designDoc}`,
    })

    const unica = lerTarefas()[0] as RegistryEntry
    expect(unica.feature.startsWith(linha.slice(0, 10))).toBe(true)
    expect(unica.feature.length).toBeLessThanOrEqual(80)
    expect(unica.feature).not.toContain("Detalhes adicionais")
    expect(unica.designDoc).toBe(designDoc)
  })
})

describe("tool.execute.after — marcação de fase concluída", () => {
  test("deveMarcarDesenvolvimentoConcluida_quandoDevFrontendTermina", async () => {
    writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature: "Feature X" })] })
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "dev-frontend", completed: true })

    const desenvolvimento = lerTarefas()[0]!!.fases.find((f) => f.nome === "desenvolvimento")
    expect(desenvolvimento?.status).toBe("concluida")
    expect(desenvolvimento?.concluidoEm).not.toBeNull()
  })

  test("deveMarcarRevisaoConcluida_quandoCodeReviewerTermina", async () => {
    writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature: "Feature Y" })] })
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "code-reviewer", completed: true })

    const revisao = lerTarefas()[0]!!.fases.find((f) => f.nome === "revisao")
    expect(revisao?.status).toBe("concluida")
    expect(revisao?.concluidoEm).not.toBeNull()
  })

  test("deveNaoMarcar_quandoTaskNaoCompletou", async () => {
    writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature: "Feature Z" })] })
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "dev-frontend", completed: false })

    const desenvolvimento = lerTarefas()[0]!!.fases.find((f) => f.nome === "desenvolvimento")
    expect(desenvolvimento?.status).toBe("em_andamento")
    expect(desenvolvimento?.concluidoEm).toBeNull()
  })

  test("deveNaoMarcar_quandoAgenteSemFaseMapeada", async () => {
    writeRegistry(statePath(), { versao: 1, tarefas: [createEntry({ feature: "Feature W" })] })
    const hooks = await makeHooks()

    await callAfter(hooks, { subagent_type: "agente-desconhecido", completed: true })

    const fases = lerTarefas()[0]!!.fases
    expect(fases.find((f) => f.nome === "desenvolvimento")?.status).toBe("em_andamento")
  })
})
