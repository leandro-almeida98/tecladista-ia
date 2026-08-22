/**
 * ============================================================================
 * gitnexus-index-refresh.ts
 * ============================================================================
 * Quality gate de índice GitNexus — intercepta a delegação do orquestrador
 * (tool `task`) e, ANTES de delegar ao subagente, garante que o índice
 * GitNexus esteja fresco: roda `node .gitnexus/run.cjs status` (barato) e, se
 * o índice estiver stale, roda o analyze (`node .gitnexus/run.cjs analyze` —
 * configurável) para atualizar símbolos/processos antes do subagente trabalhar.
 *
 * COMPORTAMENTO
 *  1. Hook `tool.execute.before` para a ferramenta `task`. Como apenas o
 *     orquestrador tem permissão de `task`, isso equivale a "antes de qualquer
 *     delegação do orquestrador".
 *  2. `status` primeiro (rápido). Se o output indicar stale/behind → `analyze`.
 *  3. Status com formato desconhecido ou comando de status falhou → roda
 *     `analyze` mesmo assim (best-effort).
 *  4. Throttle: não roda `analyze` mais de uma vez por OPTIONS.minIntervalMs.
 *  5. Se um analyze já estiver em andamento (delegação anterior), pula.
 *  6. Falha do `analyze` NÃO bloqueia a delegação — loga warn e segue. Para
 *     bloquear, use OPTIONS.blockOnAnalyzeFailure = true.
 *
 * CONFIG (edite OPTIONS abaixo)
 *  - enabled: liga/desliga o gate inteiro.
 *  - targets: subagent_types que disparam o refresh ([] = qualquer delegação).
 *  - statusCommand / analyzeCommand: comandos exatos. O projeto recomenda o
 *    runner local `node .gitnexus/run.cjs ...`; `npx gitnexus analyze` também
 *    funciona (mais lento, baixa o pacote).
 *  - staleMarkers: regex de staleness no output do status.
 *  - freshMarkers: regex de "fresh/ok" no output do status (usado p/ log).
 *  - analyzeOnUnknownStatus: se o status não casar nem stale nem fresh, roda
 *    analyze (default true).
 *  - minIntervalMs: throttle — pula analyze se o último rodou há menos disso.
 *  - blockOnAnalyzeFailure: false = warn e segue (default); true = throw
 *    (bloqueia a delegação).
 *
 * NOTA: plugin é auto-descoberto em `.opencode/plugins/`. Reinicie o opencode
 * para carregá-lo (config é lida no start).
 * ============================================================================
 */

import { execSync, type ExecSyncOptions } from "node:child_process"
import type { Plugin } from "@opencode-ai/plugin"

// ============================================================================
// 1) CONFIGURACAO — EDITE AQUI
// ============================================================================

const OPTIONS = {
  enabled: true,
  /** Subagent_types que disparam o refresh. Vazio = qualquer delegação. */
  targets: [] as string[],
  statusCommand: "node .gitnexus/run.cjs status",
  analyzeCommand: "node .gitnexus/run.cjs analyze",
  statusTimeoutMs: 30_000,
  analyzeTimeoutMs: 20 * 60 * 1000,
  staleMarkers: [/\bstale\b/i, /\bbehind\b/i, /out\s*of\s*date/i],
  freshMarkers: [/\bup\s*to\s*date\b/i, /\bfresh\b/i, /\bok\b/i, /✓/],
  analyzeOnUnknownStatus: true,
  /** Não roda analyze de novo se o último rodou há menos de X ms atrás. */
  minIntervalMs: 10 * 60 * 1000,
  /** false = falha do analyze só loga warn; true = throw (bloqueia delegação). */
  blockOnAnalyzeFailure: false,
  /** Windows/WSL: prefixa os comandos com `wsl`. */
  onWindowsUseWsl: true,
  wslPrefix: "wsl",
} as const

// ============================================================================
// 2) IMPLEMENTACAO
// ============================================================================

const isWindows = process.platform === "win32"

