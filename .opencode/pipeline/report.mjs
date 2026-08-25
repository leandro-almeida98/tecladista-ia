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
 *   --version / -v   : imprime a versão do package.json da raiz e sai
 *
 * Sem deps externas. Tolerante a linhas vazias/corrompidas.
 * ============================================================================
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const DEFAULT_PATH = ".opencode/pipeline/metrics.jsonl"

function resolvePkgVersion() {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url))
    if (!existsSync(pkgPath)) return "unknown"
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const version = pkg?.version
    return typeof version === "string" && version !== "" ? version : "unknown"
  } catch {
    return "unknown"
  }
}

function parseArgs(argv) {
  let metricsPath = DEFAULT_PATH
  let jsonOutput = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--version" || arg === "-v") {
      console.log(resolvePkgVersion())
      process.exit(0)
    } else if (arg === "--path" && i + 1 < argv.length) {
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

  // Features distintas (pós-FASE 5): nomes únicos em detalhe.feature dos
  // eventos enriquecidos. Retrocompatível: eventos sem feature são ignorados.
  const features = [
    ...new Set(
      events
        .map((e) => (e.detalhe == null ? null : e.detalhe.feature))
        .filter((f) => typeof f === "string" && f !== ""),
    ),
  ]
  const featuresStr = features.length > 0 ? features.join(", ") : "N/A"

  // tempo médio por fase: média de durações em transicao events que tenham
  // duração numérica, AGRUPADO por detalhe.fase (FIX 2). Sem duração => N/A.
  const duracoesPorFase = {}
  for (const e of events) {
    if (e.evento === "transicao") {
      const d = extrairDuracao(e.detalhe)
      if (d != null) {
        const fase = e.detalhe != null && typeof e.detalhe === "object" ? e.detalhe.fase : undefined
        const chave = typeof fase === "string" && fase !== "" ? fase : "(sem fase)"
        if (!duracoesPorFase[chave]) duracoesPorFase[chave] = []
        duracoesPorFase[chave].push(d)
      }
    }
  }
  const fasesComDuracao = Object.keys(duracoesPorFase)
  const tempoMedioPorFase = {}
  for (const fase of fasesComDuracao) {
    const arr = duracoesPorFase[fase]
    const soma = arr.reduce((a, b) => a + b, 0)
    tempoMedioPorFase[fase] = soma / arr.length
  }
  let tempoMedioStr = "N/A"
  if (fasesComDuracao.length > 0) {
    tempoMedioStr = fasesComDuracao
      .map((fase) => {
        const media = tempoMedioPorFase[fase]
        const n = duracoesPorFase[fase].length
        const valor = Number.isInteger(media) ? `${media}ms` : `${media.toFixed(2)}ms`
        return `${fase}: ${valor} (${n} transições)`
      })
      .join("; ")
  }

  // FIX 1 — TOKENS/CUSTO: soma por feature + total a partir dos eventos
  // `tokens` (detalhe.tokens = TokenCounts, detalhe.cost, detalhe.feature).
  const tokensPorFeature = {}
  const tokensTotal = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  for (const e of events) {
    if (e.evento !== "tokens") continue
    const det = e.detalhe
    if (det == null || typeof det !== "object") continue
    const t = det.tokens
    if (t == null || typeof t !== "object") continue
    const feature = typeof det.feature === "string" && det.feature !== "" ? det.feature : "(sem feature)"
    if (!tokensPorFeature[feature]) {
      tokensPorFeature[feature] = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
    }
    const alvo = tokensPorFeature[feature]
    // NOTA (FIX 1.5): `cost` NÃO é somado do loop de keys de `tokens` — o
    // flushTokens emite `{tokens, cost}` onde tokens.cost === detalhe.cost
    // (MESMO valor). Somar ambos duplicaria o custo (2×). `detalhe.cost` é o
    // canônico; tokens.cost é redundante e ignorado aqui.
    for (const k of ["input", "output", "reasoning", "cacheRead", "cacheWrite"]) {
      const v = typeof t[k] === "number" && Number.isFinite(t[k]) ? t[k] : 0
      alvo[k] += v
      tokensTotal[k] += v
    }
    const c = typeof det.cost === "number" && Number.isFinite(det.cost) ? det.cost : 0
    alvo.cost += c
    tokensTotal.cost += c
  }
  const temTokens = tokensTotal.input + tokensTotal.output + tokensTotal.reasoning + tokensTotal.cacheRead + tokensTotal.cacheWrite > 0 || tokensTotal.cost > 0
  const tokensTotaisStr = temTokens
    ? `${tokensTotal.input + tokensTotal.output + tokensTotal.reasoning} (in: ${tokensTotal.input}, out: ${tokensTotal.output})`
    : "N/A"
  const custoTotalStr = temTokens ? `$${tokensTotal.cost.toFixed(4)}` : "N/A"

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
    features,
    featuresStr,
    tempoMedioPorFase,
    tempoMedioStr,
    concluidas: commit,
    escaladas: escala,
    transicao,
    tokens: temTokens ? tokensTotal : null,
    tokensPorFeature: temTokens ? tokensPorFeature : null,
    tokensTotaisStr,
    custoTotalStr,
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
      features,
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
        tokens: counts["tokens"] ?? 0,
      },
      tokens: temTokens ? tokensTotal : null,
      tokensPorFeature: temTokens ? tokensPorFeature : null,
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
    console.log(`Features: ${featuresStr}`)
    console.log(`Tempo médio por fase: ${tempoMedioStr}`)
    console.log(`Tokens totais: ${tokensTotaisStr}`)
    console.log(`Custo total: ${custoTotalStr}`)
    if (temTokens) {
      for (const feature of Object.keys(tokensPorFeature)) {
        const t = tokensPorFeature[feature]
        console.log(`  ${feature}: ${t.input + t.output + t.reasoning} tokens (in: ${t.input}, out: ${t.output}) — $${t.cost.toFixed(4)}`)
      }
    }
    console.log(`Tarefas concluídas vs escaladas: ${commit} vs ${escala} (commit vs escala_humano)`)
    console.log(`Breakdown por evento: ${JSON.stringify(counts)}`)
  }
}

main()
