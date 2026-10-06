import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import type { Reporte, ReporteDetalle } from '../lib/api'
import Reportes from './Reportes'

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
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Reportes />
        <Ubicacion />
      </ToastProvider>
    </MemoryRouter>,
  )
}

let list: ReturnType<typeof vi.spyOn>
let create: ReturnType<typeof vi.spyOn>
let get: ReturnType<typeof vi.spyOn>
let download: ReturnType<typeof vi.spyOn>
let clicks: number

beforeEach(() => {
  clicks = 0
  list = vi.spyOn(apiLib.reportsApi, 'list').mockResolvedValue({ reportes: [] })
  create = vi.spyOn(apiLib.reportsApi, 'create')
  get = vi.spyOn(apiLib.reportsApi, 'get')
  download = vi.spyOn(apiLib.reportsApi, 'download').mockResolvedValue(new Blob(['x']))
  vi.spyOn(apiLib.reportsApi, 'settings').mockResolvedValue({ programado: false, hora: '07:00', zona: 'America/Mexico_City' })
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    clicks++
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Reportes', () => {
  it('un clic crea el reporte, muestra el progreso y descarga una sola vez al estar listo', async () => {
    create.mockResolvedValue({ reporte: rep(), reutilizado: false })
    get.mockResolvedValueOnce(rep({ progreso: { procesados: 4, total: 18 } })).mockResolvedValue(listo())
    renderPage()
    const boton = await screen.findByRole('button', { name: 'Generar Excel de hoy' })
    await waitFor(() => expect(boton).toBeEnabled())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => {
      boton.click()
    })
    expect(create).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(clicks).toBe(1)
    expect((await screen.findAllByText('Se autorizó la cirugía')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resumen desactualizado').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Descargar de nuevo' })).toBeInTheDocument()
    // más tiempo y re-renderizados: no vuelve a descargar
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('"Descargar de nuevo" vuelve a bajar el archivo', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ reportes: [listo()] })
    get.mockResolvedValue(listo())
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Descargar de nuevo' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith('r1'))
    // un reporte ya listo al abrir no se descarga solo
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('muestra el error del reporte y deja intentar de nuevo', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ reportes: [rep({ status: 'error', error: 'La IA no respondió.' })] })
    get.mockResolvedValue(rep({ status: 'error', error: 'La IA no respondió.' }))
    create.mockResolvedValue({ reporte: rep({ id: 'r2' }), reutilizado: false })
    renderPage()
    expect(await screen.findByText('La IA no respondió.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('si ya hay un reporte en curso muestra su progreso en vez de crear otro', async () => {
    const enCurso = rep({ progreso: { procesados: 2, total: 10 } })
    list.mockResolvedValue({ reportes: [enCurso] })
    get.mockResolvedValue(enCurso)
    renderPage('/reportes?generar=1')
    expect(await screen.findByText(/Leyendo paciente 3 de 10/)).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Generando…' })).toBeDisabled()
  })

  it('?generar=1 arranca la generación y limpia el parámetro', async () => {
    create.mockResolvedValue({ reporte: rep(), reutilizado: false })
    get.mockResolvedValue(rep())
    renderPage('/reportes?generar=1')
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/reportes$/))
  })

  it('no empuja a analizar: sin aviso de hilos sin analizar ni botón "Analizar y regenerar"', async () => {
    list.mockResolvedValue({ reportes: [listo()] })
    get.mockResolvedValue(listo())
    renderPage()
    expect(await screen.findByRole('button', { name: 'Descargar de nuevo' })).toBeInTheDocument()
    expect(screen.getByText(/Incluye solo los hilos que ya analizaste/)).toBeInTheDocument()
    expect(screen.queryByText(/sin analizar/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analizar y regenerar/ })).not.toBeInTheDocument()
  })

  it('sin hilos analizados explica qué hacer y enlaza a Tickets', async () => {
    const vacio = listo({ totales: { hospitalizados: 0, conNovedad: 0, altas: 0 }, progreso: { procesados: 0, total: 0 }, filasConNovedad: [] })
    list.mockResolvedValue({ reportes: [vacio] })
    get.mockResolvedValue(vacio)
    renderPage()
    expect(await screen.findByText(/Aún no hay hilos analizados/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/tickets')
  })

  it('muestra un error visible si la descarga falla', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ reportes: [listo()] })
    get.mockResolvedValue(listo())
    download.mockRejectedValue(new apiLib.ApiError(409, 'El archivo todavía no está listo.'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Descargar de nuevo' }))
    expect(await screen.findByText(/No se pudo descargar el Excel/)).toBeInTheDocument()
  })

  it('el historial permite descargar un reporte anterior', async () => {
    const user = userEvent.setup()
    const viejo: Reporte = listo({ id: 'r0', fecha: '2026-10-05', trigger: 'programado' })
    list.mockResolvedValue({ reportes: [viejo] })
    get.mockResolvedValue(viejo)
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Descargar el reporte del/ }))
    await waitFor(() => expect(download).toHaveBeenCalledWith('r0'))
    expect(screen.getByText(/Automático/)).toBeInTheDocument()
  })

  it('programación: interruptor y hora se guardan con confirmación', async () => {
    const user = userEvent.setup()
    const save = vi.spyOn(apiLib.reportsApi, 'saveSettings').mockImplementation((c) =>
      Promise.resolve({ programado: c.programado ?? false, hora: c.hora ?? '07:00', zona: 'America/Mexico_City' }),
    )
    renderPage()
    const sw = await screen.findByRole('switch', { name: /Generar cada día/ })
    expect(screen.getByText(/America\/Mexico_City/)).toBeInTheDocument()
    await user.click(sw)
    expect(save).toHaveBeenCalledWith({ programado: true })
    expect(await screen.findByText('Listo: se generará cada día.')).toBeInTheDocument()
    const hora = screen.getByLabelText('Hora')
    await user.clear(hora)
    await user.type(hora, '08:30')
    await user.click(screen.getByRole('button', { name: 'Guardar hora' }))
    expect(save).toHaveBeenCalledWith({ hora: '08:30' })
    expect(await screen.findByText('Listo: hora guardada.')).toBeInTheDocument()
  })
})
