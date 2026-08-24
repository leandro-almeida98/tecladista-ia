/**
 * ============================================================================
 * pipeline-orchestrator.ts (wrapper de plugin)
 * ============================================================================
 * PONTO DE ENTRADA do plugin para o loader do opencode. A implementacao
 * completa vive em `.opencode/pipeline/orchestrator-impl.ts` — leia o
 * cabecalho dela para comportamento, configuracao (QUALITY_GATES / OPTIONS)
 * e a justificativa desta divisao.
 *
 * CONTRATO DO LOADER (por que este arquivo e minimo)
 *  - O opencode descobre `{plugin,plugins}/*.{ts,js}` e exige que TODA export
 *    do modulo seja funcao OU {server: funcao}; exports invalidas derrubam o
 *    plugin com TypeError "Plugin export is not a function".
 *  - Portanto aqui existem SOMENTE exports-funcao: `PipelineOrchestrator`
 *    nomeado + `default` apontando para a MESMA referencia (o loader dedup
 *    por identidade => uma unica instancia registrada).
 *  - `__internals` (superficie de teste) fica no modulo de implementacao,
 *    fora do glob — importe de `../pipeline/orchestrator-impl`.
 *
 * Regressao: tests/pipeline/plugin-loader-contract.test.ts valida este
 * contrato contra o diretorio real de plugins.
 * ============================================================================
 */

import { PipelineOrchestrator } from "../pipeline/orchestrator-impl.ts"

export { PipelineOrchestrator }
export default PipelineOrchestrator
