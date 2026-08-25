/**
 * ============================================================================
 * registry.ts — Registry persistido do pipeline (FASE 1, harness verificável)
 * ============================================================================
 * Estado mecânico do pipeline multi-agente em `.opencode/pipeline/state.json`.
 * O plugin `pipeline-orchestrator.ts` usa este módulo para:
 *   - criar a entrada da tarefa quando o orquestrador delega ao dev-frontend;
 *   - bloquear mecanicamente delegações sem tarefa ativa (pré-condição);
 *   - marcar fases como concluídas quando as tasks terminam.
 *
 * MÓDULO PURO: sem dependência do SDK do opencode; usa fs real (síncrono).
 * Escrita ATÔMICA: tmp no mesmo diretório + rename (nunca deixa state.json
 * pela metade; em falha de rename o arquivo original permanece intacto).
 * ============================================================================
 */

import * as fs from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

// ============================================================================
// TIPOS
// ============================================================================

export type FaseStatus =
  | "pendente"
  | "em_andamento"
  | "concluida"
  | "bloqueada"
  | "escala_humano"

const FASE_STATUSES: readonly FaseStatus[] = [
  "pendente",
  "em_andamento",
  "concluida",
  "bloqueada",
  "escala_humano",
]

/** Uma fase do pipeline 5 fases (planejamento/desenvolvimento/revisao/commit). */
export interface PipelineFase {
  nome: string
  agente: string
  status: FaseStatus
  /** ISO 8601. */
  iniciadoEm: string
  /** ISO 8601 ou null enquanto não concluída. */
  concluidoEm: string | null
}

/** Registro de uma execução de quality gate. */
export interface GateResult {
  step: string
  ok: boolean
  exitCode: number | null
  ts: string
  detalhe: string | null
}

/** Aprovação humana explícita (Fase 5 — commit). */
export interface AprovacaoHumana {
  por: string
  em: string
}

/**
 * Relatório tolerante do `gitnexus_detect_changes` (FASE 2 — revisão):
 * `ts` obrigatório; `riskLevel`/`changedCount` opcionais (extração do output
 * pode falhar sem invalidar o registro).
 */
export interface DetectChangesReport {
  ts: string
  riskLevel?: string
  changedCount?: number
}

/**
 * Um ciclo de retry do quality gate (FASE 3): cada falha de gate appenda um
 * item. `modo` reflete o que aconteceu: "auto" (spawn SDK bem-sucedido) ou
 * "orquestrador" (fallback de re-delegação manual / escala humana).
 * `sessionId` presente só quando houve spawn automático.
 */
export interface RetryHistoryItem {
  ts: string
  motivo: string
  modo: "auto" | "orquestrador"
  sessionId?: string
}

/** Uma tarefa do pipeline (uma feature). */
export interface RegistryEntry {
  taskId: string
  feature: string
  /** Design doc aprovado que originou a tarefa (FASE 2); null p/ legado. */
  designDoc: string | null
  fases: PipelineFase[]
  gateResults: GateResult[]
  retries: number
  /** Histórico de ciclos de retry do gate (FASE 3); [] na criação. */
  retryHistory: RetryHistoryItem[]
  aprovacaoHumana: AprovacaoHumana | null
  /** Relatório detect_changes registrado na revisão (FASE 2); null até lá. */
  detectChangesReport: DetectChangesReport | null
  /**
   * Última fonte de gate conhecida (FIX 3 — SOURCE UNKNOWN): agente dev que
   * disparou o último gate desta tarefa. Persistido para servir de fallback
   * quando a memória do plugin (lastCompletedGateSource) estiver vazia — ex.:
   * sessão de correção spawnada via SDK que não passa pela tool `task`.
   * null quando nunca houve gate. Tolerante a legado (undefined/null).
   */
  lastGateSource: string | null
}

/** Formato do state.json em disco. */
export interface RegistryFile {
  versao: 1
  tarefas: RegistryEntry[]
}

// ============================================================================
// DEFINIÇÃO DE "ENTRADA ATIVA" (invariante de entrada única)
// ============================================================================

/**
 * ENTRADA ATIVA — definição canônica:
 *
 * Uma entrada é ATIVA quando NENHUMA de suas fases é FINAL. Fase final é:
 *   - a fase "commit" com status "concluida" (pipeline terminou com sucesso), OU
 *   - qualquer fase com status "escala_humano" (parou para decisão humana —
 *     retomada só após intervenção, que move o status para fora do final).
 *
 * Enquanto ativa, a entrada é a ÚNICA permitida no registry: o plugin cria
 * uma ao delegar ao dev-frontend e bloqueia delegações a outros agentes se
 * nenhuma existir.
 */
