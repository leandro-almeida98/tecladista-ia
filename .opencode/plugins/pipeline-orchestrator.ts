/**
 * ============================================================================
 * pipeline-orchestrator.ts
 * ============================================================================
 * Plugin OpenCode que substitui os agentes de QA por UM QUALITY GATE sincrono
 * de FRONTEND e orquestra a transicao dev -> code-reviewer (app unico React
 * + Vite na raiz do repo).
 *
 * COMPORTAMENTO
 *  1. Gatilho de transicao: intercepta a ferramenta de delegacao `task`
 *     (e, por seguranca, `finish`, que nao existe no OpenCode atual).
 *  2. Roteamento por agente de origem:
 *       - dev-frontend -> roda BUILD + TESTE + COBERTURA (npm)
 *     Os comandos exatos ficam em QUALITY_GATES abaixo — EDITE AQUI.
 *  3. Controle de fluxo:
 *       - Falha em step de COBERTURA (exit != 0): cobertura e POR ARQUIVO
 *         (limite 95%), decidida pelo EXIT CODE do comando — Vitest com
 *         `thresholds.perFile` ja falha sozinho. O plugin extrai apenas a
 *         lista de arquivos abaixo do limite e lanca `throw new Error`
 *         preciso (sem despejar o log inteiro).
 *       - Falha em step de BUILD/TESTE: extrai apenas as linhas de falha
 *         (regex) do stdout/stderr, truncadas para economizar tokens.
 *         Isso bloqueia a ida ao code-reviewer e forca o dev a corrigir.
 *       - Sucesso: libera o fluxo natural para acionar o code-reviewer.
 *  4. GUARDA DE BOOTSTRAP: se nao existir `package.json` na raiz do projeto
 *     (pre-scaffold), o gate e PULADO com warn — nao bloqueia o fluxo.
 *     Remover esta guarda depois do scaffold (existe so para o periodo em
 *     que o app ainda nao foi criado).
 *  5. DOCKER COMPOSE POS-GATE: quando TODOS os steps do gate passam (gate
 *     aprovado), roda `docker compose up -d --build` automaticamente — MAS
 *     SO se existir `docker-compose.yml` na raiz; caso contrario, loga
 *     "[SKIP] docker-compose.yml ausente — compose pulado" e segue sem
 *     bloquear. Configuravel em OPTIONS.composeUpOnGatePass — EDITE ALI.
 *  6. DETECTOR IMPECCABLE POS-GATE: apos o composeUp, se
 *     OPTIONS.detectorOnGatePass.enabled, descobre os arquivos UI alterados
 *     no working tree (git diff + untracked, filtrados por uiExtensions) e
 *     roda o detector de anti-padroes de design do impeccable neles. Se o
 *     script do detector nao existir, pula graciosamente com warn. Exit 0 =
 *     sem anti-padroes (segue). Exit != 0 (o detector retorna 2 quando acha
 *     findings nao-advisory) com blockOnFindings:true => throw (bloqueia a
 *     transicao para o code-reviewer); com false => apenas warn. Sem
 *     arquivos UI alterados => log "[OK] detector: nenhum arquivo UI alterado".
 *     Execucao SEM shell (execFileSync) — filenames vao como args vetoriais.
 *     Configuravel em OPTIONS.detectorOnGatePass — EDITE ALI.
 *
 * OBSERVACAO IMPORTANTE
 *  - O OpenCode (v1.18) NAO possui uma ferramenta chamada `finish`. A transicao
 *    real entre agentes ocorre quando o ORQUESTRADOR chama `task(subagent_type
 *    = "code-reviewer")`. Por isso o gate roda no hook `tool.execute.before`
 *    dessa chamada, usando o ultimo agente dev que concluiu (trackeado pelo
 *    hook `tool.execute.after` da task anterior).
 *  - O gate roda com execSync (sincrono). Comandos sao executados a partir da
 *    raiz do projeto (app unico).
 *  - O detector impeccable roda com execFileSync (SEM shell): o comando base
 *    e parseado em [bin, ...args] e os filenames alterados entram como
 *    argumentos vetoriais — nenhum caractere do nome de arquivo e interpretado
 *    por shell (mitiga injecao via filename: $(), backticks, ;, &&...).
 *
 * NOTA SOBRE "SO" (Sistema Operacional)
 *  - Se o OpenCode rodar dentro do WSL/Linux, os comandos `npm` sao
 *    executados direto (process.platform === "linux").
 *  - Se rodar no Windows, o plugin prefixa os comandos com `wsl bash -lc "..."`
 *    para executar dentro do WSL. Ajuste em OPTIONS.onWindowsUseWsl /
 *    OPTIONS.wslPrefix.
 * ============================================================================
 */

import { execFileSync, execSync, type ExecSyncOptions } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
// Registry do pipeline (FASE 1 — harness verificável). Import com extensão
// .ts explícita (compatível com node --experimental-strip-types e tsc com
// allowImportingTsExtensions).
import {
  aprovar,
  createEntry,
  getActiveEntry,
  readRegistry,
  registrarDetectChanges,
  registrarGateResult,
  updateEntry,
  writeRegistry,
  type DetectChangesReport,
  type GateResult,
  type RegistryEntry,
  type RegistryFile,
} from "../pipeline/registry.ts"

// ============================================================================
// 1) CONFIGURACAO DO QUALITY GATE —  EDITE AQUI OS COMANDOS EXATOS  ==========
// ============================================================================

/** Um passo do gate: um comando de shell unico (nao precisa de `&&`). */
interface QualityGateStep {
  /** Rotulo exibido no log/erro. */
  label: string
  /** Comando shell. Roda na raiz do repo. Ex.: "npm run build". */
  command: string
  /** Timeout em ms antes de matar o processo. */
  timeoutMs?: number
  /**
   * Marca o step como de COBERTURA. A validacao NAO le a % media global:
   * o comando em si ja falha (exit != 0) quando um arquivo fica abaixo do
   * limite per-file (95%). Se o comando falhar, a chave e usada para buscar
   * o limite em COVERAGE_THRESHOLDS e montar a mensagem de erro.
   */
  coverageKey?: string
  /** Formato do output usado para extrair os arquivos que falharam. */
  coverageSource?: "vitest"
}

/** Um quality gate associado a um ou mais agentes de origem (dev). */
interface QualityGate {
  /** Agentes de origem que disparam este gate. Ex.: ["dev-frontend"]. */
  sourceAgents: string[]
  /** Nome do gate (aparece no erro). */
  label: string
  /** Comandos executados EM ORDEM; para no primeiro que falhar. */
  commands: QualityGateStep[]
  /**
   * Regex de extracao de falhas aplicada ao stdout/stderr. O plugin mantem
   * apenas as linhas que casam (para economizar tokens na mensagem de erro).
   */
  failurePatterns: RegExp[]
  /** Maximo de linhas de falha mantidas no erro. */
  maxFailureLines?: number
}

