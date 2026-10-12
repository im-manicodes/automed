import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { Evento, EventoBorrador, ProcessStatus, ProgresoAnalisis } from '../../lib/api'
import { callsOf, mockFetch, type MockHandler } from '../../test/mockFetch'
import TicketDetalle from './page'

const thread = (status: ProcessStatus) => ({
  id: 't1', subject: 'Paciente Uno', status, seguimiento: false, tieneMensajesNuevos: false, lastMessageAt: '2026-10-05T10:00:00Z',
  progreso: null,
  messages: [{ id: 'm1', from: 'a@b.c', to: [], cc: [], subject: 'x', bodyText: 'hola', isFromMe: false, receivedAt: '2026-10-05T10:00:00Z', attachments: [] }],
})

const synth = (status: ProcessStatus, conResumen = true) => ({
  threadId: 't1', status, plantillaDesactualizada: false, plantillaActivaVersion: 1,
  latest: conResumen
    ? { version: 2, markdown: '# Resumen', model: null, templateVersion: 1, mode: 'full' as const, inputTokensEstimados: null, mensajesCubiertos: 1, createdAt: '2026-10-05T10:00:00Z' }
    : null,
  history: [],
})

const evento = (o: Partial<Evento> = {}): Evento => ({
  id: 'e1', threadId: 't1', synthesisId: 's1', fechaEvento: '2026-10-05T15:00:00.000Z', fecha: '2026-10-05', estado: 'hospitalizado',
  novedadTexto: 'Mejora la fiebre', datos: { Paciente: 'Ana' }, columnas: ['Paciente'], templateVersion: 1, createdAt: '2026-10-05T16:00:00Z', ...o,
})

const borrador = (o: Partial<EventoBorrador> = {}): EventoBorrador => ({
  synthesisId: 's1', templateVersion: 1, columnas: [{ nombre: 'Paciente', instruccion: 'Nombre' }], datos: { Paciente: 'Ana' },
  estado: 'hospitalizado', novedadTexto: 'Mejora', fechaEvento: '2026-10-05T15:00:00.000Z', yaRegistrado: null, ...o,
})

