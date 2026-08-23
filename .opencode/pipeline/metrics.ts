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

export interface MetricEvent {
  ts: string
  evento: MetricEvento
  taskId: string
  detalhe?: unknown
}

const DEFAULT_METRICS_PATH = ".opencode/pipeline/metrics.jsonl"

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