/**
 * ===========================================================================
 * QUALITY_GATES — AJUSTE AQUI os comandos da SUA arquitetura.
 *
 * Pipeline: BUILD -> TESTE UNITARIO -> COVERAGE (para no 1o erro).
 *
 * Frontend (React + Vitest): coverage via @vitest/coverage-v8 (provider v8)
 * com `thresholds: { lines: 95, perFile: true }` no vite.config.ts — o proprio
 * Vitest falha (exit 1) imprimindo uma linha de erro POR arquivo abaixo de 95%.
 *
 * Scripts canonicos definidos no package.json da raiz:
 *   npm run build          -> build Vite (typecheck TS strict + bundle)
 *   npm test               -> vitest run (unitario)
 *   npm run test:coverage  -> vitest run --coverage (v8)
 *
 * COBERTURA NAO USA MEDIA GLOBAL: nao ha comparacao de % medida apos o
 * comando. A decisao de passar/falhar e o EXIT CODE do comando de cobertura
 * (Vitest per-file). COVERAGE_THRESHOLDS (variavel no topo do arquivo) vira
 * apenas a constante de mensagem (95%) exibida no erro.
 * ===========================================================================
 */
const QUALITY_GATES: QualityGate[] = [
  {
    sourceAgents: ["dev-frontend"],
    label: "Quality Gate FRONTEND (React + Vitest)",
    commands: [
      { label: "build", command: "npm run build", timeoutMs: 15 * 60 * 1000 },
      { label: "test", command: "npm test", timeoutMs: 15 * 60 * 1000 },
      {
        label: "coverage",
        command: "npm run test:coverage",
        timeoutMs: 20 * 60 * 1000,
        coverageKey: "root",
        coverageSource: "vitest",
      },
    ],
    failurePatterns: [
      /\b(error|errored)\b/i,
      /\bfailed\b/i,
      /\btests?\s+(\d+)\s+(failed|failed:)/i,
      /\b(FAIL|FAILED|FAILURES)\b/,
      /\bELIFECYCLE\b/i,
      /\bexit code\s+\d+\b/i,
      /\b(✗|×)\s*.*(error|fail)/i,
      /error:\s*TS\d+/,
    ],
    maxFailureLines: 40,
  },
]

// ============================================================================
// 1b) METAS MINIMAS DE COBERTURA (%) —  EDITE AQUI QUANDO QUISER  ============
// ============================================================================

/**
 * Limite minimo de cobertura (95%) POR ARQUIVO. NAO e uma media global medida
 * pelo plugin: a decisao de passar/falhar e o EXIT CODE do proprio comando de
 * cobertura — Vitest: `thresholds: { lines: 95, perFile: true }` no
 * vite.config.ts (falha imprimindo "ERROR: Coverage for lines (...) ... for
 * <arquivo>"). Este mapa so fornece o numero exibido na mensagem de erro.
 */
const COVERAGE_THRESHOLDS: Record<string, number> = {
  root: 95,
}

// ============================================================================
// 2) OPCOES DE ORQUESTRACAO —  ajustes finos  ================================
// ============================================================================

const OPTIONS = {
  /** Agente de destino que dispara o gate antes de ser acionado. */
  targetAgent: "code-reviewer",
  /** Bloqueia `git commit` quando o agente ativo for o code-reviewer. */
  blockGitCommitForReviewer: false,
  /** Padroes de comando que caracterizam um commit a ser bloqueado. */
  gitCommitPatterns: [
    /\bgit\b[\s\S]{0,300}?\bcommit\b/i,
  ],
  /** Bloqueia `git push` do code-reviewer (DESATIVADO: reviewer commita e dá push p/ main após aprovação). */
  blockGitPushForReviewer: false,
  /** Padrões de comando que caracterizam um push a ser bloqueado. */
  gitPushPatterns: [
    /\bgit\b[\s\S]{0,300}?\bpush\b/i,
  ],
  /** Windows: prefixa os comandos com `wsl` p/ rodar dentro do WSL. */
  onWindowsUseWsl: true,
  wslPrefix: "wsl",
  /** Bytes maximos da mensagem de erro (trunca o restante). */
  maxErrorBytes: 4000,
  /** Se o agente fonte for desconhecido, roda o gate do frontend (default false = nao bloqueia). */
  gateOnUnknownSource: false,

  // -------- REGISTRY DO PIPELINE (FASE 1 — harness verificável) --------
  /**
   * Validação MECÂNICA da pré-condição de delegação via registry persistido
   * (`.opencode/pipeline/state.json`):
   *   - delegação ao dev-frontend SEM entrada ativa => cria a entrada
   *     (feature extraída de args.description ?? 1ª linha de args.prompt,
   *     máx. 80 chars) e marca a fase "desenvolvimento" em_andamento;
   *   - delegação ao dev-frontend COM entrada ativa => reutiliza (nunca cria
   *     segunda — invariante de entrada única);
   *   - delegação a qualquer outro agente SEM entrada ativa => throw
   *     "[PIPELINE-REGISTRY] ..." (bloqueia antes do gate);
   *   - COM entrada ativa => fluxo normal (gates abaixo intocados).
   */
  registryEnabled: true,
  /** Caminho do state.json RELATIVO à raiz do projeto (directory). */
  statePath: ".opencode/pipeline/state.json",
  /**
   * FASE 2 — targets autorizados a receber delegação `task`. Qualquer outro
   * target é bloqueado mecanicamente ANTES da validação do registry
   * ("[PIPELINE-REGISTRY] ... não autorizado"). Readonly por design.
   */
  allowedTargets: ["dev-frontend", "code-reviewer"] as const,

  // -------- DOCKER COMPOSE (apos gate aprovado) --------
  /**
   * Sobe o docker compose com rebuild quando o gate passa (atualiza as imagens
   * alteradas). So roda se TODOS os steps do gate passaram E existir
   * `docker-compose.yml` na raiz; sem o arquivo, apenas loga "[SKIP]" e segue.
   */
  composeUpOnGatePass: {
    enabled: true,
    command: "docker compose up -d --build",
    timeoutMs: 20 * 60 * 1000,
  } as const,

  // -------- DETECTOR IMPECCABLE (apos gate aprovado) --------
  /**
   * Roda o detector de anti-padroes do impeccable apos o gate passar
   * (revisao de design automatizada). Roda DEPOIS do composeUpOnGatePass:
   * o compose e o comportamento "gate aprovado" existente (sempre roda quando
   * os steps passam); o detector e a camada final de revisao de design antes
   * do code-reviewer. Exit 0 = sem anti-padroes; exit 2 (nao-advisory) com
   * blockOnFindings:true => throw (bloqueia a transicao). Script ausente =>
   * skip gracioso com warn.
   */
  detectorOnGatePass: {
    enabled: true,
    /** Comando base do detector (sem targets). Prefira o script local (sem download npx). */
    command: "node .opencode/skills/impeccable/scripts/detector/detect-antipatterns.mjs",
    /** Extensoes de arquivo UI que disparam o detector. */
    uiExtensions: [".tsx", ".jsx", ".ts", ".js", ".css", ".html", ".vue", ".svelte", ".astro", ".scss", ".sass", ".less"],
    /** Se true, findings bloqueiam a transicao (throw com resumo); se false, apenas loga. */
    blockOnFindings: true,
    /** Maximo de arquivos UI passados como args ao detector (trunca a lista). */
    maxFiles: 50,
    timeoutMs: 5 * 60 * 1000,
  } as const,
} as const

