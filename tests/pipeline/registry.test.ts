/**
 * Testes unitários do registry do pipeline (FASE 1 — harness verificável).
 * Módulo puro com fs real em diretório temporário (isolado por teste).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Namespace ESM de node:fs é congelado (spyOn não redefine) — mock parcial
// com flag mutável para simular falha de rename (escrita atômica).
const mockState = vi.hoisted(() => ({ renameShouldFail: false }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (mockState.renameShouldFail) throw new Error("rename boom")
      return actual.renameSync(...args)
    },
  }
})

import {
  createEntry,
  getActiveEntry,
  isActive,
  readRegistry,
  updateEntry,
  validateEntry,
  writeRegistry,
  type GateResult,
  type PipelineFase,
  type RegistryEntry,
  type RegistryFile,
} from "../../.opencode/pipeline/registry"

let tmpDir: string
let statePath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "registry-test-"))
  statePath = join(tmpDir, "state.json")
})

afterEach(() => {
  mockState.renameShouldFail = false
})

/** Entrada válida de referência (base para mutações dos testes). */
function validEntry(): RegistryEntry {
  return {
    taskId: "minha-feature-lz1234-ab12cd34",
    feature: "Minha feature",
    fases: [
      {
        nome: "planejamento",
        agente: "orquestrador",
        status: "concluida",
        iniciadoEm: "2026-08-21T10:00:00.000Z",
        concluidoEm: "2026-08-21T10:05:00.000Z",
      },
      {
        nome: "desenvolvimento",
        agente: "dev-frontend",
        status: "em_andamento",
        iniciadoEm: "2026-08-21T10:05:00.000Z",
        concluidoEm: null,
      },
    ],
    gateResults: [],
    retries: 0,
    aprovacaoHumana: null,
  }
}

function validFile(): RegistryFile {
  return { versao: 1, tarefas: [validEntry()] }
}

describe("validateEntry", () => {
  test("deveAceitarEntradaValida_quandoTodosOsCamposCorretos", () => {
    expect(() => validateEntry(validEntry())).not.toThrow()
  })

  test("deveRejeitar_quandoTaskIdVazio", () => {
    const entry = validEntry()
    entry.taskId = ""
    expect(() => validateEntry(entry)).toThrow(/taskId/i)
  })

  test("deveRejeitar_quandoFeatureVazia", () => {
    const entry = validEntry()
    entry.feature = ""
    expect(() => validateEntry(entry)).toThrow(/feature/i)
  })

  test("deveRejeitar_quandoFaseSemNome", () => {
    const entry = validEntry()
    ;(entry.fases[0] as PipelineFase).nome = ""
    expect(() => validateEntry(entry)).toThrow(/nome/i)
  })

  test("deveRejeitar_quandoFaseSemAgente", () => {
    const entry = validEntry()
    ;(entry.fases[0] as PipelineFase).agente = ""
    expect(() => validateEntry(entry)).toThrow(/agente/i)
  })

  test("deveRejeitar_quandoStatusDeFaseInvalido", () => {
    const entry = validEntry()
    ;(entry.fases[0] as PipelineFase).status = "cancelada" as PipelineFase["status"]
    expect(() => validateEntry(entry)).toThrow(/status/i)
  })

  test("deveRejeitar_quandoRetriesNegativo", () => {
    const entry = validEntry()
    entry.retries = -1
    expect(() => validateEntry(entry)).toThrow(/retries/i)
  })

  test("deveRejeitar_quandoEntradaNaoEhObjeto", () => {
    expect(() => validateEntry(null)).toThrow(/objeto/i)
    expect(() => validateEntry("string")).toThrow(/objeto/i)
  })

  test("deveRejeitar_quandoFasesNaoEhArray", () => {
    const entry = validEntry() as unknown as Record<string, unknown>
    entry.fases = "nao-sou-array"
    expect(() => validateEntry(entry)).toThrow(/fases/i)
  })

  test("deveRejeitar_quandoFaseNaoEhObjeto", () => {
    const entry = validEntry()
    ;(entry.fases as unknown[])[0] = null
    expect(() => validateEntry(entry)).toThrow(/fase/i)
  })

  test("deveRejeitar_quandoConcluidoEmNaoEhStringNemNull", () => {
    const entry = validEntry()
    ;(entry.fases[0] as PipelineFase).concluidoEm = 42 as unknown as string
    expect(() => validateEntry(entry)).toThrow(/concluidoEm/i)
  })

  test("deveRejeitar_quandoGateResultsNaoEhArray", () => {
    const entry = validEntry() as unknown as Record<string, unknown>
    entry.gateResults = {}
    expect(() => validateEntry(entry)).toThrow(/gateResults/i)
  })

  test("deveRejeitar_quandoAprovacaoHumanaObjetoInvalido", () => {
    const entry = validEntry() as unknown as Record<string, unknown>
    entry.aprovacaoHumana = { por: "" }
    expect(() => validateEntry(entry)).toThrow(/aprovacaoHumana/i)
  })

  test("deveRejeitar_quandoAprovacaoHumanaTipoInvalido", () => {
    const entry = validEntry() as unknown as Record<string, unknown>
    entry.aprovacaoHumana = "sim"
    expect(() => validateEntry(entry)).toThrow(/aprovacaoHumana/i)
  })
})

