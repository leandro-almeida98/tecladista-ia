import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    // App (src) roda em jsdom; pipeline (tests/) declara `@vitest-environment node`
    // no topo de cada arquivo (vitest 4 removeu environmentMatchGlobs).
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    // Cobertura consolidada, 95%/arquivo.
    // main.tsx = entry point (excluído); gitnexus-index-refresh.ts = legado
    // fora do escopo do design (FASE 1 = código do pipeline), sem testes próprios.
    coverage: {
      provider: "v8",
      include: ["src/**", ".opencode/plugins/*.ts", ".opencode/pipeline/**/*.ts"],
      exclude: ["src/main.tsx", "**/gitnexus-index-refresh.ts"],
      thresholds: { lines: 95, perFile: true },
    },
  },
})