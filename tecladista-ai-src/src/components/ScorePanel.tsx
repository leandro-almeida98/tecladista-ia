import { useGameStore } from '../store/gameStore'

/** Live score, combo, accuracy and last judgment. */
export default function ScorePanel() {
  const score = useGameStore((s) => s.score)
  const combo = useGameStore((s) => s.combo)
  const accuracy = useGameStore((s) => s.accuracy)
  const lastJudgment = useGameStore((s) => s.lastJudgment)
  const perfectCount = useGameStore((s) => s.perfectCount)
  const goodCount = useGameStore((s) => s.goodCount)
  const missCount = useGameStore((s) => s.missCount)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" data-testid="score-panel">
      <span>
        Score <strong className="text-zinc-50">{score}</strong>
      </span>
      <span>
        Combo <strong className="text-zinc-50">{combo}</strong>
      </span>
      <span>
        Accuracy <strong className="text-zinc-50">{accuracy.toFixed(1)}%</strong>
      </span>
      <span className="text-emerald-400">{perfectCount} Perfect</span>
      <span className="text-amber-400">{goodCount} Good</span>
      <span className="text-red-400">{missCount} Miss</span>
      <span>
        Último:{' '}
        <strong className="text-zinc-50">{lastJudgment ?? '—'}</strong>
      </span>
    </div>
  )
}