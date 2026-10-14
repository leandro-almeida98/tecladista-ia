/** Minimal Web MIDI API type declarations (not in TS DOM lib by default). */

interface MIDIMessageEvent extends Event {
  data: Uint8Array
}

interface MIDIInput {
  name: string | null
  onmidimessage: ((e: MIDIMessageEvent) => void) | null
}

interface MIDIInputMap {
  values(): IterableIterator<MIDIInput>
}

interface MIDIAccess {
  inputs: MIDIInputMap
  onstatechange: (() => void) | null
}

interface Navigator {
  requestMIDIAccess(): Promise<MIDIAccess>
}