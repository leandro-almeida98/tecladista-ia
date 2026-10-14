import { useGameStore } from '../store/gameStore'

/** Play / pause / restart transport controls. */
export default function TransportControls() {
  const isPlaying = useGameStore((s) => s.isPlaying)
  const setPlaying = useGameStore((s) => s.setPlaying)
  const restart = useGameStore((s) => s.restart)
  const hasSong = useGameStore((s) => s.notes.length > 0)

  return (
    <div className="flex items-center gap-2" data-testid="transport-controls">
      <button
        type="button"
        onClick={() => setPlaying(!isPlaying)}
        disabled={!hasSong}
        className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPlaying ? 'Pausar' : 'Tocar'}
      </button>
      <button
        type="button"
        onClick={restart}
        disabled={!hasSong}
        className="rounded bg-zinc-700 px-3 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Reiniciar
      </button>
    </div>
  )
}