// ============================================================================
// 3) IMPLEMENTACAO
// ============================================================================

/**
 * Adapta o comando ao SO (WSL no Windows, shell normal no Linux).
 * A checagem de plataforma é feita NA CHAMADA (não capturada no load do
 * módulo) para que testes possam simular win32 via mock de process.platform.
 */
function resolveCommand(command: string): string {
  const isWindows = process.platform === "win32"
  if (isWindows && OPTIONS.onWindowsUseWsl && OPTIONS.wslPrefix) {
    return `${OPTIONS.wslPrefix} bash -lc "${command.replace(/"/g, '\\"')}"`
  }
  return command
}

type ExecResult =
  | { ok: true; output: string }
  | { ok: false; output: string; status: number }

/** Executa um step do gate de forma sincrona (execSync). */
function execGateStep(step: QualityGateStep, cwd: string): ExecResult {
  const opts: ExecSyncOptions = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: step.timeoutMs ?? 10 * 60 * 1000,
  }
  try {
    const out = execSync(resolveCommand(step.command), opts)
    return { ok: true, output: String(out) }
  } catch (err) {
    const e = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number
      signal?: string
    }
    const stdout = e.stdout == null ? "" : String(e.stdout)
    const stderr = e.stderr == null ? "" : String(e.stderr)
    const status = e.status ?? -1
    return { ok: false, output: `${stdout}\n${stderr}`.trim(), status }
  }
}

/**
 * Executa o detector impeccable SEM shell (execFileSync): `command` e
 * parseado UMA vez em [bin, ...baseArgs] (comandos aqui nao tem paths com
 * espacos — ex.: "node <script>") e os filenames sao anexados como
 * argumentos vetoriais. Sem shell => $(), backticks, ";", "&&" etc. em
 * filenames NUNCA sao interpretados (sem injecao via filename).
 *
 * NOTA WSL/Windows: este caminho NAO passa por resolveCommand — execFileSync
 * nao invoca shell, entao nao ha prefixo WSL. No Windows nativo o bin resolve
 * via PATH; alvo primario do plugin e Linux/WSL (limitacao documentada).
 */
function execDetectorStep(
  command: string,
  files: readonly string[],
  timeoutMs: number,
  cwd: string,
): ExecResult {
  const parts = command.split(/\s+/).filter(Boolean)
  const bin = parts[0]
  if (!bin) {
    return { ok: false, output: `[detector] comando vazio: "${command}"`, status: -1 }
  }
  try {
    const out = execFileSync(bin, [...parts.slice(1), ...files], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    })
    return { ok: true, output: String(out) }
  } catch (err) {
    const e = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number
    }
    const stdout = e.stdout == null ? "" : String(e.stdout)
    const stderr = e.stderr == null ? "" : String(e.stderr)
    const status = e.status ?? -1
    return { ok: false, output: `${stdout}\n${stderr}`.trim(), status }
  }
}

/** Extrai apenas as linhas de falha relevantes (regex) para economizar tokens. */
function extractFailures(raw: string, patterns: RegExp[], maxLines: number): string {
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd())
  const seen = new Set<string>()
  const out: string[] = []

  for (const line of lines) {
    if (patterns.some((p) => p.test(line))) {
      const trimmed = line.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
      if (out.length >= maxLines) break
    }
  }

  // Nenhuma linha bateu: mantem as ultimas `maxLines` nao vazias como fallback.
  if (out.length === 0) {
    const tail = lines.filter((l) => l.trim()).slice(-maxLines)
    out.push(...tail)
  }

  return out.join("\n")
}

/** Trunca o payload do erro por bytes. */
function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  let out = ""
  for (const line of text.split("\n")) {
    if (Buffer.byteLength(out + "\n" + line, "utf-8") > maxBytes) break
    out = out ? `${out}\n${line}` : line
  }
  return out.length ? `${out}\n...(truncado p/ ${maxBytes} bytes)` : "(sem saida)"
}

/** Maximo de arquivos reportados no erro de cobertura. */
const MAX_COVERAGE_TARGETS = 15

/**
 * Extrai os arquivos que ficaram ABAIXO do limite de cobertura per-file.
 * Usado quando o comando de cobertura falha (exit != 0), para montar uma
 * mensagem de erro precisa (sem o log inteiro).
 *
 * Formato reconhecido — Vitest v4 (thresholds.perFile); o nome do limiar varia
 * conforme a config:
 *   ERROR: Coverage for lines (0%) does not meet global threshold (80%) for src/foo.ts
 *   ERROR: Coverage for lines (0%) does not meet per-file threshold (80%) for src/foo.ts
 *   ERROR: Coverage for lines (0%) does not meet "src/**" threshold (80%) for src/foo.ts
 *
 * Retorna nomes unicos (max. MAX_COVERAGE_TARGETS). Vazio se nada casar.
 */
function extractFailedCoverageTargets(output: string): string[] {
  const seen = new Set<string>()
  const targets: string[] = []

  const add = (raw: string) => {
    const name = raw.trim()
    if (!name || seen.has(name) || targets.length >= MAX_COVERAGE_TARGETS) return
    seen.add(name)
    targets.push(name)
  }

  // Linha de erro do threshold per-file. Cobre as 3 variantes de nome de
  // limiar ("global" p/ thresholds globais + perFile, "per-file" e globs
  // nomeados entre aspas). O caminho do arquivo e o que segue "for " no fim.
  const perFileLine = /^\s*ERROR: Coverage for (?:lines|statements|functions|branches) \([\d.]+%\) does not meet .*? threshold \([\d.]+%\) for (.+?)\s*$/gim
  let matched = false
  for (const m of output.matchAll(perFileLine)) {
    matched = true
    add(m[1] ?? "")
  }
  if (matched) return targets

  // Fallback: qualquer linha de threshold com "for <arquivo>" no fim.
  const fallback = /\bdoes not meet .*? threshold \([\d.]+%\) for (.+?)\s*$/gim
  for (const m of output.matchAll(fallback)) add(m[1] ?? "")
  return targets
}

