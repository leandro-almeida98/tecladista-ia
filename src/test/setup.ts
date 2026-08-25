import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

// Auto-cleanup do @testing-library/react só registra com globals habilitados.
// Como os testes importam de "vitest" explicitamente (globals: false),
// registramos cleanup manualmente para não acumular DOM entre testes.
afterEach(() => {
  cleanup()
})