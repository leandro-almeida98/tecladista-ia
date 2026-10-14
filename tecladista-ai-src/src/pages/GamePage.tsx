import FallingNotesCanvas from '../components/FallingNotesCanvas'
import PianoKeyboard from '../components/PianoKeyboard'
import MidiFileInput from '../components/MidiFileInput'
import MidiStatusBadge from '../components/MidiStatusBadge'
import ScorePanel from '../components/ScorePanel'
import TransportControls from '../components/TransportControls'
import { useMidiConnection } from '../hooks/useMidiConnection'
import { useGameStore } from '../store/gameStore'

export default function GamePage() {
  const { status, connectedDeviceName, activeNotes, connect } = useMidiConnection()
  const addActiveNote = useGameStore((s) => s.addActiveNote)
  const removeActiveNote = useGameStore((s) => s.removeActiveNote)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1">
        <h1 className="text-sm font-bold tracking-tight">Tecladista IA</h1>
        <div className="flex items-center gap-2">
          <MidiStatusBadge status={status} deviceName={connectedDeviceName} onReconnect={connect} />
          <MidiFileInput />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1">
        <ScorePanel />
        <TransportControls />
      </div>

      <div className="relative min-h-0 flex-1">
        <FallingNotesCanvas />
      </div>

      <div className="pb-2">
        <PianoKeyboard
          activeNotes={activeNotes}
          onNoteOn={addActiveNote}
          onNoteOff={removeActiveNote}
        />
      </div>

      <footer className="border-t border-zinc-800 px-3 py-0.5 text-[11px] text-zinc-500">
        Use o mouse ou conecte um Casio CT-S300 via MIDI.
      </footer>
    </div>
  )
}