/**
 * Padroes de extracao de falhas do detector impeccable. O detector imprime
 * cada finding como:
 *   <arquivo>
 *     line <n>: [<rule-id>] <snippet>
 *       → <descricao>
 *   N anti-pattern(s) found.
 * Os padroes capturam as linhas de finding (nao o log inteiro).
 */
const DETECTOR_FAILURE_PATTERNS: RegExp[] = [
  /\banti-pattern/i,
  /\bfinding/i,
  /✗/,
  /line \d+: \[[a-z-]+\]/i,
]

/**
 * Descobre os arquivos UI alterados no working tree: diff de tracked
 * (git diff --name-only --diff-filter=ACM HEAD) + untracked
 * (git ls-files --others --exclude-standard), filtrados pelas extensoes de
 * arquivo UI. Retorna a lista completa (o chamador trunca se necessario).
 */
function getChangedUiFiles(cwd: string, uiExtensions: readonly string[]): string[] {
  const run = (cmd: string): string[] => {
    try {
      const out = execSync(resolveCommand(cmd), {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      })
      return String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    } catch {
      return []
    }
  }
  const tracked = run("git diff --name-only --diff-filter=ACM HEAD")
  const untracked = run("git ls-files --others --exclude-standard")
  const exts = uiExtensions.map((e) => e.toLowerCase())
  return [...tracked, ...untracked].filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
}

/**
 * GUARDA DE BOOTSTRAP: true quando o projeto ja foi scaffoldado
 * (`package.json` presente na raiz). Enquanto falso, o quality gate e pulado
 * com warn (nao bloqueia) — o app ainda nao tem build/teste para rodar.
 */
function hasPackageJson(cwd: string): boolean {
  return existsSync(join(cwd, "package.json"))
}

// ============================================================================
// 3b) REGISTRY DO PIPELINE (FASE 1) — helpers de integração ==================
// ============================================================================

/**
 * Mapeia agente delegado -> fase do registry marcada como concluída quando a
 * task dele termina com sucesso (hook tool.execute.after).
 */
const AGENTE_PARA_FASE: Record<string, string> = {
  "dev-frontend": "desenvolvimento",
  "code-reviewer": "revisao",
}

/** Tamanho máximo da feature extraída dos args da delegação. */
const MAX_FEATURE_LEN = 80

/** Feature padrão quando a delegação não traz description/prompt utilizáveis. */
const FEATURE_PADRAO = "tarefa sem descrição"

/**
 * Extrai a feature da task a partir dos args da delegação `task`:
 * `args.description` se for string não vazia; senão a PRIMEIRA linha de
 * `args.prompt`; senão FEATURE_PADRAO. Sempre trim + truncada em 80 chars.
 */
function extrairFeature(args: unknown): string {
  const a = (args ?? {}) as { description?: unknown; prompt?: unknown }
  const bruto =
    typeof a.description === "string" && a.description.trim() !== ""
      ? a.description
      : typeof a.prompt === "string"
        ? (a.prompt.split(/\r?\n/)[0] ?? "")
        : ""
  const limpo = bruto.trim().slice(0, MAX_FEATURE_LEN).trim()
  return limpo === "" ? FEATURE_PADRAO : limpo
}

/** Logger aceito pelo runGate (eventos nao-fatais: skip/warn/info). */
type GateLogger = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
) => Promise<void> | void

// ============================================================================
// 3c) TRANSIÇÕES MECANIZADAS (FASE 2 — harness verificável) ==================
// ============================================================================

/**
 * Design doc obrigatório na criação de tarefa: caminho relativo sob
 * docs/plans com data ISO no nome (convenção do projeto). A existência em
 * disco é conferida pelo chamador (existsSync sobre join(rootDir, match)).
 */
const DESIGN_DOC_RE = /docs\/plans\/\d{4}-\d{2}-\d{2}-[a-z0-9\-]+-design\.md/

/**
 * Guarda de commit do code-reviewer: comando git com commit/push (sem passar
 * por encadeamento &/; antes do verbo — evita falso positivo em `echo git &&
 * ls`). `git add/status/diff` NÃO casam (exigem só entrada ativa).
 */
const GIT_COMMIT_PUSH_RE = /\bgit\b[^&;]*\b(commit|push)\b/

/** Pergunta relacionada a commit/push (tool question). */
const PERGUNTA_COMMIT_PUSH_RE = /commit|push/i

/** Resposta/label afirmativo (tool question). */
const RESPOSTA_AFIRMATIVA_RE = /\b(sim|s|commitar|commitar e push|só commitar|aprovar|approve)\b/i

/**
 * Extrai o caminho do design doc dos args da delegação `task`: procura
 * DESIGN_DOC_RE na concatenação de description + prompt. Null se ausente.
 */
function extrairDesignDoc(args: unknown): string | null {
  const a = (args ?? {}) as { description?: unknown; prompt?: unknown }
  const texto = `${typeof a.description === "string" ? a.description : ""}\n${
    typeof a.prompt === "string" ? a.prompt : ""
  }`
  return DESIGN_DOC_RE.exec(texto)?.[0] ?? null
}

/**
 * Parse TOLERANTE do output da tool detect_changes: extrai riskLevel
 * (LOW|MEDIUM|HIGH|CRITICAL|UNKNOWN) e changedCount quando reconhecidos.
 * NUNCA lança — saída não parseável ainda gera {ts} válido (registro mínimo).
 */
function parseDetectChangesReport(raw: unknown): DetectChangesReport {
  const report: DetectChangesReport = { ts: new Date().toISOString() }
  try {
    const texto =
      typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw)
    if (texto !== "") {
      const risk = /\brisk(?:[_ ]?level)?\D{0,15}?\b(low|medium|high|critical|unknown)\b/i.exec(
        texto,
      )
      const riskLevel = risk?.[1]
      if (riskLevel) report.riskLevel = riskLevel.toUpperCase()
      const changed =
        /\b(?:changed(?:[_ ]?count)?|symbols?|s[íi]mbolos?)\D{0,15}?(\d+)\b/i.exec(texto) ??
        /\b(\d+)\s+(?:changed|impacted|symbols?)\b/i.exec(texto)
      const changedRaw = changed?.[1]
      if (changedRaw) {
        const n = Number(changedRaw)
        if (Number.isFinite(n)) report.changedCount = n
      }
    }
  } catch {
    // tolerante: JSON circular etc. — mantém {ts}
  }
  return report
}

/**
 * Decide se a tool `question` aprova mecanicamente o pipeline: ALGUM texto de
 * pergunta casa /commit|push/i E alguma resposta/label selecionado (output ou
 * metadata) casa afirmativo. Parse tolerante — NUNCA lança (args circulares,
 * shapes inesperados => false).
 */
