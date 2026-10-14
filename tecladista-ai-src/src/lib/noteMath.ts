/** Pure math for mapping MIDI notes to the 61-key virtual keyboard and canvas. */

export const LOWEST_MIDI = 36
export const HIGHEST_MIDI = 96
export const NUM_KEYS = 61
/** Seconds a note takes to fall from the top to the hit line. */
export const FALL_SECONDS = 2

/** White keys per octave (C–B). */
export const WHITE_KEYS_PER_OCTAVE = 7
/** Octave gap as a fraction of a single white key's width (B→C separation). */
export const OCTAVE_GAP_RATIO = 0.15
/** Black key width as a fraction of a white key's width. */
export const BLACK_KEY_WIDTH_RATIO = 0.6
/** Black key height as a fraction of the keyboard height. */
export const BLACK_KEY_HEIGHT_RATIO = 0.62

const BLACK_PATTERN = new Set([1, 3, 6, 8, 10])

/** True when the MIDI note is a black key (C#/D#/F#/G#/A#). */
export function isBlackKey(midi: number): boolean {
  return BLACK_PATTERN.has(midi % 12)
}

/** 0-based index of the key within the 61-key range (C2 = 0 … C7 = 60). */
export function midiToKeyIndex(midi: number): number {
  return midi - LOWEST_MIDI
}

/** Number of white keys strictly below the given MIDI note. */
export function whiteKeyIndex(midi: number): number {
  let count = 0
  for (let m = LOWEST_MIDI; m < midi; m++) {
    if (!isBlackKey(m)) count++
  }
  return count
}

/** Total number of white keys in the 61-key range. */
export function totalWhiteKeys(): number {
  let count = 0
  for (let m = LOWEST_MIDI; m <= HIGHEST_MIDI; m++) {
    if (!isBlackKey(m)) count++
  }
  return count
}

/**
 * Number of octave gaps in the 61-key range (C2–C7).
 * Each full octave (C2–C6) ends on B and is followed by a gap before the next C.
 */
export function numOctaveGaps(): number {
  return Math.floor(totalWhiteKeys() / WHITE_KEYS_PER_OCTAVE)
}

/**
 * Width (px) of a single white key, distributing the total width across all
 * white keys plus the octave gaps between them.
 */
export function whiteKeyWidth(width: number): number {
  return width / (totalWhiteKeys() + numOctaveGaps() * OCTAVE_GAP_RATIO)
}

/**
 * Left edge (px) of the white key with global white index (0–35).
 * Adds one octave gap before every white key that starts a new octave
 * (C3, C4, C5, C6, C7 → white indices 7, 14, 21, 28, 35).
 */
export function whiteKeyX(whiteIndex: number, width: number): number {
  const ww = whiteKeyWidth(width)
  const gap = OCTAVE_GAP_RATIO * ww
  const octave = Math.floor(whiteIndex / WHITE_KEYS_PER_OCTAVE)
  return whiteIndex * ww + octave * gap
}

/**
 * Horizontal center (px) of a black key, centered on the boundary between the
 * two correct white keys within its octave (C# between C–D, D# between D–E, …).
 */
export function blackKeyX(midi: number, width: number): number {
  return whiteKeyX(whiteKeyIndex(midi), width)
}

/** Width (px) of a black key (~60% of a white key). */
export function blackKeyWidth(width: number): number {
  return whiteKeyWidth(width) * BLACK_KEY_WIDTH_RATIO
}

/** Horizontal center (px) of a key within a canvas of the given width. */
export function keyX(midi: number, canvasWidth: number): number {
  if (!isBlackKey(midi)) {
    return whiteKeyX(whiteKeyIndex(midi), canvasWidth) + whiteKeyWidth(canvasWidth) / 2
  }
  return blackKeyX(midi, canvasWidth)
}

/** Width (px) of a key within a canvas of the given width. */
export function keyWidth(midi: number, canvasWidth: number): number {
  return isBlackKey(midi) ? blackKeyWidth(canvasWidth) : whiteKeyWidth(canvasWidth)
}

/** Vertical position (px) of a note at the given times. */
export function noteY(
  noteTime: number,
  currentTime: number,
  hitLineY: number,
  pxPerSec: number,
): number {
  return hitLineY - (noteTime - currentTime) * pxPerSec
}