import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MidiStatusBadge from '../MidiStatusBadge'

const onReconnect = vi.fn()

describe('MidiStatusBadge', () => {
  it('mostra nome do device quando conectado', () => {
    render(<MidiStatusBadge status="connected" deviceName="CT-S300" onReconnect={onReconnect} />)
    expect(screen.getByText('MIDI: Conectado — CT-S300')).toBeInTheDocument()
  })

  it('não mostra botão reconectar quando conectado', () => {
    render(<MidiStatusBadge status="connected" deviceName="CT-S300" onReconnect={onReconnect} />)
    expect(screen.queryByRole('button', { name: 'Reconectar' })).not.toBeInTheDocument()
  })

  it('mostra status negado', () => {
    render(<MidiStatusBadge status="denied" deviceName={null} onReconnect={onReconnect} />)
    expect(screen.getByText('MIDI: Negado')).toBeInTheDocument()
  })

  it('mostra status sem dispositivo', () => {
    render(<MidiStatusBadge status="no-device" deviceName={null} onReconnect={onReconnect} />)
    expect(screen.getByText('MIDI: Sem dispositivo')).toBeInTheDocument()
  })

  it('mostra status não suportado', () => {
    render(<MidiStatusBadge status="unsupported" deviceName={null} onReconnect={onReconnect} />)
    expect(screen.getByText('MIDI: Não suportado')).toBeInTheDocument()
  })

  it('mostra status desconectado', () => {
    render(<MidiStatusBadge status="disconnected" deviceName={null} onReconnect={onReconnect} />)
    expect(screen.getByText('MIDI: Desconectado')).toBeInTheDocument()
  })

  it('chama onReconnect ao clicar em reconectar', async () => {
    const user = userEvent.setup()
    render(<MidiStatusBadge status="no-device" deviceName={null} onReconnect={onReconnect} />)
    await user.click(screen.getByRole('button', { name: 'Reconectar' }))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})