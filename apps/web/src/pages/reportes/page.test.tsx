import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { type ReporteDetalle } from '../../lib/api'
import { mockFetch, type MockHandler } from '../../test/mockFetch'
import Reportes from './page'

const rep = (o: Partial<ReporteDetalle> = {}): ReporteDetalle => ({
  id: 'r1',
  fecha: '2026-10-06',
  trigger: 'manual',
  status: 'generando',
  fileName: 'reporte_0930.xlsx',
  templateVersion: 1,
  totales: { hospitalizados: 0, conNovedad: 0, altas: 0 },
  progreso: { procesados: 0, total: 0 },
  error: null,
  descargable: false,
  createdAt: '2026-10-06T15:30:00Z',
  finishedAt: null,
  columnas: ['Paciente'],
  filasConNovedad: [],
  ...o,
})

const listo = (o: Partial<ReporteDetalle> = {}) =>
  rep({
    status: 'listo',
    descargable: true,
    totales: { hospitalizados: 12, conNovedad: 3, altas: 1 },
    progreso: { procesados: 18, total: 18 },
    finishedAt: '2026-10-06T15:31:00Z',
    filasConNovedad: [
      { threadId: 't1', asunto: 'Paciente Uno', estado: 'hospitalizado', novedadTexto: 'Se autorizó la cirugía', desactualizado: true, extraccionOk: true, datos: {} },
    ],
    ...o,
  })

function Ubicacion() {
  const l = useLocation()
  return <output data-testid="ubicacion">{l.pathname + l.search}</output>
}

function renderPage(url = '/reportes') {
  instalar()
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Reportes />
        <Ubicacion />
      </ToastProvider>
    </MemoryRouter>,
  )
}

type Fetch = ReturnType<typeof mockFetch>
let fetchMock: Fetch
let clicks: number
// Respuestas configurables por prueba (cada GET /reports/r1 consume la cola y repite la última).
let listReply: MockHandler
let createReply: MockHandler
let getReplies: Record<string, ReporteDetalle[]>
let downloadReply: MockHandler
let saveReply: MockHandler

const pedidos = (metodo: string, ruta: string) =>
  fetchMock.mock.calls.filter(([u, i]) => String(u) === ruta && (i?.method ?? 'GET').toUpperCase() === metodo)
const create = () => pedidos('POST', '/api/reports')
const download = (id = 'r1') => pedidos('GET', `/api/reports/${id}/download`)

/** Cola por id: devuelve el primero y lo quita mientras queden más; el último se repite. */
function getHandler(id: string): MockHandler {
  return () => {
    const cola = getReplies[id] ?? []
    return { body: cola.length > 1 ? cola.shift() : cola[0] }
  }
}

function instalar() {
  const ids = new Set(['r0', 'r1', 'r2', ...Object.keys(getReplies)])
  const routes: Record<string, MockHandler> = {
    'GET /api/reports': (r) => (typeof listReply === 'function' ? listReply(r) : listReply),
    'POST /api/reports': (r) => (typeof createReply === 'function' ? createReply(r) : createReply),
    'GET /api/reports/settings': { body: { programado: false, hora: '07:00', zona: 'America/Mexico_City' } },
    'PUT /api/reports/settings': (r) => (typeof saveReply === 'function' ? saveReply(r) : saveReply),
  }
  for (const id of ids) {
    routes[`GET /api/reports/${id}`] = getHandler(id)
    routes[`GET /api/reports/${id}/download`] = (r) => (typeof downloadReply === 'function' ? downloadReply(r) : downloadReply)
  }
  fetchMock = mockFetch(routes)
}