function questionAprovaPipeline(args: unknown, output: unknown): boolean {
  try {
    const perguntas = JSON.stringify(
      (args as { questions?: unknown } | null | undefined)?.questions ?? args ?? "",
    )
    const o = output as { output?: unknown; metadata?: unknown } | null | undefined
    const resposta = [
      typeof o?.output === "string" ? o.output : "",
      JSON.stringify(o?.metadata ?? {}),
    ].join("\n")
    return PERGUNTA_COMMIT_PUSH_RE.test(perguntas) && RESPOSTA_AFIRMATIVA_RE.test(resposta)
  } catch {
    return false
  }
}

/**
 * Roda todos os steps de um gate; joga erro se qualquer um falhar.
 *
 * Guardas nao-bloqueantes (nesta ordem):
 *  1. Bootstrap: sem `package.json` na raiz => warn e return (gate pulado).
 *  2. Compose pos-gate: sem `docker-compose.yml` na raiz => info "[SKIP]" e
 *     segue (compose pulado).
 *  3. Detector impeccable: script ausente => warn "[SKIP]" e segue.
 *
 * FASE 2: `onStepResult` (opcional) recebe um GateResult POR STEP executado
 * (ok ou falha) — o plugin usa para gravar entry.gateResults no registry.
 * O comportamento de throw é preservado: o collector NUNCA influencia a
 * decisão do gate.
 */
function runGate(
  gate: QualityGate,
  cwd: string,
  log: GateLogger,
  onStepResult?: (result: GateResult) => void,
): void {
  // ---------------------------------------------------------------
  // GUARDA DE BOOTSTRAP: projeto pre-scaffold (sem package.json) —
  // nao ha build/teste/cobertura para rodar. Pulamos o gate SEM throw
  // para nao travar o pipeline durante o bootstrap do projeto.
  // ---------------------------------------------------------------
  if (!hasPackageJson(cwd)) {
    void log(
      "warn",
      "[BOOTSTRAP] package.json ausente — quality gate pulado (projeto ainda não scaffoldado)",
    )
    return
  }

  const summary: string[] = []

  for (const step of gate.commands) {
    const res = execGateStep(step, cwd)

    // FASE 2: GateResult por step (ok E falha). detalhe = extrato curto da
    // falha (targets de cobertura ou linhas de erro) ou null no sucesso.
    const detalhe = res.ok
      ? null
      : truncate(
        step.coverageKey
          ? extractFailedCoverageTargets(res.output).join("; ")
          : extractFailures(res.output, gate.failurePatterns, gate.maxFailureLines ?? 40),
        300,
      ) || null
    onStepResult?.({
      step: step.label,
      ok: res.ok,
      exitCode: res.ok ? 0 : res.status,
      ts: new Date().toISOString(),
      detalhe,
    })

    if (res.ok) {
      summary.push(`[OK] ${step.label}`)
      continue
    }

    const header = `[FALHOU] ${step.label} (exit ${res.status})`

    // Step de COBERTURA: a decisao e o exit code (Vitest per-file). Erro
    // preciso com a lista de arquivos abaixo do limite, sem despejar o log
    // cru do comando.
    if (step.coverageKey) {
      const targets = extractFailedCoverageTargets(res.output)
      const threshold = COVERAGE_THRESHOLDS[step.coverageKey] ?? 50
      const detail =
        targets.length > 0
          ? `Arquivos abaixo do limite de ${threshold}%:\n${targets.map((t) => `  - ${t}`).join("\n")}`
          : truncate(
            extractFailures(res.output, gate.failurePatterns, gate.maxFailureLines ?? 40),
            OPTIONS.maxErrorBytes,
          )
      throw new Error(
        `[PIPELINE-ORCHESTRATOR] ${gate.label} FALHOU — corrija o codigo antes de ir para o ${OPTIONS.targetAgent}.\n\n` +
        `CWD: ${cwd}\n\n${header}\n${detail}`,
      )
    }

    // Step de BUILD/TESTE: mantem a extracao de linhas de falha + truncate.
    const failures = extractFailures(res.output, gate.failurePatterns, gate.maxFailureLines ?? 40)
    summary.push(header)
    summary.push("")
    summary.push(truncate(failures, OPTIONS.maxErrorBytes))
    break // para no primeiro passo quebrado (economiza tempo/tokens)
  }

  if (summary.some((l) => l.startsWith("[FALHOU]"))) {
    throw new Error(
      `[PIPELINE-ORCHESTRATOR] ${gate.label} FALHOU — corrija o codigo antes de ir para o ${OPTIONS.targetAgent}.\n\n` +
      `CWD: ${cwd}\n\n${summary.join("\n")}`,
    )
  }

  // ---------------------------------------------------------------
  // GATE APROVADO (todos os steps [OK]): sobe o docker compose com rebuild
  // para atualizar as imagens alteradas — MAS somente se existir
  // `docker-compose.yml` na raiz. Sem o arquivo, loga "[SKIP]" e segue
  // (compose pulado, sem bloqueio). Falha do compose NAO e falha de codigo:
  // o gate ja passou, mas a stack precisa estar de pe antes do reviewer.
  // ---------------------------------------------------------------
  if (OPTIONS.composeUpOnGatePass.enabled) {
    if (!existsSync(join(cwd, "docker-compose.yml"))) {
      void log("info", "[SKIP] docker-compose.yml ausente — compose pulado")
      summary.push("[SKIP] docker-compose.yml ausente — compose pulado")
    } else {
      const composeStep: QualityGateStep = {
        label: "docker compose up -d --build",
        command: OPTIONS.composeUpOnGatePass.command,
        timeoutMs: OPTIONS.composeUpOnGatePass.timeoutMs,
      }
      const res = execGateStep(composeStep, cwd)
      if (res.ok) {
        summary.push("[OK] docker compose up -d --build (imagens atualizadas)")
      } else {
        const header = `[FALHOU] ${composeStep.label} (exit ${res.status})`
        const failures = extractFailures(res.output, gate.failurePatterns, gate.maxFailureLines ?? 40)
        throw new Error(
          `[PIPELINE-ORCHESTRATOR] QUALITY GATE APROVADO mas docker compose FALHOU — corrija a stack antes de ir para o ${OPTIONS.targetAgent}.\n\n` +
          `CWD: ${cwd}\n\n${header}\n${truncate(failures, OPTIONS.maxErrorBytes)}`,
        )
      }
    }
  }

  // ---------------------------------------------------------------
  // DETECTOR IMPECCABLE POS-GATE: revisao de design automatizada.
  // Roda DEPOIS do composeUp (o compose e o comportamento "gate aprovado"
  // existente; o detector e a camada final de revisao de design antes do
  // code-reviewer). Script ausente => skip gracioso com warn. Exit 0 = sem
  // anti-padroes (segue). Exit != 0 (o detector retorna 2 quando acha
  // findings nao-advisory) com blockOnFindings:true => throw (bloqueia a
  // transicao); com false => apenas warn.
  // ---------------------------------------------------------------
  if (OPTIONS.detectorOnGatePass.enabled) {
    const det = OPTIONS.detectorOnGatePass
    // O comando tem a forma "node <scriptPath>" — deriva o path do script
    // para o existsSync (skip gracioso se o impeccable nao estiver presente).
    const detScriptPath = det.command.replace(/^node\s+/, "")
    if (!existsSync(join(cwd, detScriptPath))) {
      void log("warn", `[SKIP] detector impeccable ausente (${detScriptPath}) — detecção de anti-padrões pulada`)
      summary.push(`[SKIP] detector impeccable ausente (${detScriptPath})`)
    } else {
      const allUiFiles = getChangedUiFiles(cwd, det.uiExtensions)
      if (allUiFiles.length === 0) {
        summary.push("[OK] detector: nenhum arquivo UI alterado")
      } else {
        const files = allUiFiles.slice(0, det.maxFiles)
        if (files.length < allUiFiles.length) {
          summary.push(`[OK] detector: ${allUiFiles.length} arquivos UI alterados — escaneando os ${files.length} primeiros (truncado)`)
        }
        // Execucao SEM shell (execFileSync): det.command e parseado em
        // [bin, ...baseArgs] e os filenames entram como argumentos vetoriais.
        // Nada passa por shell => $(), backticks, ";" etc. em filenames nunca
        // sao interpretados (sem injecao via filename). Sem prefixo WSL aqui
        // (execFileSync nao usa shell) — alvo primario: Linux/WSL.
        const res = execDetectorStep(det.command, files, det.timeoutMs, cwd)
        if (res.ok) {
          summary.push("[OK] impeccable detector: sem anti-padroes")
        } else {
          const header = `[FALHOU] impeccable detector (exit ${res.status})`
          const failures = extractFailures(res.output, DETECTOR_FAILURE_PATTERNS, 40)
          if (det.blockOnFindings) {
            throw new Error(
              `[PIPELINE-ORCHESTRATOR] IMPECCABLE DETECTOR encontrou anti-padroes de design — revise antes do ${OPTIONS.targetAgent}.\n\n` +
              `CWD: ${cwd}\n\n${header}\n${truncate(failures, OPTIONS.maxErrorBytes)}`,
            )
          }
          // blockOnFindings:false — apenas avisa (console.warn para ser visivel,
          // ja que runGate e sincrono e o logger pode ser fire-and-forget).
          console.warn(
            `[PIPELINE-ORCHESTRATOR] [WARN] impeccable detector encontrou anti-padroes (blockOnFindings=false):\n` +
            `${header}\n${truncate(failures, OPTIONS.maxErrorBytes)}`,
          )
          summary.push("[WARN] impeccable detector: anti-padroes encontrados (nao bloqueante)")
        }
      }
    }
  }
}

