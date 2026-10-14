import { useCallback, useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'

export type MidiStatus = 'unsupported' | 'denied' | 'no-device' | 'connected' | 'disconnected'

export interface MidiConnection {
  status: MidiStatus
  inputs: string[]
  connectedDeviceName: string | null
  activeNotes: Set<number>
  connect: () => Promise<void>
}

/**
 * Connects to the Casio CT-S300 (fallback: first available input) via the
 * Web MIDI API and keeps the set of currently held notes in the game store.
 */
export function useMidiConnection(): MidiConnection {
  const activeNotes = useGameStore((s) => s.activeNotes)
  const addActiveNote = useGameStore((s) => s.addActiveNote)
  const removeActiveNote = useGameStore((s) => s.removeActiveNote)
  const [status, setStatus] = useState<MidiStatus>('unsupported')
  const [inputs, setInputs] = useState<string[]>([])
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null)
  const targetRef = useRef<MIDIInput | null>(null)
  const accessRef = useRef<MIDIAccess | null>(null)

  const handleMessage = useCallback(
    (e: MIDIMessageEvent) => {
      const data = e.data
      if (!data || data.length < 3) return
      const [command, note, velocity] = data
      const statusByte = command & 0xf0
      if (statusByte === 0x90 && velocity > 0) {
        addActiveNote(note)
      } else if (statusByte === 0x80 || (statusByte === 0x90 && velocity === 0)) {
        removeActiveNote(note)
      }
    },
    [addActiveNote, removeActiveNote],
  )

  const connect = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setStatus('unsupported')
      return
    }
    try {
      const access = await navigator.requestMIDIAccess()
      accessRef.current = access
      const inputList = [...access.inputs.values()]
      setInputs(inputList.map((i) => i.name || 'Unknown'))
      const target = inputList.find((i) => i.name?.includes('CT-S300')) ?? inputList[0]
      if (!target) {
        setStatus('no-device')
        setConnectedDeviceName(null)
        return
      }
      targetRef.current = target
      target.onmidimessage = handleMessage
      setStatus('connected')
      setConnectedDeviceName(target.name || 'Unknown')
      access.onstatechange = () => {
        const list = [...access.inputs.values()]
        setInputs(list.map((i) => i.name || 'Unknown'))
        const t = list.find((i) => i.name?.includes('CT-S300')) ?? list[0]
        if (t) {
          targetRef.current = t
          t.onmidimessage = handleMessage
          setStatus('connected')
          setConnectedDeviceName(t.name || 'Unknown')
        } else {
          targetRef.current = null
          setStatus('no-device')
          setConnectedDeviceName(null)
        }
      }
    } catch {
      setStatus('denied')
    }
  }, [handleMessage])

  useEffect(() => {
    void connect()
  }, [connect])

  useEffect(() => {
    return () => {
      if (targetRef.current) {
        targetRef.current.onmidimessage = null
        targetRef.current = null
      }
      if (accessRef.current) {
        accessRef.current.onstatechange = null
        accessRef.current = null
      }
    }
  }, [])

  return { status, inputs, connectedDeviceName, activeNotes, connect }
}