import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { useGameLoop } from '../hooks/useGameLoop'
import { keyX, keyWidth, noteY, FALL_SECONDS } from '../lib/noteMath'
import { judgeNote, GOOD_WINDOW_MS } from '../lib/scoring'

const CHANNEL_COLORS = [
  '#f472b6',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#f87171',
  '#22d3ee',
  '#fb923c',
  '#a3e635',
  '#e879f9',
  '#38bdf8',
  '#facc15',
  '#4ade80',
  '#c084fc',
  '#fda4af',
  '#7dd3fc',
]

interface CanvasCtx {
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  clearRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => void
  closePath: () => void
  fill: () => void
  stroke: () => void
  fillRect: (x: number, y: number, w: number, h: number) => void
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
}

function roundRect(
  ctx: CanvasCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Canvas engine: draws falling notes aligned to the keyboard at 60 FPS.
 * Per-frame state lives in refs (not React state) to avoid re-renders.
 */
export default function FallingNotesCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notes = useGameStore((s) => s.notes)
  const isPlaying = useGameStore((s) => s.isPlaying)
  const sessionId = useGameStore((s) => s.sessionId)
  const activeNotes = useGameStore((s) => s.activeNotes)
  const registerJudgment = useGameStore((s) => s.registerJudgment)

  const notesRef = useRef(notes)
  const activeRef = useRef(activeNotes)
  const playingRef = useRef(isPlaying)
  const judgeRef = useRef(registerJudgment)
  const currentTimeRef = useRef(0)
  const judgedRef = useRef<Set<number>>(new Set())

  notesRef.current = notes
  activeRef.current = activeNotes
  playingRef.current = isPlaying
  judgeRef.current = registerJudgment

  // Reset per-frame state whenever a new song is loaded or restarted.
  useEffect(() => {
    currentTimeRef.current = 0
    judgedRef.current = new Set()
  }, [sessionId])

  // Keep the canvas backing store in sync with its CSS size.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useGameLoop((dt) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as CanvasCtx | null
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (playingRef.current) {
      currentTimeRef.current += dt
    }
    const t = currentTimeRef.current

    ctx.clearRect(0, 0, w, h)

    const hitLineY = h - 30
    const pxPerSec = (hitLineY - 10) / FALL_SECONDS

    // Hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, hitLineY)
    ctx.lineTo(w, hitLineY)
    ctx.stroke()

    // Judgment detection
    const arr = notesRef.current
    const judged = judgedRef.current
    const active = activeRef.current
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i]
      if (judged.has(i)) continue
      const diff = t - n.time
      if (diff < -GOOD_WINDOW_MS / 1000) break
      if (active.has(n.midi)) {
        const j = judgeNote(diff * 1000)
        if (j) {
          judged.add(i)
          judgeRef.current(j)
        }
      } else if (diff > GOOD_WINDOW_MS / 1000) {
        judged.add(i)
        judgeRef.current('Miss')
      }
    }

    // Falling notes
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i]
      if (judged.has(i)) continue
      const y = noteY(n.time, t, hitLineY, pxPerSec)
      const x = keyX(n.midi, w)
      const nw = keyWidth(n.midi, w)
      const nh = Math.max(6, n.duration * pxPerSec)
      if (y + nh < 0 || y > h) continue
      ctx.fillStyle = CHANNEL_COLORS[n.channel % CHANNEL_COLORS.length]
      roundRect(ctx, x - nw / 2, y, nw, nh, 4)
      ctx.fill()
    }

    // Glow on active keys
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    for (const midi of active) {
      const x = keyX(midi, w)
      const nw = keyWidth(midi, w)
      ctx.fillRect(x - nw / 2, hitLineY - 6, nw, 12)
    }
  })

  return <canvas ref={canvasRef} data-testid="falling-notes-canvas" className="h-full w-full" />
}