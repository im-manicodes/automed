import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import Plantilla from './Plantilla'

const tpl = (kind: apiLib.TemplateKind, markdown: string, version = 1): apiLib.Template => ({
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

beforeEach(() => {
  vi.spyOn(apiLib.templatesApi, 'active').mockImplementation((kind = 'resumen') =>
    Promise.resolve(kind === 'whatsapp' ? tpl('whatsapp', '*Formato WA* con instrucciones') : tpl('resumen', '## Resumen de ejemplo\n<!-- x -->')),
  )
})
afterEach(() => vi.restoreAllMocks())

describe('Plantillas', () => {
  it('abre en Resumen y cambia de pestaña cargando la plantilla de WhatsApp', async () => {
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('## Resumen de ejemplo\n<!-- x -->')
    expect(screen.getByRole('tab', { name: 'Resumen del ticket' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Mensaje de WhatsApp' }))
    await waitFor(() => expect(screen.getByLabelText('Texto de la plantilla')).toHaveValue('*Formato WA* con instrucciones'))
    expect(apiLib.templatesApi.active).toHaveBeenCalledWith('whatsapp')
    expect(screen.getByText(/en cada mensaje nuevo/)).toBeInTheDocument()
    expect(screen.queryByText(/no rehace/)).toBeNull()
  })

  it('?tipo=whatsapp abre directo esa pestaña', async () => {
    renderPage('/plantilla?tipo=whatsapp')
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('*Formato WA* con instrucciones')
    expect(screen.getByRole('tab', { name: 'Mensaje de WhatsApp' })).toHaveAttribute('aria-selected', 'true')
  })

  it('guarda con el tipo activo; WhatsApp no exige títulos #', async () => {
    const save = vi.spyOn(apiLib.templatesApi, 'save').mockResolvedValue(tpl('whatsapp', 'Nuevo formato libre sin títulos', 2))
    renderPage('/plantilla?tipo=whatsapp')
    const user = userEvent.setup()
    const ta = await screen.findByLabelText('Texto de la plantilla')
    await user.clear(ta)
    await user.type(ta, 'Nuevo formato libre sin títulos')
    await user.click(screen.getByRole('button', { name: 'Guardar plantilla' }))
    expect(save).toHaveBeenCalledWith('Nuevo formato libre sin títulos', 'whatsapp')
  })

  it('el resumen sigue exigiendo un título de sección', async () => {
    renderPage()
    const user = userEvent.setup()
    const ta = await screen.findByLabelText('Texto de la plantilla')
    await user.clear(ta)
    await user.type(ta, 'Texto sin ningún título de sección')
    expect(screen.getByRole('alert')).toHaveTextContent('título de sección')
    expect(screen.getByRole('button', { name: 'Guardar plantilla' })).toBeDisabled()
  })

  it('vista previa y restaurar envían el tipo', async () => {
    const preview = vi.spyOn(apiLib.templatesApi, 'preview').mockResolvedValue({ markdown: '*Hola* mensaje' })
    const reset = vi.spyOn(apiLib.templatesApi, 'reset').mockResolvedValue(tpl('whatsapp', 'Original del formato', 3))
    renderPage('/plantilla?tipo=whatsapp')
    const user = userEvent.setup()
    await screen.findByLabelText('Texto de la plantilla')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(preview).toHaveBeenCalledWith('*Formato WA* con instrucciones', 'whatsapp')
    expect(await screen.findByText('*Hola* mensaje')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restaurar la original' }))
    await user.click(screen.getByRole('button', { name: 'Sí, restaurar' }))
    expect(reset).toHaveBeenCalledWith('whatsapp')
  })
})

describe('Plantilla de reporte Excel', () => {
  it('?tipo=reporte abre la pestaña, avisa que aplica a reportes nuevos y muestra las columnas', async () => {
    vi.spyOn(apiLib.templatesApi, 'active').mockResolvedValue(tpl('reporte', '- Paciente: nombre\n- Hospital: nombre del hospital'))
    const preview = vi.spyOn(apiLib.templatesApi, 'preview').mockResolvedValue({
      markdown: '',
      columnas: [{ nombre: 'Paciente', instruccion: 'nombre' }, { nombre: 'Hospital', instruccion: 'nombre del hospital' }],
      error: null,
    })
    renderPage('/plantilla?tipo=reporte')
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Texto de la plantilla')).toHaveValue('- Paciente: nombre\n- Hospital: nombre del hospital')
    expect(screen.getByRole('tab', { name: 'Reporte Excel' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/en cada reporte nuevo/)).toBeInTheDocument()
    expect(screen.queryByText(/consume un poco/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(preview).toHaveBeenCalledWith('- Paciente: nombre\n- Hospital: nombre del hospital', 'reporte')
    expect(await screen.findByText('2 columnas en el Excel')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Hospital' })).toBeInTheDocument()
  })

  it('muestra el error de formato de la vista previa', async () => {
    vi.spyOn(apiLib.templatesApi, 'active').mockResolvedValue(tpl('reporte', '- Paciente: nombre'))
    vi.spyOn(apiLib.templatesApi, 'preview').mockResolvedValue({ markdown: '', columnas: [], error: 'Hay nombres de columna repetidos.' })
    renderPage('/plantilla?tipo=reporte')
    const user = userEvent.setup()
    await screen.findByLabelText('Texto de la plantilla')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByTestId('error-columnas')).toHaveTextContent('repetidos')
  })
})
