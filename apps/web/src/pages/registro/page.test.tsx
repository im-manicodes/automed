import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { EntradaRegistro } from '../../lib/api'
import { callsOf, mockFetch } from '../../test/mockFetch'
import Registro from './page'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const linea = (id: number, nivel: EntradaRegistro['nivel'], mensaje: string, contexto = 'MailSync'): EntradaRegistro => ({
  id,
  ts: '2026-10-08T10:00:00.000Z',
  nivel,
  contexto,
  mensaje,
})

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Registro />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Ajustes: registro de la API', () => {
  it('muestra las líneas (la más reciente arriba) y avisa si hay errores', async () => {
    mockFetch({
      'GET /api/settings/logs': { body: { entries: [linea(1, 'log', 'Sync terminado'), linea(2, 'error', 'Falló el OCR', 'Ocr')], ultimoId: 2 } },
    })
    renderPage()
    const lista = await screen.findByRole('list', { name: 'Líneas del registro' })
    const items = within(lista).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Falló el OCR')
    expect(items[1]).toHaveTextContent('Sync terminado')
    expect(screen.getByText(/Algo falló: 1 error/)).toBeInTheDocument()
  })

  it('sin errores dice que todo va bien', async () => {
    mockFetch({ 'GET /api/settings/logs': { body: { entries: [linea(1, 'log', 'Arranque')], ultimoId: 1 } } })
    renderPage()
    expect(await screen.findByText(/Todo bien/)).toBeInTheDocument()
  })

  it('filtra por nivel y por texto', async () => {
    const f = mockFetch({ 'GET /api/settings/logs': { body: { entries: [], ultimoId: 0 } } })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('No hay líneas para mostrar.')
    await user.click(screen.getByRole('radio', { name: 'Solo errores' }))
    await waitFor(() => expect(callsOf(f)).toContain('GET /api/settings/logs?limit=500&nivel=error'))
    await user.type(screen.getByLabelText('Buscar en el registro'), 'Mail{Enter}')
    await waitFor(() => expect(callsOf(f)).toContain('GET /api/settings/logs?limit=500&nivel=error&q=Mail'))
  })

  it('cada 3 s pide solo lo nuevo y se detiene en pausa', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let n = 0
    const f = mockFetch({
      'GET /api/settings/logs?limit=500': { body: { entries: [linea(1, 'log', 'Primera')], ultimoId: 1 } },
      'GET /api/settings/logs?limit=500&desde=1': () => {
        n++
        return { body: { entries: [linea(2, 'warn', 'Segunda')], ultimoId: 2 } }
      },
      'GET /api/settings/logs?limit=500&desde=2': { body: { entries: [], ultimoId: 2 } },
    })
    renderPage()
    await screen.findByText('Primera')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(await screen.findByText('Segunda')).toBeInTheDocument()
    expect(n).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(screen.getByText(/En pausa/)).toBeInTheDocument()
    const antes = f.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(f.mock.calls.length).toBe(antes)
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(callsOf(f)).toContain('GET /api/settings/logs?limit=500&desde=2')
    expect(screen.getAllByText('Segunda')).toHaveLength(1)
  })

  it('descarga el registro en texto', async () => {
    const f = mockFetch({
      'GET /api/settings/logs': { body: { entries: [], ultimoId: 0 } },
      'GET /api/settings/logs/descargar': { body: new Blob(['linea\n'], { type: 'text/plain' }) },
    })
    const crear = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() }))
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('No hay líneas para mostrar.')
    await user.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(crear).toHaveBeenCalled())
    expect(callsOf(f)).toContain('GET /api/settings/logs/descargar')
  })

  it('limpiar pide confirmación y vacía la lista', async () => {
    const f = mockFetch({
      'GET /api/settings/logs': { body: { entries: [linea(1, 'error', 'Algo raro')], ultimoId: 1 } },
      'DELETE /api/settings/logs': { body: null }, // el servidor responde 204; el mock no admite cuerpo vacío con 204
    })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('Algo raro')
    await user.click(screen.getByRole('button', { name: 'Limpiar' }))
    const dlg = screen.getByRole('alertdialog')
    await user.click(within(dlg).getByRole('button', { name: 'Limpiar' }))
    await screen.findByText('Registro limpio.')
    expect(callsOf(f)).toContain('DELETE /api/settings/logs')
    expect(screen.queryByText('Algo raro')).not.toBeInTheDocument()
    expect(screen.getByText('No hay líneas para mostrar.')).toBeInTheDocument()
  })
})
