import type { MidiStatus } from '../hooks/useMidiConnection'

interface MidiStatusBadgeProps {
  status: MidiStatus
  deviceName: string | null
  onReconnect: () => void
}

interface StatusConfig {
  label: string
  className: string
  dot: string
}

const STATUS_CONFIG: Record<MidiStatus, StatusConfig> = {
  connected: {
    label: 'Conectado',
    className: 'bg-emerald-500/20 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  denied: {
    label: 'Negado',
    className: 'bg-red-500/20 text-red-300',
    dot: 'bg-red-400',
  },
  'no-device': {
    label: 'Sem dispositivo',
    className: 'bg-amber-500/20 text-amber-300',
    dot: 'bg-amber-400',
  },
  unsupported: {
    label: 'Não suportado',
    className: 'bg-zinc-500/20 text-zinc-400',
    dot: 'bg-zinc-500',
  },
  disconnected: {
    label: 'Desconectado',
    className: 'bg-zinc-500/20 text-zinc-400',
    dot: 'bg-zinc-500',
  },
}

/** Compact MIDI connection status badge shown in the header. */
export default function MidiStatusBadge({ status, deviceName, onReconnect }: MidiStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  const isConnected = status === 'connected'
  const text = isConnected && deviceName ? `MIDI: Conectado — ${deviceName}` : `MIDI: ${cfg.label}`

  return (
    <div
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${cfg.className}`}
      data-testid="midi-status-badge"
    >
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden="true" />
      <span>{text}</span>
      {!isConnected && (
        <button
          type="button"
          onClick={onReconnect}
          className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-700"
        >
          Reconectar
        </button>
      )}
    </div>
  )
}