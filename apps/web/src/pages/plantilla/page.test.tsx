import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { Template, TemplateKind } from '../../lib/api'
import { mockFetch, type MockHandler, type MockRequest } from '../../test/mockFetch'
import Plantilla from './page'

const tpl = (kind: TemplateKind, markdown: string, version = 1): Template => ({
  id: `id-${kind}`,
  name: kind,
  kind,
  version,
  markdown,
  updatedAt: '2026-03-01T10:00:00Z',
})

function renderPage(url = '/plantilla') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Plantilla />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const activeDefault: MockHandler = (req: MockRequest) => ({
  body: req.url.includes('kind=whatsapp') ? tpl('whatsapp', '*Formato WA* con instrucciones') : tpl('resumen', '## Resumen de ejemplo\n<!-- x -->'),
})
const llamadas = (f: ReturnType<typeof mockFetch>, metodo: string, ruta: string) =>
  f.mock.calls.filter(([u, i]) => String(u) === ruta && (i?.method ?? 'GET') === metodo)
const cuerpo = (f: ReturnType<typeof mockFetch>, metodo: string, ruta: string) =>
  JSON.parse(String(llamadas(f, metodo, ruta)[0][1]?.body))

afterEach(() => vi.unstubAllGlobals())

describe('Plantillas', () => {
  it('abre en Resumen y cambia de pestaña cargando la plantilla de WhatsApp', async () => {
    const f = mockFetch({ 'GET /api/templates/active': activeDefault })
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('## Resumen de ejemplo\n<!-- x -->')
    expect(screen.getByRole('tab', { name: 'Resumen del ticket' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Mensaje de WhatsApp' }))
    await waitFor(() => expect(screen.getByLabelText('Texto de la plantilla')).toHaveValue('*Formato WA* con instrucciones'))
    expect(llamadas(f, 'GET', '/api/templates/active?kind=whatsapp')).toHaveLength(1)
    expect(screen.getByText(/en cada mensaje nuevo/)).toBeInTheDocument()
    expect(screen.queryByText(/no rehace/)).toBeNull()
  })

  it('?tipo=whatsapp abre directo esa pestaña', async () => {
    mockFetch({ 'GET /api/templates/active': activeDefault })
    renderPage('/plantilla?tipo=whatsapp')
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('*Formato WA* con instrucciones')
    expect(screen.getByRole('tab', { name: 'Mensaje de WhatsApp' })).toHaveAttribute('aria-selected', 'true')
  })

  it('guarda con el tipo activo; WhatsApp no exige títulos #', async () => {
    const f = mockFetch({
      'GET /api/templates/active': activeDefault,
      'PUT /api/templates/active': { body: tpl('whatsapp', 'Nuevo formato libre sin títulos', 2) },
    })
    renderPage('/plantilla?tipo=whatsapp')
    const user = userEvent.setup()
    const ta = await screen.findByLabelText('Texto de la plantilla')
    await user.clear(ta)
    await user.type(ta, 'Nuevo formato libre sin títulos')
    await user.click(screen.getByRole('button', { name: 'Guardar plantilla' }))
    await waitFor(() => expect(llamadas(f, 'PUT', '/api/templates/active?kind=whatsapp')).toHaveLength(1))
    expect(cuerpo(f, 'PUT', '/api/templates/active?kind=whatsapp')).toEqual({ markdown: 'Nuevo formato libre sin títulos' })
  })

  it('el resumen sigue exigiendo un título de sección', async () => {
    mockFetch({ 'GET /api/templates/active': activeDefault })
    renderPage()
    const user = userEvent.setup()
    const ta = await screen.findByLabelText('Texto de la plantilla')
    await user.clear(ta)
    await user.type(ta, 'Texto sin ningún título de sección')
    expect(screen.getByRole('alert')).toHaveTextContent('título de sección')
    expect(screen.getByRole('button', { name: 'Guardar plantilla' })).toBeDisabled()
  })

  it('vista previa y restaurar envían el tipo', async () => {
    const f = mockFetch({
      'GET /api/templates/active': activeDefault,
      'POST /api/templates/preview': { body: { markdown: '*Hola* mensaje' } },
      'POST /api/templates/reset': { body: tpl('whatsapp', 'Original del formato', 3) },
    })
    renderPage('/plantilla?tipo=whatsapp')
    const user = userEvent.setup()
    await screen.findByLabelText('Texto de la plantilla')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(cuerpo(f, 'POST', '/api/templates/preview')).toEqual({ markdown: '*Formato WA* con instrucciones', kind: 'whatsapp' })
    expect(await screen.findByText('*Hola* mensaje')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restaurar la original' }))
    await user.click(screen.getByRole('button', { name: 'Sí, restaurar' }))
    await waitFor(() => expect(llamadas(f, 'POST', '/api/templates/reset?kind=whatsapp')).toHaveLength(1))
  })
})

describe('Plantilla de reporte Excel', () => {
  it('?tipo=reporte abre la pestaña, avisa que aplica a reportes nuevos y muestra las columnas', async () => {
    const f = mockFetch({
      'GET /api/templates/active': { body: tpl('reporte', '- Paciente: nombre\n- Hospital: nombre del hospital') },
      'POST /api/templates/preview': {
        body: {
          markdown: '',
          columnas: [{ nombre: 'Paciente', instruccion: 'nombre' }, { nombre: 'Hospital', instruccion: 'nombre del hospital' }],
          error: null,
        },
      },
    })
    renderPage('/plantilla?tipo=reporte')
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('- Paciente: nombre\n- Hospital: nombre del hospital')
    expect(screen.getByRole('tab', { name: 'Reporte Excel' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/en cada reporte nuevo/)).toBeInTheDocument()
    expect(screen.queryByText(/consume un poco/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(cuerpo(f, 'POST', '/api/templates/preview')).toEqual({ markdown: '- Paciente: nombre\n- Hospital: nombre del hospital', kind: 'reporte' })
    expect(await screen.findByText('2 columnas en el Excel')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Hospital' })).toBeInTheDocument()
  })

  it('muestra el error de formato de la vista previa', async () => {
    mockFetch({
      'GET /api/templates/active': { body: tpl('reporte', '- Paciente: nombre') },
      'POST /api/templates/preview': { body: { markdown: '', columnas: [], error: 'Hay nombres de columna repetidos.' } },
    })
    renderPage('/plantilla?tipo=reporte')
    const user = userEvent.setup()
    await screen.findByLabelText('Texto de la plantilla')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByTestId('error-columnas')).toHaveTextContent('repetidos')
  })
})