// ============================================================================
// 4) PLUGIN
// ============================================================================

export const PipelineOrchestrator: Plugin = async ({ client, directory }) => {
  const rootDir = directory
  const log = async (level: "debug" | "info" | "warn" | "error", message: string) => {
    try {
      await client.app.log({ body: { service: "pipeline-orchestrator", level, message } })
    } catch {
      // log nunca deve quebrar o fluxo do plugin
    }
  }

  // Estado local: mapeia sessao de subagente -> nome do agente e guarda o
  // ultimo agente dev que concluiu (para rotear o gate na transicao).
  const subagentAgentBySession = new Map<string, string>()
  let lastCompletedGateSource: string | null = null

  /** Descobre o agente ativo de uma sessao (tracker primeiro, SDK depois). */
  const currentAgent = async (sessionID: string): Promise<string | undefined> => {
    const mapped = subagentAgentBySession.get(sessionID)
    if (mapped) return mapped
    try {
      const res = (await client.session.get({ path: { id: sessionID } })) as unknown as { agent?: string }
      return res?.agent
    } catch {
      return undefined
    }
  }

  return {
    /**
     * Rastreia conclusao das tasks de delegacao: registra a sessao criada e
     * o ultimo agente dev que terminou com sucesso (fonte do proximo gate).
     */
    "tool.execute.after": async (input, output) => {
      // ---------------------------------------------------------------
      // (A) Task de delegação concluída: rastreia sessão/agente e marca a
      //     fase correspondente no registry.
      // ---------------------------------------------------------------
      if (input.tool === "task") {
        const subagentType = String((input.args as { subagent_type?: unknown })?.subagent_type ?? "")
        const sessionId = String((output.metadata as { sessionId?: unknown })?.sessionId ?? "")
        if (!subagentType || !sessionId) return

        subagentAgentBySession.set(sessionId, subagentType)

        const finishedOk = /state="completed"/.test(String(output.output ?? ""))
        const isGateSource = QUALITY_GATES.some((g) => g.sourceAgents.includes(subagentType))
        if (finishedOk && isGateSource) {
          lastCompletedGateSource = subagentType
          await log("info", `Task concluida: ${subagentType} — gate sera acionado na transicao`)
        }

        // -------------------------------------------------------------
        // REGISTRY (FASE 1): task do agente terminou COM SUCESSO => marca a
        // fase correspondente como concluida (concluidoEm = agora). Falha de
        // registry NUNCA quebra o fluxo existente: apenas warn.
        // -------------------------------------------------------------
        if (OPTIONS.registryEnabled && finishedOk) {
          const faseNome = AGENTE_PARA_FASE[subagentType]
          if (faseNome) {
            try {
              const sp = join(rootDir, OPTIONS.statePath)
              const arquivo = readRegistry(sp)
              const ativa = getActiveEntry(arquivo)
              if (ativa) {
                const agora = new Date().toISOString()
                // Fase já existe => marca concluida; não existe (ex.: "revisao",
                // que não está nas fases iniciais do createEntry) => anexa como
                // concluída — o registry reflete a execução real.
                const existe = ativa.fases.some((f) => f.nome === faseNome)
                const fases = existe
                  ? ativa.fases.map((f) =>
                    f.nome === faseNome && f.status !== "concluida"
                      ? { ...f, status: "concluida" as const, concluidoEm: agora }
                      : f,
                  )
                  : [
                    ...ativa.fases,
                    {
                      nome: faseNome,
                      agente: subagentType,
                      status: "concluida" as const,
                      iniciadoEm: agora,
                      concluidoEm: agora,
                    },
                  ]
                writeRegistry(sp, updateEntry(arquivo, ativa.taskId, { fases }))
                await log("info", `[REGISTRY] fase "${faseNome}" concluida (${ativa.taskId})`)
              }
            } catch (err) {
              await log(
                "warn",
                `[REGISTRY] falha ao marcar fase "${faseNome}" concluida: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
        }
        return
      }

      // ---------------------------------------------------------------
      // (B) FASE 2 — reviewer→final: tool cujo nome contém detect_changes
      //     executada COM SUCESSO (sem campo error) e entrada ativa =>
      //     grava entry.detectChangesReport (parse tolerante do output).
      //     NUNCA lança: falha de parse/registry vira warn.
      // ---------------------------------------------------------------
      if (
        OPTIONS.registryEnabled &&
        typeof input.tool === "string" &&
        input.tool.includes("detect_changes")
      ) {
        try {
          const erro = (output as { error?: unknown } | null | undefined)?.error
          if (erro == null) {
            const sp = join(rootDir, OPTIONS.statePath)
            const ativa = getActiveEntry(readRegistry(sp))
            if (ativa) {
              const report = parseDetectChangesReport(
                (output as { output?: unknown } | null | undefined)?.output,
              )
              registrarDetectChanges(sp, ativa.taskId, report)
              await log("info", `[REGISTRY] detect_changes registrado (${ativa.taskId})`)
            }
          }
        } catch (err) {
          await log(
            "warn",
            `[REGISTRY] falha ao registrar detect_changes: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        return
      }

      // ---------------------------------------------------------------
      // (C) FASE 2 — aprovação humana MECÂNICA: tool `question` com
      //     pergunta de commit/push respondida afirmativamente => registra
      //     aprovacaoHumana {por:"usuario"}. Parse tolerante, nunca throw.
      // ---------------------------------------------------------------
      if (OPTIONS.registryEnabled && input.tool === "question") {
        try {
          if (questionAprovaPipeline(input.args, output)) {
            const sp = join(rootDir, OPTIONS.statePath)
            const ativa = getActiveEntry(readRegistry(sp))
            if (ativa) {
              aprovar(sp, ativa.taskId, "usuario")
              await log("info", `[REGISTRY] aprovação humana registrada (${ativa.taskId})`)
            }
          }
        } catch (err) {
          await log(
            "warn",
            `[REGISTRY] falha ao registrar aprovação humana: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    },

    /**
     * GATILHO DE TRANSIÇÃO + BLOQUEIO DO REVIEW.
     */
    "tool.execute.before": async (input, output) => {
      // ---------------------------------------------------------------
      // (A) Delegacao p/ o code-reviewer -> roda o quality gate do ultimo
      //     agente dev que concluiu. Falha => throw (bloqueia o review).
      //     Bootstrap (sem package.json na raiz): o proprio runGate pula o
      //     gate com warn — nao bloqueia o fluxo pre-scaffold.
      // ---------------------------------------------------------------
      if (input.tool === "task") {
        const target = String((output.args as { subagent_type?: unknown })?.subagent_type ?? "")

        // -------------------------------------------------------------
        // (A0-a) FASE 2 — ALLOWED TARGETS: bloqueia delegação a qualquer
        //     agente fora da lista ANTES de tocar no registry.
        // -------------------------------------------------------------
        if (target !== "" && !(OPTIONS.allowedTargets as readonly string[]).includes(target)) {
          throw new Error(
            `[PIPELINE-REGISTRY] Delegação bloqueada: target '${target}' não autorizado. ` +
            `Autorizados: ${OPTIONS.allowedTargets.join(", ")}.`,
          )
        }

        // -------------------------------------------------------------
        // (A0-b/c) REGISTRY DO PIPELINE: validação MECÂNICA da pré-condição
        //     de delegação. Roda ANTES do gate.
        //     FASE 2 (dívida W2): a leitura do arquivo tolera state.json
        //     ausente/corrompido (warn + segue como "nenhuma ativa"), mas a
        //     INVARIANTE violada (>1 entradas ativas, detectada por
        //     getActiveEntry) PROPAGA e bloqueia TODA delegação — inclusive
        //     ao dev-frontend — até o state.json ser corrigido manualmente.
        //     Nunca contornamos corrupção lógica com append.
        // -------------------------------------------------------------
        if (OPTIONS.registryEnabled && target !== "") {
          const sp = join(rootDir, OPTIONS.statePath)
          let arquivo: RegistryFile | null = null
          try {
            arquivo = readRegistry(sp)
          } catch (err) {
            await log(
              "warn",
              `[REGISTRY] state.json ausente/inválido (${sp}): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          // FORA do try: invariante violada NUNCA é silenciada.
          const ativa = getActiveEntry(arquivo ?? { versao: 1, tarefas: [] })

          if (target === "dev-frontend") {
            if (!ativa) {
              // FASE 2 — planejamento→dev: criação exige design doc
              // referenciado nos args E existente em disco.
              const designDoc = extrairDesignDoc(output.args)
              if (!designDoc || !existsSync(join(rootDir, designDoc))) {
                throw new Error(
                  `[PIPELINE-REGISTRY] planejamento→dev bloqueado: pré-condição ausente — ` +
                  `design doc aprovado em docs/plans/YYYY-MM-DD-*-design.md referenciado na tarefa.`,
                )
              }
              const entry = createEntry({ feature: extrairFeature(output.args), designDoc })
              writeRegistry(sp, { versao: 1, tarefas: [...(arquivo?.tarefas ?? []), entry] })
              await log("info", `[REGISTRY] tarefa criada: ${entry.taskId} — "${entry.feature}"`)
            }
            // COM entrada ativa: reutiliza (nunca cria segunda).
          } else if (!ativa) {
            throw new Error(
              `[PIPELINE-REGISTRY] Delegação bloqueada: nenhuma tarefa ativa no registry ` +
              `(${OPTIONS.statePath}). Pré-condição: inicie uma tarefa delegando ao dev-frontend.`,
            )
          }
        }

        if (target !== OPTIONS.targetAgent) return

        const source = lastCompletedGateSource
        const gate = source
          ? QUALITY_GATES.find((g) => g.sourceAgents.includes(source))
          : OPTIONS.gateOnUnknownSource
            ? QUALITY_GATES.find((g) => g.sourceAgents.includes("dev-frontend"))
            : undefined

        if (gate) {
          await log("info", `Transicao para ${OPTIONS.targetAgent}: rodando ${gate.label}`)
          try {
            runGate(gate, rootDir, log, (result) => {
              // FASE 2: cada step vira GateResult em entry.gateResults (ok E
              // falha). Falha de registry NUNCA quebra o gate: apenas warn.
              try {
                const sp = join(rootDir, OPTIONS.statePath)
                const arquivo = readRegistry(sp)
                const ativa = getActiveEntry(arquivo)
                if (ativa) registrarGateResult(sp, ativa.taskId, result)
              } catch (err) {
                void log(
                  "warn",
                  `[REGISTRY] falha ao registrar gate result "${result.step}": ${err instanceof Error ? err.message : String(err)}`,
                )
              }
            })
          } finally {
            lastCompletedGateSource = null // nao repetir o mesmo gate sem nova task dev
          }
        } else {
          await log("warn", `Transicao para ${OPTIONS.targetAgent} sem fonte dev rastreada — gate pulado`)
        }
        return
      }

      // ---------------------------------------------------------------
      // (B) `finish` — NAO existe no OpenCode atual. Mantido por seguranca:
      //     se um dia surgir, roda o gate antes de o dev encerrar a task
      //     (com a mesma guarda de bootstrap do runGate).
      // ---------------------------------------------------------------
      if (input.tool === "finish") {
        const agent = await currentAgent(input.sessionID)
        const gate = agent ? QUALITY_GATES.find((g) => g.sourceAgents.includes(agent)) : undefined
        if (gate) {
          await log("info", `Finish do ${agent}: rodando ${gate.label}`)
          runGate(gate, rootDir, log)
        }
        return
      }

      // ---------------------------------------------------------------
      // (D) FASE 2 — GUARDA DE COMMIT DO REVIEWER: `git commit/push` do
      //     code-reviewer exige entrada ativa com detectChangesReport E
      //     aprovacaoHumana (throw nomeando a pré-condição que falta).
      //     Outros comandos git (add/status/diff...) exigem só entrada
      //     ativa. Comandos não-git e outros agentes: intocados.
      //     Invariante violada (>1 ativas) propaga (getActiveEntry lança).
      // ---------------------------------------------------------------
      if (input.tool === "bash" && OPTIONS.registryEnabled) {
        const command = String((output.args as { command?: unknown })?.command ?? "")
        const agent = await currentAgent(input.sessionID)
        if (agent === OPTIONS.targetAgent && command.trim() !== "") {
          const sp = join(rootDir, OPTIONS.statePath)
          let arquivo: RegistryFile | null = null
          try {
            arquivo = readRegistry(sp)
          } catch (err) {
            await log(
              "warn",
              `[REGISTRY] state.json ausente/inválido (${sp}): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          // FORA do try: invariante violada bloqueia (mesma filosofia do task).
          const ativa = getActiveEntry(arquivo ?? { versao: 1, tarefas: [] })

          if (GIT_COMMIT_PUSH_RE.test(command)) {
            if (!ativa) {
              throw new Error(
                `[PIPELINE-REGISTRY] git commit/push bloqueado: nenhuma tarefa ativa no registry ` +
                `(${OPTIONS.statePath}).`,
              )
            }
            if (!ativa.detectChangesReport) {
              throw new Error(
                `[PIPELINE-REGISTRY] git commit/push bloqueado: relatório gitnexus_detect_changes não registrado ` +
                `para a tarefa ativa (${ativa.taskId}). Pré-condição: execute gitnexus_detect_changes antes de commitar.`,
              )
            }
            if (!ativa.aprovacaoHumana) {
              throw new Error(
                `[PIPELINE-REGISTRY] git commit/push bloqueado: aprovação humana não registrada ` +
                `para a tarefa ativa (${ativa.taskId}). Pré-condição: aprove explicitamente via question (commit/push + resposta afirmativa).`,
              )
            }
          } else if (/\bgit\b/.test(command) && !ativa) {
            // git add/status/diff etc.: exige somente entrada ativa.
            throw new Error(
              `[PIPELINE-REGISTRY] Delegação bloqueada: nenhuma tarefa ativa no registry ` +
              `(${OPTIONS.statePath}). Pré-condição: inicie uma tarefa delegando ao dev-frontend.`,
            )
          }
        }
      }

      // ---------------------------------------------------------------
      // (E) BLOQUEIO DE PUSH DESATIVADO: code-reviewer commita e faz push
      //     p/ main após aprovação. Mantido atrás do flag (false) para
      //     reativação fácil.
      // ---------------------------------------------------------------
      if (input.tool === "bash" && OPTIONS.blockGitPushForReviewer) {
        const agent = await currentAgent(input.sessionID)
        if (agent === OPTIONS.targetAgent) {
          const command = String((output.args as { command?: unknown })?.command ?? "")
          if (OPTIONS.gitPushPatterns.some((p) => p.test(command))) {
            throw new Error(
              `[PIPELINE-ORCHESTRATOR] BLOQUEADO: ${OPTIONS.targetAgent} não pode executar "git push". ` +
              `Commit local é permitido após aprovação; push é do autor.`,
            )
          }
        }
      }
    },
  }
}

/**
 * Superfície interna para TESTES unitários (não usar em produção):
 * expõe helpers puros/semi-puros do gate, do registry e as constantes de
 * configuração (somente leitura — tipos Readonly; sem freeze em runtime para
 * permitir que testes alternem flags como detectorOnGatePass.blockOnFindings
 * com restore em try/finally).
 */
export const __internals: {
  // registry (FASE 1)
  readRegistry: typeof readRegistry
  writeRegistry: typeof writeRegistry
  createEntry: typeof createEntry
  getActiveEntry: typeof getActiveEntry
  updateEntry: typeof updateEntry
  // helpers do gate
  resolveCommand: typeof resolveCommand
  execGateStep: typeof execGateStep
  execDetectorStep: typeof execDetectorStep
  extractFailures: typeof extractFailures
  truncate: typeof truncate
  extractFailedCoverageTargets: typeof extractFailedCoverageTargets
  getChangedUiFiles: typeof getChangedUiFiles
  hasPackageJson: typeof hasPackageJson
  runGate: typeof runGate
  extrairFeature: typeof extrairFeature
  MAX_COVERAGE_TARGETS: number
  DETECTOR_FAILURE_PATTERNS: RegExp[]
  // transições mecanizadas (FASE 2)
  extrairDesignDoc: typeof extrairDesignDoc
  parseDetectChangesReport: typeof parseDetectChangesReport
  questionAprovaPipeline: typeof questionAprovaPipeline
  DESIGN_DOC_RE: RegExp
  GIT_COMMIT_PUSH_RE: RegExp
  // constantes de configuração (readonly no nível de tipo)
  readonly QUALITY_GATES: QualityGate[]
  readonly COVERAGE_THRESHOLDS: Record<string, number>
  readonly OPTIONS: typeof OPTIONS
} = {
  readRegistry,
  writeRegistry,
  createEntry,
  getActiveEntry,
  updateEntry,
  resolveCommand,
  execGateStep,
  execDetectorStep,
  extractFailures,
  truncate,
  extractFailedCoverageTargets,
  getChangedUiFiles,
  hasPackageJson,
  runGate,
  extrairFeature,
  MAX_COVERAGE_TARGETS,
  DETECTOR_FAILURE_PATTERNS,
  extrairDesignDoc,
  parseDetectChangesReport,
  questionAprovaPipeline,
  DESIGN_DOC_RE,
  GIT_COMMIT_PUSH_RE,
  QUALITY_GATES,
  COVERAGE_THRESHOLDS,
  OPTIONS,
}

export default PipelineOrchestrator