describe("writeRegistry → readRegistry (roundtrip)", () => {
  test("devePersistirTudo_quandoEscreveEDepoisLeEmNovoAcesso", () => {
    const file = validFile()
    const entry = file.tarefas[0] as RegistryEntry
    const gate: GateResult = {
      step: "build",
      ok: false,
      exitCode: 2,
      ts: "2026-08-21T11:00:00.000Z",
      detalhe: "error TS2304",
    }
    entry.gateResults = [gate]
    entry.retries = 2
    entry.aprovacaoHumana = { por: "leandro", em: "2026-08-21T12:00:00.000Z" }

    writeRegistry(statePath, file)

    // Lê como um processo separado faria (novo read do disco).
    const raw = JSON.parse(readFileSync(statePath, "utf-8")) as RegistryFile
    expect(raw.versao).toBe(1)
    const loaded = readRegistry(statePath)
    expect(loaded.tarefas).toHaveLength(1)
    const t = loaded.tarefas[0] as RegistryEntry
    expect(t.taskId).toBe(entry.taskId)
    expect(t.feature).toBe(entry.feature)
    expect(t.fases).toEqual(entry.fases)
    expect(t.gateResults).toEqual([gate])
    expect(t.retries).toBe(2)
    expect(t.aprovacaoHumana).toEqual({ por: "leandro", em: "2026-08-21T12:00:00.000Z" })
  })

  test("deveCriarDiretorioPai_quandoStatePathEmSubdiretorioInexistente", () => {
    const deepPath = join(tmpDir, "a", "b", "state.json")
    writeRegistry(deepPath, validFile())
    expect(readRegistry(deepPath).tarefas).toHaveLength(1)
  })

  test("deveRejeitarLeitura_quandoArquivoAusente", () => {
    expect(() => readRegistry(join(tmpDir, "nao-existe.json"))).toThrow(
      /PIPELINE-REGISTRY.*ausente|state\.json/i,
    )
  })
})

describe("writeRegistry atômico", () => {
  test("deveNaoDeixarArquivoTemporario_quandoEscritaBemSucedida", () => {
    writeRegistry(statePath, validFile())
    const files = readdirSync(tmpDir)
    expect(files).toContain("state.json")
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([])
  })

  test("deveManterArquivoOriginalIntato_quandoRenameFalha", () => {
    const original = validFile()
    writeRegistry(statePath, original)

    mockState.renameShouldFail = true

    const modificado = validFile()
    ;(modificado.tarefas[0] as RegistryEntry).feature = "ALTERADA"
    expect(() => writeRegistry(statePath, modificado)).toThrow(/rename boom/)

    // Original intacto no disco.
    const depois = readRegistry(statePath)
    expect((depois.tarefas[0] as RegistryEntry).feature).toBe("Minha feature")

    // Temp limpo mesmo após falha.
    expect(readdirSync(tmpDir).filter((f) => f.includes(".tmp-"))).toEqual([])
  })
})

describe("getActiveEntry / isActive", () => {
  test("deveRetornarUnicaEntradaAtiva_quandoExisteUma", () => {
    const file = validFile()
    expect(getActiveEntry(file)?.taskId).toBe((file.tarefas[0] as RegistryEntry).taskId)
  })

  test("deveRetornarNull_quandoZeroAtivas", () => {
    const file = validFile()
    const entry = file.tarefas[0] as RegistryEntry
    entry.fases.push({
      nome: "commit",
      agente: "code-reviewer",
      status: "concluida",
      iniciadoEm: "2026-08-21T13:00:00.000Z",
      concluidoEm: "2026-08-21T13:30:00.000Z",
    })
    expect(getActiveEntry(file)).toBeNull()
  })

  test("deveLancarErro_quandoDuasAtivas_invarianteDeEntradaUnica", () => {
    const file = validFile()
    file.tarefas.push(createEntry({ feature: "Segunda" }))
    expect(() => getActiveEntry(file)).toThrow(/uma.*ativa|invariante/i)
  })

  test("deveConsiderarAtiva_quandoDesenvolvimentoEmAndamento", () => {
    expect(isActive(validEntry())).toBe(true)
  })

  test("deveConsiderarInativa_quandoCommitConcluido", () => {
    const entry = validEntry()
    entry.fases.push({
      nome: "commit",
      agente: "code-reviewer",
      status: "concluida",
      iniciadoEm: "2026-08-21T13:00:00.000Z",
      concluidoEm: "2026-08-21T13:30:00.000Z",
    })
    expect(isActive(entry)).toBe(false)
  })

  test("deveConsiderarInativa_quandoEscalaHumano_emQualquerFase", () => {
    const entry = validEntry()
    ;(entry.fases[1] as PipelineFase).status = "escala_humano"
    expect(isActive(entry)).toBe(false)
  })

  test("deveConsiderarAtiva_quandoCommitExisteMasNaoConcluido", () => {
    const entry = validEntry()
    entry.fases.push({
      nome: "commit",
      agente: "code-reviewer",
      status: "em_andamento",
      iniciadoEm: "2026-08-21T13:00:00.000Z",
      concluidoEm: null,
    })
    expect(isActive(entry)).toBe(true)
  })

  test("deveConsiderarAtiva_quandoOutraFaseConcluida_queNaoCommit", () => {
    const entry = validEntry()
    entry.fases.push({
      nome: "revisao",
      agente: "code-reviewer",
      status: "concluida",
      iniciadoEm: "2026-08-21T13:00:00.000Z",
      concluidoEm: "2026-08-21T13:10:00.000Z",
    })
    expect(isActive(entry)).toBe(true) // só commit concluído é final
  })
})

