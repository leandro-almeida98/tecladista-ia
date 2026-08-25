import { describe, expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Counter from "./Counter"

describe("Counter", () => {
  test("renderiza com valor inicial 0", () => {
    render(<Counter />)
    expect(screen.getByText("Count: 0")).toBeInTheDocument()
  })

  test("incrementa ao clicar +", async () => {
    const user = userEvent.setup()
    render(<Counter />)
    await user.click(screen.getByRole("button", { name: "+" }))
    expect(screen.getByText("Count: 1")).toBeInTheDocument()
  })

  test("decrementa ao clicar -", async () => {
    const user = userEvent.setup()
    render(<Counter initial={2} />)
    await user.click(screen.getByRole("button", { name: "-" }))
    expect(screen.getByText("Count: 1")).toBeInTheDocument()
  })

  test("não desce abaixo do mínimo padrão (0)", async () => {
    const user = userEvent.setup()
    render(<Counter />)
    await user.click(screen.getByRole("button", { name: "-" }))
    expect(screen.getByText("Count: 0")).toBeInTheDocument()
  })

  test("respeita min customizado", async () => {
    const user = userEvent.setup()
    render(<Counter min={5} initial={5} />)
    await user.click(screen.getByRole("button", { name: "-" }))
    expect(screen.getByText("Count: 5")).toBeInTheDocument()
  })
})