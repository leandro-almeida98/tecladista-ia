import { useMemo } from 'react'
import {
  LOWEST_MIDI,
  HIGHEST_MIDI,
  isBlackKey,
  whiteKeyIndex,
  whiteKeyX,
  whiteKeyWidth,
  blackKeyX,
  blackKeyWidth,
  BLACK_KEY_HEIGHT_RATIO,
} from '../lib/noteMath'

interface PianoKeyboardProps {
  activeNotes: Set<number>
  onNoteOn: (midi: number) => void
  onNoteOff: (midi: number) => void
}

/**
 * 61-key virtual keyboard (C2–C7) laid out like a real piano:
 * octave gaps between B and C, black keys centered on the correct white-key
 * boundary, realistic proportions. Lights up held notes; mouse click fallback.
 */
export default function PianoKeyboard({ activeNotes, onNoteOn, onNoteOff }: PianoKeyboardProps) {
  const keys = useMemo(() => {
    const arr: number[] = []
    for (let m = LOWEST_MIDI; m <= HIGHEST_MIDI; m++) arr.push(m)
    return arr
  }, [])

  const whiteKeys = keys.filter((k) => !isBlackKey(k))
  const blackKeys = keys.filter((k) => isBlackKey(k))

  // Layout math in percentages so the keyboard scales with its container and
  // stays proportional to the canvas (which uses the same octave math in px).
  const whiteW = whiteKeyWidth(100)
  const blackW = blackKeyWidth(100)

  return (
    <div className="relative h-28 select-none" data-testid="piano-keyboard">
      {/* White keys: absolute-positioned with octave gaps, subtle divider line. */}
      {whiteKeys.map((m) => {
        const wi = whiteKeyIndex(m)
        const left = whiteKeyX(wi, 100)
        return (
          <button
            key={m}
            type="button"
            data-midi={m}
            aria-label={`Tecla ${m}`}
            onPointerDown={() => onNoteOn(m)}
            onPointerUp={() => onNoteOff(m)}
            onPointerLeave={() => onNoteOff(m)}
            className={`absolute top-0 h-full rounded-b-[2px] border border-black/40 shadow-[inset_-1px_0_0_rgba(0,0,0,0.12)] transition-colors ${
              activeNotes.has(m) ? 'bg-sky-300' : 'bg-white'
            }`}
            style={{ left: `${left}%`, width: `${whiteW}%` }}
          />
        )
      })}
      {/* Black keys: centered on the white-key boundary, narrower and shorter. */}
      {blackKeys.map((m) => {
        const center = blackKeyX(m, 100)
        const left = center - blackW / 2
        return (
          <button
            key={m}
            type="button"
            data-midi={m}
            aria-label={`Tecla ${m}`}
            onPointerDown={() => onNoteOn(m)}
            onPointerUp={() => onNoteOff(m)}
            onPointerLeave={() => onNoteOff(m)}
            className={`absolute top-0 rounded-b-[2px] border border-black/60 transition-colors ${
              activeNotes.has(m) ? 'bg-sky-400' : 'bg-zinc-900'
            }`}
            style={{
              left: `${left}%`,
              width: `${blackW}%`,
              height: `${BLACK_KEY_HEIGHT_RATIO * 100}%`,
            }}
          />
        )
      })}
    </div>
  )
}