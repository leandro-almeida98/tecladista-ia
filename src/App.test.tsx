import { describe, expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import App from "./App"

describe("App", () => {
  test("renderiza título e Counter", () => {
    render(<App />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Tecladista IA",
    )
    expect(screen.getByText("Count: 0")).toBeInTheDocument()
  })
})