// @vitest-environment node
/**
 * Testes unitários da auditoria VERSIONADA do pipeline (pós-FASE 5):
 * `docs/pipeline-audit/history.jsonl` é versionado no git (diferente dos
 * runtime artifacts state.json/metrics.jsonl, que são gitignored).
 *
 * Contrato (design "Auditoria versionada"):
 *   - appendAudit(auditPath, entry): append JSONL (1 linha por entrada),
 *     cria dir recursive, NUNCA throw; dedupe simples — se a ÚLTIMA linha
 *     tem mesmo taskId+resultado, skip (idempotência p/ re-commit).
 *   - readAudit(auditPath): tolerante (linhas vazias/corrompidas ignoradas).
 *   - montarAuditEntry: monta AuditEntry a partir da RegistryEntry.
 *
 * TODOS os paths ficam em tmpdir — nenhum teste toca docs/pipeline-audit/
 * do repo (o default path é verificado via constante, sem criar arquivo).
 */
import { describe, expect, test } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_AUDIT_PATH,
  appendAudit,
  montarAuditEntry,
  readAudit,
  type AuditEntry,
} from "../../.opencode/pipeline/audit"
import { createEntry } from "../../.opencode/pipeline/registry"

let tmpDir: string

function auditPath(): string {
  return join(tmpDir, "docs", "pipeline-audit", "history.jsonl")
}

function entradaCompleta(
  taskId = "task-audit-1",
  resultado: AuditEntry["resultado"] = "concluida",
): AuditEntry {
  const entry = createEntry({
    feature: "Auditoria versionada",
    designDoc: "docs/plans/2026-08-21-harness-verificavel-design.md",
  })
  return {
    ts: "2026-08-23T12:00:00.000Z",
    taskId,
    feature: entry.feature,
    designDoc: entry.designDoc,
    resultado,
    fases: entry.fases,
    gateResults: [
      { step: "build", ok: true, exitCode: 0, ts: "2026-08-23T11:00:00.000Z", detalhe: null },
    ],
    retryHistory: [],
    aprovacaoHumana:
      resultado === "concluida" ? { por: "usuario", em: "2026-08-23T11:30:00.000Z" } : null,
  }
}

function lerLinhasBrutas(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
}

