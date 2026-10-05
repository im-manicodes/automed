import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import OutlookCard from './OutlookCard'

function renderCard(mail: apiLib.MailStatus, onChanged = vi.fn()) {
  render(
    <ToastProvider>
      <OutlookCard mail={mail} onChanged={onChanged} />
    </ToastProvider>,
  )
  return onChanged
}

afterEach(() => vi.restoreAllMocks())

describe('tarjeta de Outlook', () => {
  it('no conectado: explica permisos y conecta', async () => {
    const connect = vi.spyOn(apiLib.mailApi, 'connect').mockResolvedValue({ url: '#ms' })
    const u = userEvent.setup()
    renderCard({ connected: false, syncing: false })
    expect(screen.getByText(/leer/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Conectar con Outlook' }))
    expect(connect).toHaveBeenCalled()
  })

  it('conectado: muestra correo, sincroniza y desconecta con confirmación', async () => {
    const sync = vi.spyOn(apiLib.mailApi, 'sync').mockResolvedValue({ started: true, messages: 0, newMessages: 0, attachments: 0, deduped: 0, resetDelta: false })
    const disc = vi.spyOn(apiLib.mailApi, 'disconnect').mockResolvedValue(undefined)
    const u = userEvent.setup()
    const onChanged = renderCard({ connected: true, email: 'yo@empresa.com', lastSyncAt: '2026-01-01T10:00:00Z', syncing: false })
    expect(screen.getByText('yo@empresa.com')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Sincronizar ahora' }))
    await waitFor(() => expect(sync).toHaveBeenCalled())
    await u.click(screen.getByRole('button', { name: 'Desconectar' }))
    expect(screen.getByText(/tickets y resúmenes se conservan/)).toBeInTheDocument()
    expect(disc).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Sí, desconectar' }))
    await waitFor(() => expect(disc).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalled()
  })

  it('con error: muestra el mensaje y Reconectar', () => {
    renderCard({ connected: true, email: 'yo@empresa.com', syncing: false, error: 'El permiso venció' })
    expect(screen.getByRole('alert')).toHaveTextContent('El permiso venció')
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sincronizar ahora' })).not.toBeInTheDocument()
  })
})