describe("createEntry", () => {
  test("deveGerarTaskIdSlugTimestamp_unicoEntreChamadas", () => {
    const a = createEntry({ feature: "Cadastro de Usuário" })
    const b = createEntry({ feature: "Cadastro de Usuário" })
    expect(a.taskId).toMatch(/^cadastro-de-usuario-/)
    expect(b.taskId).toMatch(/^cadastro-de-usuario-/)
    expect(a.taskId).not.toBe(b.taskId)
  })

  test("deveCriarFasesIniciais_planejamentoConcluidaEDesenvolvimentoEmAndamento", () => {
    const entry = createEntry({ feature: "Feature X" })
    expect(entry.fases).toHaveLength(2)
    const [planejamento, desenvolvimento] = entry.fases as [PipelineFase, PipelineFase]
    expect(planejamento.nome).toBe("planejamento")
    expect(planejamento.status).toBe("concluida")
    expect(planejamento.concluidoEm).not.toBeNull()
    expect(desenvolvimento.nome).toBe("desenvolvimento")
    expect(desenvolvimento.agente).toBe("dev-frontend")
    expect(desenvolvimento.status).toBe("em_andamento")
    expect(desenvolvimento.concluidoEm).toBeNull()
  })

  test("deveInicializarCamposControle_gateResultsVazioRetriesZeroAprovacaoNull", () => {
    const entry = createEntry({ feature: "Feature Y" })
    expect(entry.gateResults).toEqual([])
    expect(entry.retries).toBe(0)
    expect(entry.aprovacaoHumana).toBeNull()
    expect(entry.feature).toBe("Feature Y")
  })

  test("deveSanitizarFeatureVaziaOuInvalida_paraSlugPadrao", () => {
    const entry = createEntry({ feature: "   !!!   " })
    expect(entry.feature).toBe("   !!!   ") // feature original preservada
    expect(entry.taskId.startsWith("tarefa-")).toBe(true) // slug padrão
  })
})

describe("updateEntry", () => {
  test("deveAplicarPatch_semMutarOriginal_ePersistir_viaWriteRead", () => {
    const file = validFile()
    const taskId = (file.tarefas[0] as RegistryEntry).taskId

    const atualizado = updateEntry(file, taskId, {
      retries: 1,
      aprovacaoHumana: { por: "leandro", em: "2026-08-21T14:00:00.000Z" },
    })

    // Imutável: original não mudou; novo reflete o patch.
    expect((file.tarefas[0] as RegistryEntry).retries).toBe(0)
    expect((atualizado.tarefas[0] as RegistryEntry).retries).toBe(1)
    expect((atualizado.tarefas[0] as RegistryEntry).aprovacaoHumana?.por).toBe("leandro")

    writeRegistry(statePath, atualizado)
    const relido = readRegistry(statePath)
    expect((relido.tarefas[0] as RegistryEntry).retries).toBe(1)
  })

  test("deveLancarErro_quandoTaskIdInexistente", () => {
    expect(() => updateEntry(validFile(), "task-fantasma", { retries: 3 })).toThrow(
      /task-fantasma/,
    )
  })
})

describe("integridade do arquivo", () => {
  test("deveRejeitar_quandoVersaoDesconhecida", () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(statePath, JSON.stringify({ versao: 99, tarefas: [] }), "utf-8")
    expect(() => readRegistry(statePath)).toThrow(/vers[aã]o/i)
  })

  test("deveRejeitar_quandoJsonInvalido", () => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(statePath, "{isso nao e json", "utf-8")
    expect(() => readRegistry(statePath)).toThrow()
  })

  test("deveRejeitarEscrita_quandoEntradaInvalida_noRegistry", () => {
    const file = validFile()
    ;(file.tarefas[0] as RegistryEntry).retries = -5
    expect(() => writeRegistry(statePath, file)).toThrow(/retries/i)
    expect(existsSync(statePath)).toBe(false)
  })
})
