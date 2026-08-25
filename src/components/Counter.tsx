import { useState } from "react"

export interface CounterProps {
  /** Valor mínimo permitido (padrão 0). O contador não desce abaixo dele. */
  min?: number
  /** Valor inicial (padrão 0). */
  initial?: number
}

export default function Counter({ min = 0, initial = 0 }: CounterProps) {
  const [count, setCount] = useState(initial)

  const increment = () => setCount((c) => c + 1)
  const decrement = () => setCount((c) => Math.max(min, c - 1))

  return (
    <div>
      <p aria-live="polite">Count: {count}</p>
      <button type="button" onClick={increment}>
        +
      </button>
      <button type="button" onClick={decrement}>
        -
      </button>
    </div>
  )
}