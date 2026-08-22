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

/** Uma tarefa do pipeline (uma feature). */
export interface RegistryEntry {
  taskId: string
  feature: string
  fases: PipelineFase[]
  gateResults: GateResult[]
  retries: number
  aprovacaoHumana: AprovacaoHumana | null
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

  if (typeof e.retries !== "number" || !Number.isInteger(e.retries) || e.retries < 0) {
    throw new Error('[PIPELINE-REGISTRY] Campo inválido: "retries" deve ser inteiro >= 0.')
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
 *   - gateResults [], retries 0, aprovacaoHumana null.
 * `now` injetável para testes determinísticos.
 */
export function createEntry(input: { feature: string; now?: Date }): RegistryEntry {
  const nowIso = (input.now ?? new Date()).toISOString()
  const taskId = `${slugify(input.feature)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  return {
    taskId,
    feature: input.feature,
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
    aprovacaoHumana: null,
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
