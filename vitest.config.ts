import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [".opencode/plugins/*.ts", ".opencode/pipeline/**/*.ts"],
      // Legado fora do escopo do design (FASE 1 = código do pipeline):
      // gitnexus-index-refresh.ts não é pipeline; sem testes próprios.
      exclude: ["**/gitnexus-index-refresh.ts"],
      thresholds: {
        lines: 95,
        perFile: true,
      },
    },
  },
})
