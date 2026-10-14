import { Midi } from '@tonejs/midi'
import type { Note, ParsedMidi } from '../types/midi'
import { LOWEST_MIDI, HIGHEST_MIDI } from './noteMath'

/**
 * Parse a .mid ArrayBuffer into a flat, deduped, time-sorted list of notes
 * restricted to the 61-key range (MIDI 36–96).
 */
export function parseMidi(arrayBuffer: ArrayBuffer): ParsedMidi {
  const midi = new Midi(arrayBuffer)
  const notes: Note[] = []

  for (const track of midi.tracks) {
    for (const note of track.notes) {
      const midiNum = note.midi
      if (midiNum < LOWEST_MIDI || midiNum > HIGHEST_MIDI) continue
      notes.push({
        midi: midiNum,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
        channel: track.channel ?? 0,
      })
    }
  }

  const deduped = dedupeNotes(notes)
  deduped.sort((a, b) => a.time - b.time || a.midi - b.midi)

  return {
    notes: deduped,
    duration: midi.duration,
    ticksPerBeat: midi.header.ppq,
    bpm: midi.header.tempos[0]?.bpm ?? 120,
  }
}

/** Remove simultaneous notes of the same key, keeping the longest duration. */
export function dedupeNotes(notes: Note[]): Note[] {
  const map = new Map<string, Note>()
  for (const n of notes) {
    const key = `${n.midi}:${n.time.toFixed(3)}`
    const existing = map.get(key)
    if (!existing || n.duration > existing.duration) {
      map.set(key, n)
    }
  }
  return [...map.values()]
}