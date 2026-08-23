#!/usr/bin/env node
/**
 * ============================================================================
 * report.mjs — Relatório de telemetria do pipeline (FASE 5)
 * ============================================================================
 * Lê `.opencode/pipeline/metrics.jsonl` (JSONL tolerante) e imprime resumo:
 *  - taxa de reprovação de gate = gate_fail / gate_run
 *  - média de retries por tarefa (retry events / taskIds distintos)
 *  - tempo médio por fase (se houver transicao events com duração; senão N/A)
 *  - tarefas concluídas vs escaladas (commit vs escala_humano counts)
 *  - total de eventos, tasks distintas
 *
 * Args:
 *   --path <arquivo> : caminho do JSONL (default: .opencode/pipeline/metrics.jsonl)
 *   --json           : saída JSON em vez de texto
 *
 * Sem deps externas. Tolerante a linhas vazias/corrompidas.
 * ============================================================================
 */

import { existsSync, readFileSync } from "node:fs"

const DEFAULT_PATH = ".opencode/pipeline/metrics.jsonl"

function parseArgs(argv) {
  let metricsPath = DEFAULT_PATH
  let jsonOutput = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--path" && i + 1 < argv.length) {
      metricsPath = argv[i + 1] ?? DEFAULT_PATH
      i++
    } else if (arg === "--json") {
      jsonOutput = true
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Uso: node .opencode/pipeline/report.mjs [--path <arquivo>] [--json]`)
      process.exit(0)
    }
  }
  return { metricsPath, jsonOutput }
}

function readEvents(metricsPath) {
  if (!existsSync(metricsPath)) return []
  try {
    const raw = readFileSync(metricsPath, "utf-8")
    const lines = raw.split(/\r?\n/)
    const out = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === "") continue
      try {
        const parsed = JSON.parse(trimmed)
        if (
          parsed != null &&
          typeof parsed === "object" &&
          typeof parsed.evento === "string" &&
          typeof parsed.taskId === "string"
        ) {
          out.push(parsed)
        }
      } catch {
        // corrompida: ignora
      }
    }
    return out
  } catch {
    return []
  }
}

function extrairDuracao(detalhe) {
  if (detalhe == null) return null
  if (typeof detalhe === "number" && Number.isFinite(detalhe)) return detalhe
  if (typeof detalhe !== "object") return null
  const obj = detalhe
  const candidates = [
    obj.duracaoMs,
    obj.duracao,
    obj.durationMs,
    obj.duration,
    obj.elapsedMs,
    obj.elapsed,
    obj.tempoMs,
    obj.tempo,
  ]
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  // também tenta detalhe.detalhe ?
  if (obj.detalhe != null && typeof obj.detalhe === "number" && Number.isFinite(obj.detalhe)) {
    return obj.detalhe
  }
  return null
}

function main() {
  const { metricsPath, jsonOutput } = parseArgs(process.argv.slice(2))
  const events = readEvents(metricsPath)

  const totalEventos = events.length
  const taskIds = new Set(events.map((e) => e.taskId).filter(Boolean))
  const tasksDistintas = taskIds.size

  const counts = {}
  for (const e of events) {
    counts[e.evento] = (counts[e.evento] ?? 0) + 1
  }

  const gateRun = counts["gate_run"] ?? 0
  const gateFail = counts["gate_fail"] ?? 0
  const retry = counts["retry"] ?? 0
  const commit = counts["commit"] ?? 0
  const escala = counts["escala_humano"] ?? 0
  const transicao = counts["transicao"] ?? 0

  const taxaReprovacao =
    gateRun > 0 ? gateFail / gateRun : null
  const taxaReprovacaoStr =
    taxaReprovacao == null ? "N/A" : `${(taxaReprovacao * 100).toFixed(1)}% (${gateFail}/${gateRun})`

  const mediaRetries = tasksDistintas > 0 ? retry / tasksDistintas : 0
  const mediaRetriesStr = tasksDistintas > 0 ? mediaRetries.toFixed(2) : "0.00"

  // tempo médio por fase: média de durações em transicao events que tenham duração numérica
  let tempoMedioPorFase = null
  let tempoMedioStr = "N/A"
  const duracoes = []
  for (const e of events) {
    if (e.evento === "transicao") {
      const d = extrairDuracao(e.detalhe)
      if (d != null) duracoes.push(d)
    }
  }
  if (duracoes.length > 0) {
    const soma = duracoes.reduce((a, b) => a + b, 0)
    tempoMedioPorFase = soma / duracoes.length
    // exibe em ms se >=1, senão com 2 casas
    tempoMedioStr = Number.isInteger(tempoMedioPorFase)
      ? `${tempoMedioPorFase}ms (média de ${duracoes.length} transições)`
      : `${tempoMedioPorFase.toFixed(2)}ms (média de ${duracoes.length} transições)`
  }

  const resumo = {
    totalEventos,
    tasksDistintas,
    counts,
    gateRun,
    gateFail,
    taxaReprovacao,
    taxaReprovacaoStr,
    mediaRetries,
    mediaRetriesStr,
    tempoMedioPorFase,
    tempoMedioStr,
    concluidas: commit,
    escaladas: escala,
    transicao,
    metricsPath,
  }

  if (jsonOutput) {
    // JSON de saída: campos principais + counts
    const json = {
      totalEventos,
      tasksDistintas,
      taxaReprovacao,
      taxaReprovacaoStr,
      mediaRetries: Number(mediaRetries.toFixed(2)),
      tempoMedioPorFase,
      tempoMedioStr,
      concluidas: commit,
      escaladas: escala,
      counts: {
        gate_run: gateRun,
        gate_fail: gateFail,
        retry,
        transicao,
        commit,
        escala_humano: escala,
      },
      total: totalEventos,
      distinctTasks: tasksDistintas,
    }
    console.log(JSON.stringify(json, null, 2))
  } else {
    console.log("=== Pipeline Telemetria ===")
    console.log(`Arquivo: ${metricsPath}`)
    console.log(`Total de eventos: ${totalEventos}`)
    console.log(`Tasks distintas: ${tasksDistintas}`)
    console.log(`Taxa de reprovação de gate: ${taxaReprovacaoStr}`)
    console.log(`Média de retries por tarefa: ${mediaRetriesStr} (${retry} retries / ${tasksDistintas} tasks)`)
    console.log(`Tempo médio por fase: ${tempoMedioStr}`)
    console.log(`Tarefas concluídas vs escaladas: ${commit} vs ${escala} (commit vs escala_humano)`)
    console.log(`Breakdown por evento: ${JSON.stringify(counts)}`)
  }
}

main()
