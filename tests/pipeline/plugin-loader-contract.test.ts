/**
 * ============================================================================
 * plugin-loader-contract.test.ts
 * ============================================================================
 * Contrato de carregamento dos plugins pelo OpenCode.
 *
 * O loader do opencode (v1.x) descobre arquivos via glob
 * `{plugin,plugins}/*.{ts,js}` e valida TODA export do módulo com o
 * equivalente a:
 *
 *   isValid = (v) => typeof v === "function"
 *                || (v && typeof v === "object" && "server" in v
 *                    && typeof v.server === "function")
 *
 * Se qualquer export falhar => TypeError("Plugin export is not a function")
 * e o plugin NÃO carrega (erro "failed to load plugin" no log).
 *
 * Estes testes existem porque `pipeline-orchestrator.ts` já quebrou esse
 * contrato ao exportar `__internals` (objeto puro de superfície de teste)
 * junto do plugin — o opencode recusava o arquivo inteiro. A implementação
 * real vive em `.opencode/pipeline/orchestrator-impl.ts` (fora do glob);
 * o arquivo em `.opencode/plugins/` é wrapper só com exports-função.
 * ============================================================================
 */
import { readdirSync } from "node:fs"
import { describe, expect, test } from "vitest"

/** Diretório escaneado pelo glob `{plugin,plugins}/*.{ts,js}` do opencode. */
const PLUGINS_DIR = new URL("../../.opencode/plugins/", import.meta.url)

/**
 * Predicado EXATO do validador de exports do loader do opencode:
 * função solta OU objeto { server: função } (plugin com parte de servidor).
 */
function exportValidaComoPlugin(valor: unknown): boolean {
  if (typeof valor === "function") return true
  if (
    valor != null &&
    typeof valor === "object" &&
    "server" in valor &&
    typeof (valor as { server: unknown }).server === "function"
  ) {
    return true
  }
  return false
}

describe("contrato do loader de plugins do opencode", () => {
  test("deveDescobrirOsArquivosDePlugin_quandoEscaneiaDiretorioPlugins", () => {
    const arquivos = readdirSync(PLUGINS_DIR).filter((f) => /\.ts$/.test(f))
    expect(arquivos).toContain("pipeline-orchestrator.ts")
    expect(arquivos).toContain("gitnexus-index-refresh.ts")
  })

  test("deveTerSomenteExportsValidos_quandoOpencodeValidaCadaModuloDePlugin", async () => {
    const arquivos = readdirSync(PLUGINS_DIR).filter((f) => /\.ts$/.test(f))
    expect(arquivos.length).toBeGreaterThan(0)

    const invalidos: string[] = []
    for (const arquivo of arquivos) {
      const modulo = await import(new URL(arquivo, PLUGINS_DIR).href)
      for (const [nome, valor] of Object.entries(modulo)) {
        // `default` compartilha a referência do plugin nomeado (dedup do
        // loader por Set) — valida igualmente como qualquer outra export.
        if (!exportValidaComoPlugin(valor)) invalidos.push(`${arquivo}#${nome}`)
      }
    }

    expect(invalidos).toEqual([])
  })

  test("deveRegistrarInstanciaUnica_quandoDefaultReexportaOPluginNomeado", async () => {
    const orquestrador = await import("../../.opencode/plugins/pipeline-orchestrator")
    expect(orquestrador.default).toBe(orquestrador.PipelineOrchestrator)

    const refresh = await import("../../.opencode/plugins/gitnexus-index-refresh")
    expect(refresh.default).toBe(refresh.GitnexusIndexRefresh)
  })
})
