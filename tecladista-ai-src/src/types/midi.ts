export interface Note {
  /** MIDI note number (36–96 for the 61-key range) */
  midi: number
  /** Start time in seconds */
  time: number
  /** Duration in seconds */
  duration: number
  /** Velocity 0–127 */
  velocity: number
  /** MIDI channel */
  channel: number
}

export interface ParsedMidi {
  notes: Note[]
  /** Total song duration in seconds */
  duration: number
  ticksPerBeat: number
  bpm: number
}