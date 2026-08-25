/**
 * ============================================================================
 * audit.ts — Auditoria VERSIONADA do pipeline (pós-FASE 5, harness verificável)
 * ============================================================================
 * Histórico de resultados em `docs/pipeline-audit/history.jsonl` (JSONL):
 * UMA linha por entrada finalizada. Diferente dos runtime artifacts
 * (state.json / metrics.jsonl, gitignored), este arquivo É VERSIONADO NO GIT:
 * os detalhes operacionais da execução sobrevivem ao histórico de commits.
 *
 * MÓDULO PURO: sem dependência do SDK do opencode; usa fs real (síncrono).
 * Nunca lança: appendAudit/readAudit engolem erros de IO.
 *
 * Dedupe simples (idempotência p/ re-commit): se a ÚLTIMA linha do arquivo já
 * tem o mesmo taskId+resultado, o append é pulado. Entradas distintas (outro
 * taskId ou outro resultado) appendam normalmente.
 * ============================================================================
 */

import * as fs from "node:fs"
import { dirname } from "node:path"
import type {
  AprovacaoHumana,
  GateResult,
  PipelineFase,
  RegistryEntry,
  RetryHistoryItem,
} from "./registry.ts"
import type { TokenCounts } from "./metrics.ts"

/** Caminho default RELATIVO à raiz do projeto. VERSIONADO no git. */
export const DEFAULT_AUDIT_PATH = "docs/pipeline-audit/history.jsonl"

export type AuditResultado = "concluida" | "escalada"

/**
 * Uma entrada de auditoria: snapshot imutável do resultado final de uma
 * tarefa do pipeline (concluída via commit ou escalada para humano).
 */
export interface AuditEntry {
  ts: string
  taskId: string
  feature: string
  /** Design doc aprovado que originou a tarefa; null quando ausente. */
  designDoc: string | null
  resultado: AuditResultado
  fases: PipelineFase[]
  gateResults: GateResult[]
  retryHistory: RetryHistoryItem[]
  aprovacaoHumana: AprovacaoHumana | null
  /** Tokens/custo acumulados da sessão no flush (FIX 1); ausente em legado. */
  tokens?: TokenCounts
}

/**
 * Monta um AuditEntry a partir da RegistryEntry (snapshot raso dos arrays —
 * a entrada não é mutada depois pelo plugin). Campos ausentes em entradas
 * legadas (undefined) viram defaults seguros ([] / null).
 * `now` injetável para testes determinísticos; `tokens` opcional (FIX 1).
 */
export function montarAuditEntry(
  entry: Pick<RegistryEntry, "taskId" | "feature" | "designDoc" | "fases" | "gateResults" | "retryHistory" | "aprovacaoHumana">,
  resultado: AuditResultado,
  now: Date = new Date(),
  tokens?: TokenCounts,
): AuditEntry {
  return {
    ts: now.toISOString(),
    taskId: entry.taskId,
    feature: entry.feature,
    designDoc: entry.designDoc ?? null,
    resultado,
    fases: entry.fases ?? [],
    gateResults: entry.gateResults ?? [],
    retryHistory: entry.retryHistory ?? [],
    aprovacaoHumana: entry.aprovacaoHumana ?? null,
    ...(tokens !== undefined ? { tokens } : {}),
  }
}

/**
 * Validação mínima de shape para leitura tolerante: exige os campos-chave
 * com tipos corretos (ts/taskId/feature strings, resultado no enum, fases
 * array). Linhas fora do shape são ignoradas por readAudit.
 */
function ehAuditEntryValido(parsed: unknown): parsed is AuditEntry {
  if (parsed == null || typeof parsed !== "object") return false
  const e = parsed as Record<string, unknown>
  return (
    typeof e["ts"] === "string" &&
    typeof e["taskId"] === "string" &&
    typeof e["feature"] === "string" &&
    (e["resultado"] === "concluida" || e["resultado"] === "escalada") &&
    Array.isArray(e["fases"])
  )
}

/**
 * Append de uma entrada no JSONL de auditoria (1 linha por entrada).
 * Cria o diretório pai se preciso. NUNCA lança (IO failures engolidos).
 *
 * Dedupe simples: se a ÚLTIMA linha do arquivo tem mesmo taskId+resultado,
 * skip (idempotência básica p/ re-commit). Última linha corrompida não
 * bloqueia o append.
 */
export function appendAudit(
  auditPath: string = DEFAULT_AUDIT_PATH,
  entry: AuditEntry,
): void {
  try {
    const path = auditPath || DEFAULT_AUDIT_PATH
    const dir = dirname(path)
    if (dir !== "." && dir !== "") {
      fs.mkdirSync(dir, { recursive: true })
    }
    if (fs.existsSync(path)) {
      const raw = fs.readFileSync(path, "utf-8")
      const linhas = raw.split(/\r?\n/).filter((l) => l.trim() !== "")
      const ultima = linhas[linhas.length - 1]
      if (ultima != null) {
        try {
          const parsed: unknown = JSON.parse(ultima.trim())
          if (
            parsed != null &&
            typeof parsed === "object" &&
            (parsed as Record<string, unknown>)["taskId"] === entry.taskId &&
            (parsed as Record<string, unknown>)["resultado"] === entry.resultado
          ) {
            return // dedupe: mesma entrada já é a última linha
          }
        } catch {
          // última linha corrompida: segue com o append normal
        }
      }
    }
    fs.appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8")
  } catch {
    // nunca quebrar o fluxo principal
  }
}

/**
 * Lê todas as entradas do JSONL de auditoria, tolerando linhas vazias,
 * corrompidas e shapes inválidos (ignorados). Arquivo ausente => [].
 * Nunca lança.
 */
export function readAudit(auditPath: string = DEFAULT_AUDIT_PATH): AuditEntry[] {
  try {
    const path = auditPath || DEFAULT_AUDIT_PATH
    if (!fs.existsSync(path)) return []
    const raw = fs.readFileSync(path, "utf-8")
    const out: AuditEntry[] = []
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === "") continue
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (ehAuditEntryValido(parsed)) out.push(parsed)
      } catch {
        // linha corrompida: ignora
      }
    }
    return out
  } catch {
    return []
  }
}
