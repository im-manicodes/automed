import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import type { ThreadListItem } from '../lib/api'
import Tickets from './Tickets'

const base = { seguimiento: false, tieneMensajesNuevos: false, updatedAt: '2026-01-01T00:00:00Z', lastMessageAt: '2026-01-01T00:00:00Z', messageCount: 2, attachmentCount: 1 }
const list: ThreadListItem[] = [
  { ...base, id: 'a', subject: 'Ticket A', status: 'sin_analizar' },
  { ...base, id: 'b', subject: 'Ticket B', status: 'sin_analizar' },
  { ...base, id: 'c', subject: 'Ticket C', status: 'listo' },
  { ...base, id: 'd', subject: 'Ticket D', status: 'listo', tieneMensajesNuevos: true },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Tickets />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('lista de tickets', () => {
  beforeEach(() => {
    vi.spyOn(apiLib.threadsApi, 'list').mockResolvedValue(list)
    vi.spyOn(apiLib.mailApi, 'status').mockResolvedValue({ connected: true, email: 'a@b.c', syncing: false })
  })

  it('muestra etiquetas y aviso de mensajes nuevos', async () => {
    renderPage()
    await screen.findByText('Ticket A')
    expect(screen.getAllByText('Sin analizar').length).toBeGreaterThan(0)
    expect(screen.getByText('Mensajes nuevos')).toBeInTheDocument()
  })

  it('la selección múltiple muestra la barra y analiza los elegidos', async () => {
    const analyze = vi.spyOn(apiLib.threadsApi, 'analyzeMany').mockResolvedValue({ results: [{ id: 'a', ok: true }, { id: 'b', ok: true }] })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ticket A')
    expect(screen.queryByRole('button', { name: /Analizar \d/ })).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Elegir para analizar: Ticket A'))
    await user.click(screen.getByLabelText('Elegir para analizar: Ticket B'))
    await user.click(screen.getByRole('button', { name: 'Analizar 2 tickets' }))
    await waitFor(() => expect(analyze).toHaveBeenCalledWith(['a', 'b']))
  })

  it('no deja elegir tickets ya analizados sin novedades', async () => {
    renderPage()
    await screen.findByText('Ticket C')
    expect(screen.getByLabelText('No se puede analizar ahora: Ticket C')).toBeDisabled()
    expect(screen.getByLabelText('Elegir para analizar: Ticket D')).toBeEnabled()
  })

  it('filtra por estado con chips', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ticket A')
    await user.click(screen.getByRole('button', { name: 'Listos' }))
    expect(screen.queryByText('Ticket A')).not.toBeInTheDocument()
    expect(screen.getByText('Ticket C')).toBeInTheDocument()
  })
})

describe('sin Outlook conectado', () => {
  it('muestra estado vacío amable y deshabilita sincronizar', async () => {
    vi.spyOn(apiLib.threadsApi, 'list').mockResolvedValue([])
    vi.spyOn(apiLib.mailApi, 'status').mockResolvedValue({ connected: false, syncing: false })
    renderPage()
    expect(await screen.findByText('Conecta tu Outlook para empezar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conectar con Outlook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sincronizar ahora/ })).toBeDisabled()
    expect(screen.queryByText('Todavía no hay tickets')).not.toBeInTheDocument()
  })

  it('conectado y sin tickets pide sincronizar', async () => {
    vi.spyOn(apiLib.threadsApi, 'list').mockResolvedValue([])
    vi.spyOn(apiLib.mailApi, 'status').mockResolvedValue({ connected: true, email: 'a@b.c', syncing: false })
    renderPage()
    expect(await screen.findByText('Todavía no hay tickets')).toBeInTheDocument()
  })

  it('un 409 al sincronizar muestra el estado de conexión', async () => {
    vi.spyOn(apiLib.threadsApi, 'list').mockResolvedValue([])
    vi.spyOn(apiLib.mailApi, 'status').mockResolvedValue({ connected: true, email: 'a@b.c', syncing: false })
    vi.spyOn(apiLib.mailApi, 'sync').mockRejectedValue(new apiLib.ApiError(409, 'Conecta tu Outlook primero'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Todavía no hay tickets')
    await user.click(screen.getByRole('button', { name: /Sincronizar ahora/ }))
    expect(await screen.findByText('Conecta tu Outlook para empezar')).toBeInTheDocument()
  })
})