beforeEach(() => {
  clicks = 0
  listReply = { body: { reportes: [] } }
  createReply = { body: null }
  getReplies = {}
  downloadReply = { body: new Blob(['x']) }
  saveReply = { body: null }
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    clicks++
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Reportes', () => {
  it('un clic crea el reporte, muestra el progreso y descarga una sola vez al estar listo', async () => {
    createReply = { body: { reporte: rep(), reutilizado: false } }
    getReplies = { r1: [rep({ progreso: { procesados: 4, total: 18 } }), listo()] }
    renderPage()
    const boton = await screen.findByRole('button', { name: 'Generar Excel de hoy' })
    await waitFor(() => expect(boton).toBeEnabled())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => {
      boton.click()
    })
    expect(create()).toHaveLength(1)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // primer ciclo: progreso real
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(screen.getByText(/Leyendo paciente 5 de 18/)).toBeInTheDocument()
    // segundo ciclo: listo
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    await waitFor(() => expect(download()).toHaveLength(1))
    expect(clicks).toBe(1)
    expect((await screen.findAllByText('Se autorizó la cirugía')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resumen desactualizado').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Descargar de nuevo' })).toBeInTheDocument()
    // más tiempo y re-renderizados: no vuelve a descargar
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(download()).toHaveLength(1)
  })

  it('"Descargar de nuevo" vuelve a bajar el archivo', async () => {
    const user = userEvent.setup()
    listReply = { body: { reportes: [listo()] } }
    getReplies = { r1: [listo()] }
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Descargar de nuevo' }))
    await waitFor(() => expect(download('r1')).toHaveLength(1))
    // un reporte ya listo al abrir no se descarga solo
    expect(download()).toHaveLength(1)
  })

  it('muestra el error del reporte y deja intentar de nuevo', async () => {
    const user = userEvent.setup()
    listReply = { body: { reportes: [rep({ status: 'error', error: 'La IA no respondió.' })] } }
    getReplies = { r1: [rep({ status: 'error', error: 'La IA no respondió.' })], r2: [rep({ id: 'r2' })] }
    createReply = { body: { reporte: rep({ id: 'r2' }), reutilizado: false } }
    renderPage()
    expect(await screen.findByText('La IA no respondió.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    await waitFor(() => expect(create()).toHaveLength(1))
  })

  it('si ya hay un reporte en curso muestra su progreso en vez de crear otro', async () => {
    const enCurso = rep({ progreso: { procesados: 2, total: 10 } })
    listReply = { body: { reportes: [enCurso] } }
    getReplies = { r1: [enCurso] }
    renderPage('/reportes?generar=1')
    expect(await screen.findByText(/Leyendo paciente 3 de 10/)).toBeInTheDocument()
    expect(create()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Generando…' })).toBeDisabled()
  })

  it('?generar=1 arranca la generación y limpia el parámetro', async () => {
    createReply = { body: { reporte: rep(), reutilizado: false } }
    getReplies = { r1: [rep()] }
    renderPage('/reportes?generar=1')
    await waitFor(() => expect(create()).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/reportes$/))
  })

  it('no empuja a analizar: sin aviso de hilos sin analizar ni botón "Analizar y regenerar"', async () => {
    listReply = { body: { reportes: [listo()] } }
    getReplies = { r1: [listo()] }
    renderPage()
    expect(await screen.findByRole('button', { name: 'Descargar de nuevo' })).toBeInTheDocument()
    expect(screen.getByText(/Incluye solo los hilos que ya analizaste/)).toBeInTheDocument()
    expect(screen.queryByText(/sin analizar/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analizar y regenerar/ })).not.toBeInTheDocument()
  })

  it('sin hilos analizados explica qué hacer y enlaza a Tickets', async () => {
    const vacio = listo({ totales: { hospitalizados: 0, conNovedad: 0, altas: 0 }, progreso: { procesados: 0, total: 0 }, filasConNovedad: [] })
    listReply = { body: { reportes: [vacio] } }
    getReplies = { r1: [vacio] }
    renderPage()
    expect(await screen.findByText(/Aún no hay hilos analizados/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/tickets')
  })

  it('muestra un error visible si la descarga falla', async () => {
    const user = userEvent.setup()
    listReply = { body: { reportes: [listo()] } }
    getReplies = { r1: [listo()] }
    downloadReply = { status: 409, body: { message: 'El archivo todavía no está listo.' } }
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Descargar de nuevo' }))
    expect(await screen.findByText(/No se pudo descargar el Excel/)).toBeInTheDocument()
  })

  it('el historial permite descargar un reporte anterior', async () => {
    const user = userEvent.setup()
    const viejo: ReporteDetalle = listo({ id: 'r0', fecha: '2026-10-05', trigger: 'programado' })
    listReply = { body: { reportes: [viejo] } }
    getReplies = { r0: [viejo] }
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Descargar el reporte del/ }))
    await waitFor(() => expect(download('r0')).toHaveLength(1))
    expect(screen.getByText(/Automático/)).toBeInTheDocument()
  })

  it('programación: interruptor y hora se guardan con confirmación', async () => {
    const user = userEvent.setup()
    saveReply = ({ body }) => {
      const c = body as { programado?: boolean; hora?: string }
      return { body: { programado: c.programado ?? false, hora: c.hora ?? '07:00', zona: 'America/Mexico_City' } }
    }
    const guardados = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)))
    renderPage()
    const sw = await screen.findByRole('switch', { name: /Generar cada día/ })
    expect(screen.getByText(/America\/Mexico_City/)).toBeInTheDocument()
    await user.click(sw)
    expect(guardados()).toContainEqual({ programado: true })
    expect(await screen.findByText('Listo: se generará cada día.')).toBeInTheDocument()
    const hora = screen.getByLabelText('Hora')
    await user.clear(hora)
    await user.type(hora, '08:30')
    await user.click(screen.getByRole('button', { name: 'Guardar hora' }))
    expect(guardados()).toContainEqual({ hora: '08:30' })
    expect(await screen.findByText('Listo: hora guardada.')).toBeInTheDocument()
  })
})
