import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../context/toasts'
import type { MailStatus } from '../../../lib/api'
import { callsOf, mockFetch } from '../../../test/mockFetch'
import OutlookCard from './OutlookCard'

function renderCard(mail: MailStatus, onChanged = vi.fn(), configurado = true) {
  render(
    <ToastProvider>
      <OutlookCard mail={mail} onChanged={onChanged} configurado={configurado} />
    </ToastProvider>,
  )
  return onChanged
}

afterEach(() => vi.unstubAllGlobals())

describe('tarjeta de Outlook', () => {
  it('no conectado: explica permisos y conecta', async () => {
    const f = mockFetch({ 'POST /api/mail/connect': { body: { url: '#ms' } } })
    const u = userEvent.setup()
    renderCard({ connected: false, syncing: false })
    expect(screen.getByText(/leer/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Conectar con Outlook' }))
    await waitFor(() => expect(callsOf(f)).toContain('POST /api/mail/connect'))
  })

  it('sin Microsoft configurado: avisa y deshabilita Conectar', () => {
    renderCard({ connected: false, syncing: false }, vi.fn(), false)
    expect(screen.getByText(/Primero configura Microsoft/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conectar con Outlook' })).toBeDisabled()
  })

  it('conectado: muestra correo, sincroniza y desconecta con confirmación', async () => {
    const f = mockFetch({
      'POST /api/mail/sync': { body: { started: true, messages: 0, newMessages: 0, attachments: 0, deduped: 0, resetDelta: false } },
      'DELETE /api/mail/connection': { status: 204 },
    })
    const sync = () => callsOf(f).filter((c) => c === 'POST /api/mail/sync')
    const disc = () => callsOf(f).filter((c) => c === 'DELETE /api/mail/connection')
    const u = userEvent.setup()
    const onChanged = renderCard({ connected: true, email: 'yo@empresa.com', lastSyncAt: '2026-01-01T10:00:00Z', syncing: false })
    expect(screen.getByText('yo@empresa.com')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Sincronizar ahora' }))
    await waitFor(() => expect(sync()).toHaveLength(1))
    await u.click(screen.getByRole('button', { name: 'Desconectar' }))
    expect(screen.getByText(/tickets y resúmenes se conservan/)).toBeInTheDocument()
    expect(disc()).toHaveLength(0)
    await u.click(screen.getByRole('button', { name: 'Sí, desconectar' }))
    await waitFor(() => expect(disc()).toHaveLength(1))
    expect(onChanged).toHaveBeenCalled()
  })

  it('con error: muestra el mensaje y Reconectar', () => {
    renderCard({ connected: true, email: 'yo@empresa.com', syncing: false, error: 'El permiso venció' })
    expect(screen.getByRole('alert')).toHaveTextContent('El permiso venció')
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sincronizar ahora' })).not.toBeInTheDocument()
  })
})
