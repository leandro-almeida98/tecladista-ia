import { useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { parseMidi } from '../lib/midiParser'

/** File input that parses a .mid and loads it into the game store. */
export default function MidiFileInput() {
  const inputRef = useRef<HTMLInputElement>(null)
  const loadMidi = useGameStore((s) => s.loadMidi)
  const fileName = useGameStore((s) => s.fileName)
  const duration = useGameStore((s) => s.duration)
  const notes = useGameStore((s) => s.notes)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseMidi(buffer)
      if (parsed.notes.length === 0) {
        setError('Nenhuma nota no range de 61 teclas (C2–C7).')
        return
      }
      loadMidi(parsed.notes, parsed.duration, file.name)
      setError(null)
    } catch {
      setError('Arquivo .mid inválido.')
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <input
        ref={inputRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        data-testid="midi-file-input"
        className="text-xs text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-zinc-200 file:hover:bg-zinc-700"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      {fileName && (
        <span className="text-zinc-300" data-testid="midi-file-info">
          {fileName} — {duration.toFixed(1)}s — {notes.length} notas
        </span>
      )}
      {error && (
        <span role="alert" className="text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}