export function isActive(entry: RegistryEntry): boolean {
  return !entry.fases.some(
    (f) => f.status === "escala_humano" || (f.nome === "commit" && f.status === "concluida"),
  )
}

// ============================================================================
// VALIDAÇÃO
// ============================================================================

function assertNonEmptyString(value: unknown, campo: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[PIPELINE-REGISTRY] Campo inválido: "${campo}" deve ser string não vazia.`)
  }
}

/**
 * Valida uma entrada contra o schema. Lança Error com mensagem clara
 * (prefixo [PIPELINE-REGISTRY]) em qualquer violação. Retorna void.
 */
export function validateEntry(entry: unknown): void {
  if (entry == null || typeof entry !== "object") {
    throw new Error("[PIPELINE-REGISTRY] Entrada deve ser um objeto.")
  }
  const e = entry as Record<string, unknown>

  assertNonEmptyString(e.taskId, "taskId")
  assertNonEmptyString(e.feature, "feature")

  if (!Array.isArray(e.fases)) {
    throw new Error('[PIPELINE-REGISTRY] Campo inválido: "fases" deve ser array.')
  }
  for (const fase of e.fases) {
    if (fase == null || typeof fase !== "object") {
      throw new Error('[PIPELINE-REGISTRY] Cada fase deve ser um objeto.')
    }
    const f = fase as Record<string, unknown>
    assertNonEmptyString(f.nome, "fases[].nome")
    assertNonEmptyString(f.agente, "fases[].agente")
    if (!FASE_STATUSES.includes(f.status as FaseStatus)) {
      throw new Error(
        `[PIPELINE-REGISTRY] Campo inválido: "status" da fase "${String(f.nome)}" ` +
        `fora do enum (${FASE_STATUSES.join("|")}).`,
      )
    }
    assertNonEmptyString(f.iniciadoEm, "fases[].iniciadoEm")
    if (f.concluidoEm !== null && typeof f.concluidoEm !== "string") {
      throw new Error('[PIPELINE-REGISTRY] Campo inválido: "concluidoEm" deve ser string ou null.')
    }
  }

  if (!Array.isArray(e.gateResults)) {
    throw new Error('[PIPELINE-REGISTRY] Campo inválido: "gateResults" deve ser array.')
  }
  for (const gate of e.gateResults) {
    if (gate == null || typeof gate !== "object") {
      throw new Error('[PIPELINE-REGISTRY] Campo inválido: cada item de "gateResults" deve ser um objeto.')
    }
    const g = gate as Record<string, unknown>
    assertNonEmptyString(g.step, "gateResults[].step")
    if (typeof g.ok !== "boolean") {
      throw new Error('[PIPELINE-REGISTRY] Campo inválido: "gateResults[].ok" deve ser boolean.')
    }
    if (g.exitCode !== null && (typeof g.exitCode !== "number" || !Number.isInteger(g.exitCode))) {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "gateResults[].exitCode" deve ser inteiro ou null.',
      )
    }
    assertNonEmptyString(g.ts, "gateResults[].ts")
    if (g.detalhe !== null && typeof g.detalhe !== "string") {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "gateResults[].detalhe" deve ser string ou null.',
      )
    }
  }

  if (typeof e.retries !== "number" || !Number.isInteger(e.retries) || e.retries < 0) {
    throw new Error('[PIPELINE-REGISTRY] Campo inválido: "retries" deve ser inteiro >= 0.')
  }

  // FASE 3: retryHistory — undefined/null tolerados por compatibilidade com
  // entradas da FASE 1/2 já persistidas em disco; itens validados quando há.
  if (e.retryHistory !== undefined && e.retryHistory !== null) {
    if (!Array.isArray(e.retryHistory)) {
      throw new Error('[PIPELINE-REGISTRY] Campo inválido: "retryHistory" deve ser array.')
    }
    for (const item of e.retryHistory) {
      if (item == null || typeof item !== "object") {
        throw new Error('[PIPELINE-REGISTRY] Campo inválido: cada item de "retryHistory" deve ser um objeto.')
      }
      const r = item as Record<string, unknown>
      assertNonEmptyString(r.ts, "retryHistory[].ts")
      assertNonEmptyString(r.motivo, "retryHistory[].motivo")
      if (r.modo !== "auto" && r.modo !== "orquestrador") {
        throw new Error(
          '[PIPELINE-REGISTRY] Campo inválido: "retryHistory[].modo" deve ser "auto" ou "orquestrador".',
        )
      }
      if (r.sessionId !== undefined && typeof r.sessionId !== "string") {
        throw new Error(
          '[PIPELINE-REGISTRY] Campo inválido: "retryHistory[].sessionId" deve ser string.',
        )
      }
    }
  }

  // FASE 2: designDoc — string não vazia ou null. `undefined` tolerado por
  // compatibilidade com entradas da FASE 1 já persistidas em disco.
  if (e.designDoc !== undefined && e.designDoc !== null) {
    assertNonEmptyString(e.designDoc, "designDoc")
  }

  if (e.aprovacaoHumana !== null) {
    if (e.aprovacaoHumana == null || typeof e.aprovacaoHumana !== "object") {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "aprovacaoHumana" deve ser null ou {por, em}.',
      )
    }
    const a = e.aprovacaoHumana as Record<string, unknown>
    assertNonEmptyString(a.por, "aprovacaoHumana.por")
    assertNonEmptyString(a.em, "aprovacaoHumana.em")
  }

  // FASE 2: detectChangesReport — null/undefined (legado) ou {ts, riskLevel?,
  // changedCount?}. Campos opcionais validados SOMENTE quando presentes.
  if (e.detectChangesReport !== undefined && e.detectChangesReport !== null) {
    if (typeof e.detectChangesReport !== "object") {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "detectChangesReport" deve ser null ou {ts, riskLevel?, changedCount?}.',
      )
    }
    const d = e.detectChangesReport as Record<string, unknown>
    assertNonEmptyString(d.ts, "detectChangesReport.ts")
    if (d.riskLevel !== undefined && typeof d.riskLevel !== "string") {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "detectChangesReport.riskLevel" deve ser string.',
      )
    }
    if (
      d.changedCount !== undefined &&
      (typeof d.changedCount !== "number" || !Number.isInteger(d.changedCount) || d.changedCount < 0)
    ) {
      throw new Error(
        '[PIPELINE-REGISTRY] Campo inválido: "detectChangesReport.changedCount" deve ser inteiro >= 0.',
      )
    }
  }

  // FIX 3: lastGateSource — string não vazia ou null. `undefined` tolerado por
  // compatibilidade com entradas legadas já persistidas em disco.
  if (e.lastGateSource !== undefined && e.lastGateSource !== null) {
    assertNonEmptyString(e.lastGateSource, "lastGateSource")
  }
}

// ============================================================================
// LEITURA / ESCRITA ATÔMICA
// ============================================================================

/**
 * Lê e valida o state.json. Lança erro claro se ausente, JSON inválido ou
 * versão desconhecida (evita corromper estado com formato futuro).
 */
export function readRegistry(statePath: string): RegistryFile {
  if (!fs.existsSync(statePath)) {
    throw new Error(
      `[PIPELINE-REGISTRY] state.json ausente em ${statePath} — nenhuma tarefa foi iniciada.`,
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(statePath, "utf-8"))
  } catch (err) {
    throw new Error(`[PIPELINE-REGISTRY] state.json inválido (${statePath}): JSON malformado.`, {
      cause: err,
    })
  }
  const file = raw as { versao?: unknown; tarefas?: unknown }
  if (file.versao !== 1 || !Array.isArray(file.tarefas)) {
    throw new Error(
      `[PIPELINE-REGISTRY] state.json com versão/formato desconhecido em ${statePath} ` +
      `(esperado {versao: 1, tarefas: []}).`,
    )
  }
  return file as unknown as RegistryFile
}

/**
 * Escrita ATÔMICA: serializa para um arquivo temporário NO MESMO diretório
 * (mesmo filesystem => rename é atômico) e renomeia por cima do destino.
 * Em sucesso não sobra temporário; em falha de rename o original permanece
 * intacto e o temporário é removido. Valida todas as entradas antes de gravar.
 */
export function writeRegistry(statePath: string, data: RegistryFile): void {
  for (const tarefa of data.tarefas) validateEntry(tarefa)

  fs.mkdirSync(dirname(statePath), { recursive: true })
  const tmp = `${statePath}.tmp-${process.pid}-${randomUUID()}`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8")
  try {
    fs.renameSync(tmp, statePath)
  } catch (err) {
    // Falha no rename: original intacto; limpa o temporário e propaga.
    try {
      fs.unlinkSync(tmp)
    } catch {
      // best-effort
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// ============================================================================
// CRIAÇÃO / CONSULTA / ATUALIZAÇÃO
// ============================================================================

/** Slug ASCII para o taskId: minúsculo, sem acentos, só [a-z0-9-], máx 40. */
function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
  return slug === "" ? "tarefa" : slug
}

/**
 * Cria uma nova entrada de tarefa:
 *   - taskId = `<slug-da-feature>-<timestamp base36>-<8 hex>` (único);
 *   - fases iniciais: planejamento/concluida + desenvolvimento/em_andamento;
 *   - gateResults [], retries 0, aprovacaoHumana null;
 *   - designDoc informado (FASE 2) ou null; detectChangesReport null.
 * `now` injetável para testes determinísticos.
 */
export function createEntry(input: {
  feature: string
  designDoc?: string
  now?: Date
}): RegistryEntry {
  const nowIso = (input.now ?? new Date()).toISOString()
  const taskId = `${slugify(input.feature)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  return {
    taskId,
    feature: input.feature,
    designDoc: input.designDoc ?? null,
    fases: [
      {
        nome: "planejamento",
        agente: "orquestrador",
        status: "concluida",
        iniciadoEm: nowIso,
        concluidoEm: nowIso,
      },
      {
        nome: "desenvolvimento",
        agente: "dev-frontend",
        status: "em_andamento",
        iniciadoEm: nowIso,
        concluidoEm: null,
      },
    ],
    gateResults: [],
    retries: 0,
    retryHistory: [],
    aprovacaoHumana: null,
    detectChangesReport: null,
    lastGateSource: null,
  }
}

/**
 * Retorna a única entrada ativa do registry (ver JSDoc de isActive):
 * zero ativas => null; mais de uma => lança (invariante quebrada nunca é
 * silenciada — indica corrupção manual do state.json).
 */
export function getActiveEntry(registryFile: RegistryFile): RegistryEntry | null {
  const ativas = registryFile.tarefas.filter(isActive)
  if (ativas.length === 0) return null
  if (ativas.length > 1) {
    throw new Error(
      `[PIPELINE-REGISTRY] Invariante violada: ${ativas.length} entradas ativas no registry ` +
      `(esperado no máximo 1): ${ativas.map((t) => t.taskId).join(", ")}. Corrija o state.json.`,
    )
  }
  return ativas[0] ?? null
}

/**
 * Aplica patch raso na entrada com o taskId informado SEM mutar o original
 * (retorna novo RegistryFile). Persistência fica por conta do chamador:
 * `writeRegistry(statePath, updateEntry(...))`. Lança se taskId inexistente.
 */
export function updateEntry(
  registryFile: RegistryFile,
  taskId: string,
  patch: Partial<Omit<RegistryEntry, "taskId">>,
): RegistryFile {
  const index = registryFile.tarefas.findIndex((t) => t.taskId === taskId)
  if (index === -1) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  const tarefas = registryFile.tarefas.map((t, i) =>
    i === index ? { ...t, ...patch } : t,
  )
  return { ...registryFile, tarefas }
}

// ============================================================================
// HELPERS DE TRANSIÇÃO (FASE 2 — todos persistem via writeRegistry)
// ============================================================================

/**
 * Anexa um GateResult à entrada `taskId` e persiste. A validação de shape
 * acontece no writeRegistry (antes de qualquer escrita em disco): resultado
 * inválido lança e mantém o arquivo original intacto.
 */
export function registrarGateResult(
  statePath: string,
  taskId: string,
  result: GateResult,
): void {
  const arquivo = readRegistry(statePath)
  const entry = arquivo.tarefas.find((t) => t.taskId === taskId)
  if (!entry) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  writeRegistry(
    statePath,
    updateEntry(arquivo, taskId, { gateResults: [...entry.gateResults, result] }),
  )
}

/**
 * Grava (ou sobrescreve — última escrita vence) o relatório detect_changes da
 * entrada `taskId` e persiste.
 */
export function registrarDetectChanges(
  statePath: string,
  taskId: string,
  report: DetectChangesReport,
): void {
  const arquivo = readRegistry(statePath)
  writeRegistry(statePath, updateEntry(arquivo, taskId, { detectChangesReport: report }))
}

/**
 * FINALIZA a entrada `taskId` (fix atribuição por design doc): anexa a fase
 * "commit" com status "concluida" (agente "orquestrador", iniciadoEm =
 * concluidoEm = agora) — fase FINAL => a entrada deixa de ser ativa (isActive
 * false) e não contamina mais a atribuição de métricas de features futuras.
 *
 * IDEMPOTENTE: se a entrada já tem uma fase "commit" concluída, não duplica
 * (retorna sem escrever). Persiste via writeRegistry. Lança se taskId
 * inexistente.
 */
export function finalizarEntrada(statePath: string, taskId: string): void {
  const arquivo = readRegistry(statePath)
  const entry = arquivo.tarefas.find((t) => t.taskId === taskId)
  if (!entry) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  const jaTemCommitConcluido = entry.fases.some(
    (f) => f.nome === "commit" && f.status === "concluida",
  )
  if (jaTemCommitConcluido) return
  const agora = new Date().toISOString()
  writeRegistry(
    statePath,
    updateEntry(arquivo, taskId, {
      fases: [
        ...entry.fases,
        {
          nome: "commit",
          agente: "orquestrador",
          status: "concluida" as const,
          iniciadoEm: agora,
          concluidoEm: agora,
        },
      ],
    }),
  )
}

/**
 * Registra aprovação humana explícita (`{por, em: agora}`) na entrada `taskId`
 * e persiste. Usado pelo after-hook da tool `question` (por: "usuario") ou por
 * registro manual do orquestrador.
 */
export function aprovar(statePath: string, taskId: string, por: string): void {
  const arquivo = readRegistry(statePath)
  writeRegistry(
    statePath,
    updateEntry(arquivo, taskId, { aprovacaoHumana: { por, em: new Date().toISOString() } }),
  )
}

// ============================================================================
// HELPERS DE RETRY (FASE 3 — loop de auto-correção; persistem via writeRegistry)
// ============================================================================

/**
 * Appenda um ciclo de retry ao `retryHistory` da entrada `taskId` E incrementa
 * `retries`, persistindo. O shape do item é validado no writeRegistry (antes de
 * qualquer escrita): item inválido lança e mantém o arquivo original intacto.
 */
export function registrarRetry(
  statePath: string,
  taskId: string,
  input: { motivo: string; modo: "auto" | "orquestrador"; sessionId?: string },
): void {
  const arquivo = readRegistry(statePath)
  const entry = arquivo.tarefas.find((t) => t.taskId === taskId)
  if (!entry) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  const item: RetryHistoryItem = {
    ts: new Date().toISOString(),
    motivo: input.motivo,
    modo: input.modo,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  }
  writeRegistry(
    statePath,
    updateEntry(arquivo, taskId, {
      retryHistory: [...(entry.retryHistory ?? []), item],
      retries: entry.retries + 1,
    }),
  )
}

/**
 * Escala a entrada `taskId` para intervenção humana:
 *   - marca a fase atual (em_andamento) com status "escala_humano" — ou anexa
 *     uma fase "desenvolvimento" escalada se nenhuma estiver em andamento;
 *   - registra o `motivo` como último item do retryHistory (modo
 *     "orquestrador") e incrementa `retries` (a escala conta como tentativa).
 * Fase final => entrada deixa de ser ativa (isActive) e delegações permanecem
 * bloqueadas até intervenção humana mover o status para fora do final.
 */
export function escalarHumano(statePath: string, taskId: string, motivo: string): void {
  const arquivo = readRegistry(statePath)
  const entry = arquivo.tarefas.find((t) => t.taskId === taskId)
  if (!entry) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  const agora = new Date().toISOString()
  const alvo = entry.fases.find((f) => f.status === "em_andamento")
  const fases = alvo
    ? entry.fases.map((f) =>
        f === alvo ? { ...f, status: "escala_humano" as const } : f,
      )
    : [
        ...entry.fases,
        {
          nome: "desenvolvimento",
          agente: "dev-frontend",
          status: "escala_humano" as const,
          iniciadoEm: agora,
          concluidoEm: null,
        },
      ]
  writeRegistry(
    statePath,
    updateEntry(arquivo, taskId, {
      fases,
      retries: entry.retries + 1,
      retryHistory: [
        ...(entry.retryHistory ?? []),
        { ts: agora, motivo, modo: "orquestrador" },
      ],
    }),
  )
}

/**
 * Zera `retries` da entrada `taskId` (chamado quando o gate passa). O
 * `retryHistory` é PRESERVADO — histórico completo de ciclos não se apaga.
 */
export function resetarRetries(statePath: string, taskId: string): void {
  const arquivo = readRegistry(statePath)
  if (!arquivo.tarefas.some((t) => t.taskId === taskId)) {
    throw new Error(`[PIPELINE-REGISTRY] taskId não encontrado no registry: ${taskId}`)
  }
  writeRegistry(statePath, updateEntry(arquivo, taskId, { retries: 0 }))
}