describe("appendAudit + readAudit (roundtrip)", () => {
  test("deveCriarDiretorioArquivoEPersistirEntradaCompleta_quandoAppendEmPathProfundo", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      expect(existsSync(auditPath())).toBe(false)
      const entrada = entradaCompleta()
      appendAudit(auditPath(), entrada)

      expect(existsSync(auditPath())).toBe(true)
      // 1 linha por entrada
      expect(lerLinhasBrutas(auditPath())).toHaveLength(1)

      const lidos = readAudit(auditPath())
      expect(lidos).toHaveLength(1)
      expect(lidos[0]).toEqual(entrada)
      // campos-chave preservados no roundtrip
      expect(lidos[0]?.taskId).toBe("task-audit-1")
      expect(lidos[0]?.resultado).toBe("concluida")
      expect(lidos[0]?.feature).toBe("Auditoria versionada")
      expect(lidos[0]?.designDoc).toBe("docs/plans/2026-08-21-harness-verificavel-design.md")
      expect(lidos[0]?.fases).toHaveLength(2)
      expect(lidos[0]?.gateResults).toHaveLength(1)
      expect(lidos[0]?.aprovacaoHumana).toEqual({ por: "usuario", em: "2026-08-23T11:30:00.000Z" })
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("deveAppendarMultiplasEntradas_preservandoOrdem_quandoTaskIdsDiferentes", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      appendAudit(auditPath(), entradaCompleta("task-1"))
      appendAudit(auditPath(), entradaCompleta("task-2", "escalada"))
      const lidos = readAudit(auditPath())
      expect(lidos.map((e) => e.taskId)).toEqual(["task-1", "task-2"])
      expect(lidos.map((e) => e.resultado)).toEqual(["concluida", "escalada"])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("appendAudit — dedupe simples (idempotência p/ re-commit)", () => {
  test("devePularAppend_quandoUltimaLinhaTemMesmoTaskIdEResultado", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      const entrada = entradaCompleta("task-dup", "concluida")
      appendAudit(auditPath(), entrada)
      // re-commit simulado: mesma entrada (ts novo) => skip
      appendAudit(auditPath(), { ...entrada, ts: "2026-08-23T13:00:00.000Z" })
      expect(lerLinhasBrutas(auditPath())).toHaveLength(1)
      expect(readAudit(auditPath())[0]?.ts).toBe("2026-08-23T12:00:00.000Z")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("deveAppendar_quandoMesmoTaskIdMasResultadoDiferente", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      appendAudit(auditPath(), entradaCompleta("task-x", "escalada"))
      appendAudit(auditPath(), entradaCompleta("task-x", "concluida"))
      expect(lerLinhasBrutas(auditPath())).toHaveLength(2)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("deveAppendar_quandoUltimaLinhaCorrompida_dedupeNaoBloqueia", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      mkdirSync(join(tmpDir, "docs", "pipeline-audit"), { recursive: true })
      writeFileSync(auditPath(), "{linha corrompida\n", "utf-8")
      appendAudit(auditPath(), entradaCompleta("task-ok"))
      expect(lerLinhasBrutas(auditPath())).toHaveLength(2)
      expect(readAudit(auditPath())).toHaveLength(1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("readAudit — tolerância", () => {
  test("deveIgnorarLinhasVaziasCorrompidasEShapeInvalido_quandoLe", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      mkdirSync(join(tmpDir, "docs", "pipeline-audit"), { recursive: true })
      const valida = JSON.stringify(entradaCompleta("task-valido"))
      const sujeira = [
        "",
        "   ",
        "{isso nao e json",
        JSON.stringify({ foo: "bar" }),
        JSON.stringify({ taskId: "sem-ts", feature: "f", resultado: "concluida", fases: [] }),
        JSON.stringify({ ts: "x", taskId: "sem-feature", resultado: "concluida", fases: [] }),
        JSON.stringify({ ts: "x", taskId: "t", feature: "f", resultado: "outro", fases: [] }),
        JSON.stringify({ ts: "x", taskId: "t", feature: "f", resultado: "concluida" }),
      ]
      writeFileSync(auditPath(), [valida, ...sujeira].join("\n") + "\n", "utf-8")
      const lidos = readAudit(auditPath())
      expect(lidos).toHaveLength(1)
      expect(lidos[0]?.taskId).toBe("task-valido")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("deveRetornarVazio_quandoArquivoAusente_semThrow", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      expect(readAudit(join(tmpDir, "nao-existe", "history.jsonl"))).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("deveLerArquivoSomenteComLinhasInvalidas_comoVazioSemThrow", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      mkdirSync(join(tmpDir, "docs", "pipeline-audit"), { recursive: true })
      writeFileSync(auditPath(), "\n\nlixo\n{bad\n", "utf-8")
      expect(readAudit(auditPath())).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("appendAudit — nunca throw", () => {
  test("deveEngolirErroIO_quandoPathProblematico_semPoluirRepo", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"))
    try {
      // Arquivo ocupando o lugar do diretório pai: mkdirSync/append falham.
      const bloqueio = join(tmpDir, "bloqueio")
      writeFileSync(bloqueio, "arquivo, nao diretorio", "utf-8")
      const pathBloqueado = join(bloqueio, "sub", "history.jsonl")
      expect(() => appendAudit(pathBloqueado, entradaCompleta("task-bloqueado"))).not.toThrow()
      expect(readAudit(pathBloqueado)).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe("default path e constantes", () => {
  test("deveUsarDocsPipelineAuditHistoryJsonl_comoDefaultPathVersionado", () => {
    // Default RELATIVO à raiz passada; é VERSIONADO no git (nunca gitignored).
    expect(DEFAULT_AUDIT_PATH).toBe("docs/pipeline-audit/history.jsonl")
  })
})

describe("montarAuditEntry", () => {
  test("deveMapearTodosOsCamposDaRegistryEntry_quandoConcluida", () => {
    const entry = createEntry({
      feature: "Feature completa",
      designDoc: "docs/plans/2026-08-21-x-design.md",
    })
    const agora = new Date("2026-08-23T10:00:00.000Z")
    const audit = montarAuditEntry(entry, "concluida", agora)
    expect(audit.ts).toBe("2026-08-23T10:00:00.000Z")
    expect(audit.taskId).toBe(entry.taskId)
    expect(audit.feature).toBe("Feature completa")
    expect(audit.designDoc).toBe("docs/plans/2026-08-21-x-design.md")
    expect(audit.resultado).toBe("concluida")
    expect(audit.fases).toEqual(entry.fases)
    expect(audit.gateResults).toEqual([])
    expect(audit.retryHistory).toEqual([])
    expect(audit.aprovacaoHumana).toBeNull()
  })

  test("devePreservarHistoricoEAprovacao_eDefaultDeCamposAusentes_quandoEscalada", () => {
    const base = createEntry({ feature: "Feature escalada" })
    // Entrada legada: campos opcionais ausentes (undefined) => defaults seguros.
    const legada = {
      ...base,
      retryHistory: undefined,
      aprovacaoHumana: undefined,
      designDoc: undefined,
    } as unknown as typeof base
    const audit = montarAuditEntry(legada, "escalada")
    expect(audit.resultado).toBe("escalada")
    expect(audit.retryHistory).toEqual([])
    expect(audit.aprovacaoHumana).toBeNull()
    expect(audit.designDoc).toBeNull()
  })
})