let eventos: Evento[]
let routes: Record<string, MockHandler>
let fetchMock: ReturnType<typeof mockFetch>
function setup(status: ProcessStatus = 'listo', conResumen = true, vigente: string | null = 's1', progreso: ProgresoAnalisis | null = null) {
  routes = {
    'GET /api/threads/t1': { body: { ...thread(status), progreso } },
    'GET /api/threads/t1/synthesis': { body: synth(status, conResumen) },
    'GET /api/threads/t1/events': () => ({ body: { eventos, synthesisId: vigente } }),
  }
  fetchMock = mockFetch(routes)
  return render(
    <MemoryRouter initialEntries={['/tickets/t1']}>
      <ToastProvider>
        <Routes>
          <Route path="/tickets/:id" element={<TicketDetalle />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  eventos = []
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const boton = () => screen.findByRole('button', { name: /Añadir al Excel|Ya añadido|Leyendo la actualización/ })

describe('TicketDetalle · Añadir al Excel', () => {
  it('listo con resumen: botón habilitado', async () => {
    setup('listo')
    expect(await boton()).toBeEnabled()
  })

  it.each([
    ['necesita_revision', 'Resuelve las dudas del PDF primero.'],
    ['error', 'El análisis falló. Vuelve a analizar el ticket primero.'],
    ['procesando', 'Espera a que termine el análisis.'],
    ['pendiente', 'Espera a que termine el análisis.'],
  ] as const)('estado %s: deshabilitado con la razón visible', async (status, razon) => {
    setup(status, true, null)
    const b = await boton()
    expect(b).toBeDisabled()
    expect(screen.getAllByText(razon).length).toBeGreaterThan(0)
  })

  it('procesando: muestra las etapas en el tab Resumen', async () => {
    setup('procesando', false, null, { etapa: 'escaneando_ocr', porcentaje: 20, adjuntos: { total: 1, listos: 0 }, paginas: { total: 4, leidas: 1 } })
    expect(await screen.findByText('Escaneando el PDF con OCR')).toBeInTheDocument()
    expect(screen.getAllByText(/Páginas leídas: 1 de 4/).length).toBeGreaterThan(0)
  })

  it('necesita revisión: muestra el paso «Revisión manual»', async () => {
    setup('necesita_revision', false, null, { etapa: 'revision_manual', porcentaje: 70, adjuntos: { total: 1, listos: 1 } })
    expect(await screen.findByText('Revisión manual')).toBeInTheDocument()
  })

  it('sin resumen no hay botón', async () => {
    setup('sin_analizar', false, null)
    await screen.findByText(/Todavía no hay resumen/)
    expect(screen.queryByRole('button', { name: 'Añadir al Excel' })).toBeNull()
  })

  it('flujo: borrador -> formulario -> guardar -> refresca y muestra «Ya añadido»', async () => {
    setup('listo')
    routes['POST /api/threads/t1/event-draft'] = { body: borrador() }
    const create = vi.fn()
    routes['POST /api/threads/t1/events'] = () => {
      create()
      eventos = [evento()]
      return { body: eventos[0] }
    }
    const user = userEvent.setup()
    await user.click(await boton())
    const dlg = await screen.findByRole('dialog', { name: 'Añadir al Excel' })
    expect(callsOf(fetchMock)).toContain('POST /api/threads/t1/event-draft')
    expect(within(dlg).getByText('Paciente Uno')).toBeInTheDocument()
    expect(within(dlg).getByRole('heading', { name: 'Resumen', hidden: true })).toBeInTheDocument()
    expect(within(dlg).getByRole('tab', { name: 'Adjuntos' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Añadir al Excel' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Añadido al Excel.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: /Ya añadido el/ })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Ver eventos registrados' })).toBeInTheDocument()
  })

  it('muestra «Cargando» mientras lee la actualización', async () => {
    setup('listo')
    let resolver: (b: EventoBorrador) => void = () => undefined
    const pendiente = new Promise<EventoBorrador>((r) => (resolver = r))
    routes['POST /api/threads/t1/event-draft'] = async () => ({ body: await pendiente })
    await userEvent.setup().click(await boton())
    expect(await screen.findByRole('button', { name: 'Leyendo la actualización…' })).toBeDisabled()
    resolver(borrador())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('yaRegistrado en el borrador: no abre el formulario, avisa y ofrece ver eventos', async () => {
    setup('listo')
    routes['POST /api/threads/t1/event-draft'] = { body: borrador({ yaRegistrado: evento() }) }
    const user = userEvent.setup()
    await user.click(await boton())
    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByRole('heading', { name: /Ya añadido el/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(dlg).getByRole('button', { name: 'Ver eventos' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('503 del borrador: toast con el mensaje seguro y sin diálogo', async () => {
    setup('listo')
    routes['POST /api/threads/t1/event-draft'] = { status: 503, body: { message: 'No se pudo leer la actualización ahora. Intenta de nuevo.' } }
    await userEvent.setup().click(await boton())
    expect(await screen.findByText(/No se pudo leer la actualización ahora/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('409 del borrador: explica en lenguaje sencillo', async () => {
    setup('listo')
    routes['POST /api/threads/t1/event-draft'] = { status: 409, body: { message: 'Conflict' } }
    await userEvent.setup().click(await boton())
    expect(await screen.findByText(/el ticket debe estar listo y con resumen/)).toBeInTheDocument()
  })
})

describe('TicketDetalle · Eventos registrados', () => {
  it('vacío', async () => {
    setup('listo')
    expect(await screen.findByText('Aún no has añadido eventos de este paciente.')).toBeInTheDocument()
  })

  it('lista con fecha, estado, qué cambió y datos expandibles', async () => {
    eventos = [evento({ estado: 'alta' })]
    setup('listo', true, 's2')
    const sec = await screen.findByRole('region', { name: 'Eventos registrados' })
    expect(within(sec).getByText('Alta')).toBeInTheDocument()
    expect(within(sec).getByText('Mejora la fiebre')).toBeInTheDocument()
    expect(within(sec).getByText('Ana')).toBeInTheDocument()
    // evento de una versión anterior: se puede añadir otro
    expect(await boton()).toHaveTextContent('Añadir al Excel')
  })

  it('eliminar pide confirmación y refresca; cancelar no borra', async () => {
    eventos = [evento()]
    setup('listo', true, 's2')
    const remove = vi.fn()
    routes['DELETE /api/events/e1'] = () => {
      remove()
      eventos = []
      return {}
    }
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    let dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByText('¿Quitar este evento del Excel?')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Cancelar' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    dlg = await screen.findByRole('alertdialog')
    await user.click(within(dlg).getByRole('button', { name: 'Sí, quitar' }))
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Aún no has añadido eventos de este paciente.')).toBeInTheDocument()
    expect(screen.getByText('Evento quitado del Excel.')).toBeInTheDocument()
  })
})