function resolveCommand(command: string): string {
  if (isWindows && OPTIONS.onWindowsUseWsl && OPTIONS.wslPrefix) {
    return `${OPTIONS.wslPrefix} bash -lc "${command.replace(/"/g, '\\"')}"`
  }
  return command
}

function runSync(command: string, timeoutMs: number): { ok: boolean; output: string; status: number } {
  const opts: ExecSyncOptions = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  }
  try {
    const out = execSync(resolveCommand(command), opts)
    return { ok: true, output: String(out), status: 0 }
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number }
    const stdout = e.stdout == null ? "" : String(e.stdout)
    const stderr = e.stderr == null ? "" : String(e.stderr)
    return { ok: false, output: `${stdout}\n${stderr}`.trim(), status: e.status ?? -1 }
  }
}

export const GitnexusIndexRefresh: Plugin = async ({ client, directory }) => {
  const rootDir = directory
  let lastAnalyzeAt = 0
  let analyzeInFlight = false

  const log = async (level: "debug" | "info" | "warn" | "error", message: string) => {
    try {
      await client.app.log({ body: { service: "gitnexus-index-refresh", level, message } })
    } catch {
      // log nunca deve quebrar o fluxo do plugin
    }
  }

  /** Decide se o status indica índice desatualizado. null = formato desconhecido. */
  function isStale(output: string): boolean | null {
    const fresh = OPTIONS.freshMarkers.some((m) => m.test(output))
    if (fresh) return false
    const stale = OPTIONS.staleMarkers.some((m) => m.test(output))
    if (stale) return true
    return null
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!OPTIONS.enabled) return
      if (input.tool !== "task") return

      const target = String((output.args as { subagent_type?: unknown })?.subagent_type ?? "")
      if (OPTIONS.targets.length > 0 && !OPTIONS.targets.includes(target)) return

      // Throttle: análise recente? pula.
      if (Date.now() - lastAnalyzeAt < OPTIONS.minIntervalMs) {
        await log("info", `Delegação p/ ${target}: índice verificado/analisado há pouco — pulando refresh`)
        return
      }
      if (analyzeInFlight) {
        await log("info", `Delegação p/ ${target}: analyze já em andamento — pulando`)
        return
      }

      // 1) Status (barato)
      const st = runSync(OPTIONS.statusCommand, OPTIONS.statusTimeoutMs)
      if (st.ok) {
        const stale = isStale(st.output)
        if (stale === false) {
          await log("info", `Delegação p/ ${target}: índice GitNexus fresco — sem analyze`)
          lastAnalyzeAt = Date.now() // marca como "verificado recente"
          return
        }
        if (stale === true) {
          await log("info", `Delegação p/ ${target}: índice stale — rodando ${OPTIONS.analyzeCommand}`)
        }
      } else if (!OPTIONS.analyzeOnUnknownStatus) {
        await log("warn", `Delegação p/ ${target}: status GitNexus falhou (${st.status}) — índice pode estar stale; refresh pulado (analyzeOnUnknownStatus=false)`)
        return
      } else {
        await log("warn", `Delegação p/ ${target}: status GitNexus falhou (${st.status}) — rodando analyze best-effort`)
      }

      // 2) Analyze (full reindex)
      analyzeInFlight = true
      try {
        lastAnalyzeAt = Date.now()
        const an = runSync(OPTIONS.analyzeCommand, OPTIONS.analyzeTimeoutMs)
        if (an.ok) {
          const tail = an.output.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")
          await log("info", `Delegação p/ ${target}: analyze concluído${tail ? ` — ${tail}` : ""}`)
        } else {
          const msg = `Delegação p/ ${target}: analyze FALHOU (exit ${an.status}) — índice pode estar desatualizado. ${an.output.slice(0, 800)}`
          if (OPTIONS.blockOnAnalyzeFailure) {
            throw new Error(`[GITNEXUS-INDEX-REFRESH] ${msg}`)
          }
          await log("warn", msg)
        }
      } finally {
        analyzeInFlight = false
      }
    },
  }
}

export default GitnexusIndexRefresh
