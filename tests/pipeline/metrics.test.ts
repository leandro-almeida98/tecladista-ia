/**
 * Testes unitários da telemetria JSONL (FASE 5 — harness verificável).
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearMetrics, readMetrics, recordMetric, type MetricEvent } from "../../.opencode/pipeline/metrics"
import {
  accumulateTokens,
  getAllSessionTokens,
  getSessionTokens,
  resetAllSessionTokens,
  resetSessionTokens,
} from "../../.opencode/pipeline/metrics"

let tmpDir: string
let metricsPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "metrics-test-"))
  metricsPath = join(tmpDir, ".opencode", "pipeline", "metrics.jsonl")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function evento(taskId: string, evento: MetricEvent["evento"] = "gate_run", detalhe?: unknown): MetricEvent {
  return { ts: new Date().toISOString(), evento, taskId, ...(detalhe !== undefined ? { detalhe } : {}) }
}

describe("recordMetric + readMetrics (roundtrip)", () => {
  test("deveAppendEConsistirNoDisco_quandoChamadoMultiplesVezes", () => {
    recordMetric(metricsPath, evento("t1", "gate_run", { gate: "build" }))
    recordMetric(metricsPath, evento("t1", "gate_fail", { motivo: "fail" }))
    const raw = readFileSync(metricsPath, "utf-8").trim().split("\n")
    expect(raw).toHaveLength(2)
    const parsed = raw.map((l) => JSON.parse(l) as MetricEvent)
    expect(parsed[0]?.evento).toBe("gate_run")
    expect(parsed[1]?.evento).toBe("gate_fail")
  })

  test("deveCriarDiretorioPai_quandoMetricsPathEmSubdirInexistente", () => {
    const deep = join(tmpDir, "a", "b", "c", "metrics.jsonl")
    recordMetric(deep, evento("t-deep", "retry"))
    expect(existsSync(deep)).toBe(true)
    expect(readMetrics(deep)).toHaveLength(1)
  })

  test("deveLerTodosOsTiposDeEvento_eManterDetalhe", () => {
    const eventos: MetricEvent[] = [
      evento("task-a", "gate_run"),
      evento("task-a", "gate_fail", { x: 1 }),
      evento("task-a", "retry", { modo: "auto" }),
      evento("task-a", "transicao", { fase: "desenvolvimento", duracao: 123 }),
      evento("task-a", "commit", { command: "git commit" }),
      evento("task-a", "escala_humano", { motivo: "esgotou" }),
    ]
    for (const e of eventos) recordMetric(metricsPath, e)
    const lidos = readMetrics(metricsPath)
    expect(lidos).toHaveLength(6)
    expect(lidos.map((e) => e.evento)).toEqual([
      "gate_run",
      "gate_fail",
      "retry",
      "transicao",
      "commit",
      "escala_humano",
    ])
    expect(lidos[3]?.detalhe).toEqual({ fase: "desenvolvimento", duracao: 123 })
  })

  test("deveRetornarVazio_quandoArquivoAusente", () => {
    expect(readMetrics(join(tmpDir, "nao-existe.jsonl"))).toEqual([])
  })

  test("deveTolerarLinhasVaziasEcorrompidas_eIgnorarShapeInvalido", () => {
    recordMetric(metricsPath, evento("t1", "gate_run"))
    // linhas corrompidas e shape inválido inseridas manualmente
    writeFileSync(metricsPath, readFileSync(metricsPath, "utf-8") + "\n\n   \n{isso nao e json\n", "utf-8")
    writeFileSync(metricsPath, readFileSync(metricsPath, "utf-8") + JSON.stringify({ foo: "bar" }) + "\n", "utf-8")
    writeFileSync(metricsPath, readFileSync(metricsPath, "utf-8") + JSON.stringify({ evento: "gate_run" }) + "\n", "utf-8")
    writeFileSync(metricsPath, readFileSync(metricsPath, "utf-8") + JSON.stringify({ evento: "gate_run", taskId: "t2", ts: "2026-08-22T00:00:00.000Z" }) + "\n", "utf-8")
    const lidos = readMetrics(metricsPath)
    // original + último válido (t2) => 2
    expect(lidos).toHaveLength(2)
    expect(lidos[1]?.taskId).toBe("t2")
  })

  test("deveLerArquivoComSomenteLinhasInvalidas_comoVazioSemThrow", () => {
    mkdirSync(join(tmpDir, ".opencode", "pipeline"), { recursive: true })
    writeFileSync(metricsPath, "   \n\ncorrupted line\n{bad json\n", "utf-8")
    expect(readMetrics(metricsPath)).toEqual([])
  })

  test("deveNuncaThrow_quandoRecordMetricRecebePathProblematico", () => {
    // path vazio cai no default (relativo) — não deve throw, mesmo que não crie arquivo útil.
    // REGRESSÃO smoke 2026-08-24: sem chdir, o default resolve para o
    // metrics.jsonl REAL do repo (CWD do vitest) e o teste ESCREVIA nele.
    const cwdOriginal = process.cwd()
    process.chdir(tmpDir)
    try {
      expect(() => recordMetric("" as unknown as string, evento("t1"))).not.toThrow()
      // clear também nunca throw
      expect(() => clearMetrics("/caminho/que/nao/existe/metrics.jsonl")).not.toThrow()
      expect(() => readMetrics("/caminho/que/nao/existe/metrics.jsonl")).not.toThrow()
    } finally {
      process.chdir(cwdOriginal)
    }
  })
})

describe("clearMetrics", () => {
  test("deveRemoverArquivo_quandoExiste", () => {
    recordMetric(metricsPath, evento("t1", "gate_run"))
    expect(existsSync(metricsPath)).toBe(true)
    clearMetrics(metricsPath)
    expect(existsSync(metricsPath)).toBe(false)
    expect(readMetrics(metricsPath)).toEqual([])
  })

  test("deveSerIdempotente_quandoArquivoJaAusente", () => {
    expect(() => clearMetrics(metricsPath)).not.toThrow()
    expect(() => clearMetrics(metricsPath)).not.toThrow()
  })

  test("devePermitirReusoAposClear", () => {
    recordMetric(metricsPath, evento("t1", "gate_run"))
    clearMetrics(metricsPath)
    recordMetric(metricsPath, evento("t2", "commit"))
    const lidos = readMetrics(metricsPath)
    expect(lidos).toHaveLength(1)
    expect(lidos[0]?.taskId).toBe("t2")
  })
})

// ---------------------------------------------------------------------------
// FIX 1 — acumulador de tokens por sessão
// ---------------------------------------------------------------------------
describe("acumulador de tokens por sessão (FIX 1)", () => {
  beforeEach(() => {
    resetAllSessionTokens()
  })

  test("deveAcumularTokensPorSessao_somandoChamadas", () => {
    accumulateTokens("s1", { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } }, 0.01)
    accumulateTokens("s1", { input: 200, output: 25 }, 0.02)
    const t = getSessionTokens("s1")
    expect(t.input).toBe(300)
    expect(t.output).toBe(75)
    expect(t.reasoning).toBe(10)
    expect(t.cacheRead).toBe(5)
    expect(t.cacheWrite).toBe(2)
    expect(t.cost).toBeCloseTo(0.03)
  })

  test("deveIsolarSessoesDiferentes", () => {
    accumulateTokens("s1", { input: 10 }, 0.5)
    accumulateTokens("s2", { input: 99 }, 0.9)
    expect(getSessionTokens("s1").input).toBe(10)
    expect(getSessionTokens("s2").input).toBe(99)
    expect(getSessionTokens("s3").input).toBe(0)
  })

  test("deveRetornarZeros_quandoSessaoNuncaAcumulou", () => {
    expect(getSessionTokens("nao-existe")).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    })
  })

  test("deveIgnorarValoresNaoNumericos_eNegativos", () => {
    accumulateTokens("s1", { input: -5, output: "x" as unknown as number, reasoning: 3 }, -1)
    const t = getSessionTokens("s1")
    expect(t.input).toBe(0)
    expect(t.output).toBe(0)
    expect(t.reasoning).toBe(3)
    expect(t.cost).toBe(0)
  })

  test("deveResetarUmaSessao_semAfetarOutras", () => {
    accumulateTokens("s1", { input: 10 })
    accumulateTokens("s2", { input: 20 })
    resetSessionTokens("s1")
    expect(getSessionTokens("s1").input).toBe(0)
    expect(getSessionTokens("s2").input).toBe(20)
  })

  test("deveResetarTodasAsSessoes", () => {
    accumulateTokens("s1", { input: 10 })
    accumulateTokens("s2", { input: 20 })
    resetAllSessionTokens()
    expect(getSessionTokens("s1").input).toBe(0)
    expect(getSessionTokens("s2").input).toBe(0)
  })

  test("deveListarTodasAsSessoesAcumuladas", () => {
    accumulateTokens("s1", { input: 10 })
    accumulateTokens("s2", { input: 20 })
    const all = getAllSessionTokens()
    expect(all["s1"]?.input).toBe(10)
    expect(all["s2"]?.input).toBe(20)
    expect(Object.keys(all).sort()).toEqual(["s1", "s2"])
  })

  test("deveIgnorarSessionIDVazio", () => {
    accumulateTokens("", { input: 10 })
    expect(getAllSessionTokens()).toEqual({})
  })
})

describe("default path (relativo)", () => {
  test("deveUsarDefault_quandoMetricsPathNaoInformado_ouVazio", () => {
    // REGRESSÃO REAL (smoke 2026-08-24): o default é RELATIVO ao CWD do
    // vitest (.opencode/pipeline/metrics.jsonl). Sem chdir, clearMetrics()/
    // recordMetric() apagavam/escreviam no metrics.jsonl REAL do repo quando
    // o quality gate rodava `npm test`/`npm run test:coverage` — os eventos
    // gate_run/transicao gravados pelo plugin antes do step de teste sumiam.
    // Fix: chdir para tmpdir => o default resolve DENTRO do tmpdir e o
    // metrics.jsonl do repo nunca é tocado.
    const cwdOriginal = process.cwd()
    process.chdir(tmpDir)
    try {
      // funções com default param não devem throw quando chamadas sem arg
      expect(() => readMetrics()).not.toThrow()
      expect(() => clearMetrics()).not.toThrow()
      // record com default não deve throw; grava no tmpdir (contido)
      expect(() => recordMetric(undefined as unknown as string, evento("t-default"))).not.toThrow()
      // default resolve para <tmpDir>/.opencode/pipeline/metrics.jsonl
      const defaultPath = join(tmpDir, ".opencode", "pipeline", "metrics.jsonl")
      expect(existsSync(defaultPath)).toBe(true)
      const lidos = readMetrics(defaultPath)
      expect(lidos).toHaveLength(1)
      expect(lidos[0]?.taskId).toBe("t-default")
      // limpa o default criado (dentro do tmpdir)
      clearMetrics()
      expect(existsSync(defaultPath)).toBe(false)
    } finally {
      process.chdir(cwdOriginal)
    }
  })
})
