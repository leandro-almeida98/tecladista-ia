// Generates e2e/fixtures/test.mid — a small song with 4 notes in the 61-key range.
import pkg from '@tonejs/midi'
const { Midi } = pkg
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = `${__dirname}/../e2e/fixtures`
mkdirSync(outDir, { recursive: true })

const midi = new Midi()
midi.header.setTempo(120)
const track = midi.addTrack()
track.name = 'Test Song'
track.channel = 0

const notes = [
  { midi: 60, time: 0, duration: 0.5, velocity: 100 },
  { midi: 64, time: 0.5, duration: 0.5, velocity: 100 },
  { midi: 67, time: 1.0, duration: 0.5, velocity: 100 },
  { midi: 72, time: 1.5, duration: 0.5, velocity: 100 },
]
for (const n of notes) track.addNote(n)

const data = midi.toArray()
writeFileSync(`${outDir}/test.mid`, Buffer.from(data))
console.log(`Wrote ${outDir}/test.mid (${data.length} bytes)`)