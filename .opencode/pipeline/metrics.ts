/**
 * ============================================================================
 * metrics.ts — Telemetria JSONL do pipeline (FASE 5, harness verificável)
 * ============================================================================
 * Métricas append-only em `.opencode/pipeline/metrics.jsonl` (JSONL):
 * uma linha por evento, tolerante a linhas vazias/corrompidas na leitura.
 *
 * MÓDULO PURO: sem dependência do SDK do opencode; usa fs real (síncrono).
 * Nunca lança: recordMetric/readMetrics/clearMetrics engolem erros de IO.
 * ============================================================================
 */

import * as fs from "node:fs"
import { dirname } from "node:path"

export type MetricEvento =
  | "gate_run"
  | "gate_fail"
  | "retry"
  | "transicao"
  | "commit"
  | "escala_humano"
  | "tokens"

export interface MetricEvent {
  ts: string
  evento: MetricEvento
  taskId: string
  detalhe?: unknown
}

/**
 * Contadores de tokens acumulados por sessão (FIX 1 — TOKENS/CUSTO).
 * `cacheRead`/`cacheWrite` vêm do `cache: { read, write }` do SDK; `cost` é o
 * custo monetário acumulado (USD). Todos os campos numéricos >= 0.
 */
export interface TokenCounts {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

/** Entrada de acumulação: shape do SDK (cache aninhado {read, write}). */
export interface TokenAccumulateInput {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

const DEFAULT_METRICS_PATH = ".opencode/pipeline/metrics.jsonl"

// ============================================================================
// ACUMULADOR DE TOKENS POR SESSÃO (FIX 1 — em memória, por instância do módulo)
// ============================================================================

const sessionTokens = new Map<string, TokenCounts>()

function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}

/**
 * Acumula tokens de uma sessão. `tokens` segue o shape do SDK
 * ({input, output, reasoning, cache:{read,write}}); `cost` é passado à parte
 * (info.cost do SDK). Nunca lança; valores não-numéricos são ignorados.
 */
export function accumulateTokens(
  sessionID: string,
  tokens: TokenAccumulateInput,
  cost?: number,
): void {
  if (typeof sessionID !== "string" || sessionID === "") return
  const current = sessionTokens.get(sessionID) ?? emptyTokens()
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0
  sessionTokens.set(sessionID, {
    input: current.input + num(tokens?.input),
    output: current.output + num(tokens?.output),
    reasoning: current.reasoning + num(tokens?.reasoning),
    cacheRead: current.cacheRead + num(tokens?.cache?.read),
    cacheWrite: current.cacheWrite + num(tokens?.cache?.write),
    cost: current.cost + num(cost),
  })
}

/** Retorna os tokens acumulados de uma sessão (zeros se nunca acumulou). */
export function getSessionTokens(sessionID: string): TokenCounts {
  return sessionTokens.get(sessionID) ?? emptyTokens()
}

/** Zera o acumulador de UMA sessão. */
export function resetSessionTokens(sessionID: string): void {
  sessionTokens.delete(sessionID)
}

/** Snapshot de todos os acumuladores (chave = sessionID). */
export function getAllSessionTokens(): Record<string, TokenCounts> {
  return Object.fromEntries(sessionTokens)
}

/** Zera TODOS os acumuladores (usado na fronteira de tarefa). */
export function resetAllSessionTokens(): void {
  sessionTokens.clear()
}

/**
 * Append de um evento no JSONL.
 * Cria o diretório pai se preciso. Nunca lança (IO failures são engolidos).
 */
export function recordMetric(
  metricsPath: string = DEFAULT_METRICS_PATH,
  event: MetricEvent,
): void {
  try {
    const path = metricsPath || DEFAULT_METRICS_PATH
    const dir = dirname(path)
    if (dir !== "." && dir !== "") {
      fs.mkdirSync(dir, { recursive: true })
    }
    const line = `${JSON.stringify(event)}\n`
    fs.appendFileSync(path, line, "utf-8")
  } catch {
    // nunca quebrar o fluxo principal
  }
}

/**
 * Lê todos os eventos do JSONL, tolerando linhas vazias/corrompidas.
 * Arquivo ausente => [].
 * Nunca lança.
 */
export function readMetrics(
  metricsPath: string = DEFAULT_METRICS_PATH,
): MetricEvent[] {
  try {
    const path = metricsPath || DEFAULT_METRICS_PATH
    if (!fs.existsSync(path)) return []
    const raw = fs.readFileSync(path, "utf-8")
    const lines = raw.split(/\r?\n/)
    const out: MetricEvent[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === "") continue
      try {
        const parsed = JSON.parse(trimmed) as MetricEvent
        // validação mínima: deve ter evento e taskId string
        if (
          parsed != null &&
          typeof parsed === "object" &&
          typeof (parsed as unknown as Record<string, unknown>).evento === "string" &&
          typeof (parsed as unknown as Record<string, unknown>).taskId === "string" &&
          typeof (parsed as unknown as Record<string, unknown>).ts === "string"
        ) {
          out.push(parsed)
        } else {
          // tolerante: linhas com JSON válido mas shape inválido são ignoradas
          // para não poluir o relatório — mas não lançam
        }
      } catch {
        // linha corrompida: ignora
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Limpa o JSONL (usado em testes).
 * Remove o arquivo se existir; se não, faz nada. Nunca lança.
 */
export function clearMetrics(
  metricsPath: string = DEFAULT_METRICS_PATH,
): void {
  try {
    const path = metricsPath || DEFAULT_METRICS_PATH
    if (fs.existsSync(path)) {
      fs.unlinkSync(path)
    }
  } catch {
    // best-effort
  }
}
