import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../context/toasts'
import { callsOf, mockFetch, type MockHandler } from '../../../test/mockFetch'
import FormatosDialog from './FormatosDialog'

const formatos = [
  {
    id: 'ingreso-pemex', titulo: 'Ingreso PEMEX',
    campos: [
      { clave: 'nombre', etiqueta: 'Nombre', seccion: 'Paciente', tipo: 'texto', maxLen: 20 },
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', seccion: 'Clínica', tipo: 'texto_largo' },
      { clave: 'sexo', etiqueta: 'Sexo', seccion: 'Paciente', tipo: 'opcion', opciones: [{ valor: 'masculino', etiqueta: 'Masculino' }, { valor: 'femenino', etiqueta: 'Femenino' }] },
      { clave: 'triage', etiqueta: 'Triage', seccion: 'Clínica', tipo: 'opcion', opciones: [{ valor: 'rojo', etiqueta: 'Rojo' }, { valor: 'verde', etiqueta: 'Verde' }] },
      { clave: 'ingreso', etiqueta: 'Fecha de ingreso', seccion: 'Paciente', tipo: 'fecha' },
      { clave: 'firma', etiqueta: 'Firma del médico', seccion: 'Administrativo', tipo: 'texto', soloManual: true },
    ],
  },
  { id: 'cirugia-f03', titulo: 'Cirugía F03', campos: [] },
]

const borrador = { formato: 'ingreso-pemex', valores: { nombre: 'Ana', diagnostico: null, sexo: null, triage: null, ingreso: '2026-10-01' }, faltantes: ['diagnostico'], errores: [] }

function setup(routes: Record<string, MockHandler> = {}, resumen: string | null = '# Resumen vigente\n\nNeumonía en estudio') {
  const onClose = vi.fn()
  const f = mockFetch({
    'GET /api/forms': { body: formatos },
    'GET /api/threads/t1/forms/ingreso-pemex/draft': { body: { existe: false, valores: {}, desactualizado: false, actualizadoEn: null, camposEditados: [] } },
    'POST /api/threads/t1/form-draft': { body: borrador },
    'PUT /api/threads/t1/forms/ingreso-pemex/draft': { body: { ok: true } },
    ...routes,
  })
  render(
    <ToastProvider>
      <FormatosDialog threadId="t1" asunto="Paciente Uno" resumen={resumen} mensajes={[]} onClose={onClose} />
    </ToastProvider>,
  )
  return { f, onClose }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('FormatosDialog', () => {
  it('lista los formatos, muestra el borrador, permite editar y descarga con los valores editados', async () => {
    const user = userEvent.setup()
    const { f } = setup({ 'POST /api/threads/t1/forms/ingreso-pemex/pdf': { body: new Blob(['%PDF']) } })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Ana')
    expect(screen.getByText('3 campos sin llenar')).toBeInTheDocument()
    expect(screen.getAllByText('Falta llenar').length).toBe(3)
    expect(screen.getByText('Se llena a mano (opcional)')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^Nombre/))
    await user.type(screen.getByLabelText(/^Nombre/), 'Beatriz')
    await user.type(screen.getByLabelText(/^Diagnóstico/), 'Neumonía')
    expect(screen.getByText('7/20 caracteres')).toBeInTheDocument()
    await user.click(screen.getByText('Femenino'))
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }))

    await waitFor(() => expect(callsOf(f)).toContain('POST /api/threads/t1/forms/ingreso-pemex/pdf'))
    const call = f.mock.calls.find(([u]) => String(u).endsWith('/pdf'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      valores: { nombre: 'Beatriz', diagnostico: 'Neumonía', sexo: 'femenino', triage: null, ingreso: '2026-10-01' },
    })
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('avisa si se eligen sexo y triage a la vez', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await screen.findByLabelText(/^Nombre/)
    expect(screen.queryByText(/comparten el mismo grupo/)).not.toBeInTheDocument()
    await user.click(screen.getByText('Masculino'))
    await user.click(screen.getByText('Rojo'))
    expect(screen.getByRole('alert')).toHaveTextContent('comparten el mismo grupo')
  })

  it('muestra un mensaje claro en 409 y 503 y permite reintentar', async () => {
    const user = userEvent.setup()
    let status = 503
    setup({ 'POST /api/threads/t1/form-draft': () => (status === 0 ? { body: borrador } : { status, body: { message: 'x' } }) })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    expect(await screen.findByText(/La IA no pudo preparar el formato/)).toBeInTheDocument()
    status = 409
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText(/el ticket debe estar listo/)).toBeInTheDocument()
    status = 0
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Ana')
  })

  it('con borrador guardado entra directo sin llamar a la IA y muestra la fecha', async () => {
    const user = userEvent.setup()
    const { f } = setup({
      'GET /api/threads/t1/forms/ingreso-pemex/draft': { body: { existe: true, valores: { nombre: 'Guardada', ingreso: '2026-10-01' }, desactualizado: false, actualizadoEn: '2026-10-10T15:00:00.000Z', camposEditados: ['nombre'] } },
    })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Guardada')
    expect(screen.getByText(/Guardado el/)).toBeInTheDocument()
    expect(callsOf(f)).not.toContain('POST /api/threads/t1/form-draft')
    expect(screen.queryByText(/El resumen cambió/)).not.toBeInTheDocument()
  })

  it('sin borrador pide la primera propuesta a la IA', async () => {
    const user = userEvent.setup()
    const { f } = setup()
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Ana')
    expect(callsOf(f)).toContain('POST /api/threads/t1/form-draft')
  })

  it('autoguarda con PUT tras el debounce y cierra sin preguntar', async () => {
    const user = userEvent.setup()
    const { f, onClose } = setup()
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await screen.findByLabelText(/^Nombre/)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Beatriz' } })
      expect(callsOf(f)).not.toContain('PUT /api/threads/t1/forms/ingreso-pemex/draft')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600)
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(callsOf(f)).toContain('PUT /api/threads/t1/forms/ingreso-pemex/draft'))
    const call = f.mock.calls.find(([, i]) => i?.method === 'PUT')!
    expect(JSON.parse(String(call[1]?.body)).valores.nombre).toBe('Beatriz')
    expect(await screen.findByText('Guardado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('al cerrar con cambios guarda primero; si falla pide confirmar', async () => {
    const user = userEvent.setup()
    const { f, onClose } = setup({ 'PUT /api/threads/t1/forms/ingreso-pemex/draft': { status: 500, body: { message: 'x' } } })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await user.type(await screen.findByLabelText(/^Nombre/), 'x')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(callsOf(f)).toContain('PUT /api/threads/t1/forms/ingreso-pemex/draft')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/No se pudo guardar/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Seguir revisando' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salir de todos modos' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('si el resumen cambió, «Actualizar con IA» confirma y envía actualizar:true', async () => {
    const user = userEvent.setup()
    const { f } = setup({
      'GET /api/threads/t1/forms/ingreso-pemex/draft': { body: { existe: true, valores: { nombre: 'Vieja' }, desactualizado: true, actualizadoEn: '2026-10-10T15:00:00.000Z', camposEditados: [] } },
      'POST /api/threads/t1/form-draft': { body: { ...borrador, valores: { nombre: 'Nueva' }, desactualizado: false, guardado: true } },
    })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    expect(await screen.findByText(/El resumen cambió desde esta propuesta/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar con IA' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Actualizar con IA' }))
    await waitFor(() => expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Nueva'))
    const call = f.mock.calls.find(([u]) => String(u).endsWith('/form-draft'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({ formato: 'ingreso-pemex', actualizar: true })
    expect(screen.queryByText(/El resumen cambió/)).not.toBeInTheDocument()
  })

  it('vista previa: muestra las páginas y «Actualizar vista previa» la vuelve a pedir', async () => {
    const user = userEvent.setup()
    let n = 0
    const { f } = setup({ 'POST /api/threads/t1/forms/ingreso-pemex/preview': () => ({ body: { paginas: [`data:image/png;base64,A${++n}`, 'data:image/png;base64,B'] } }) })
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await screen.findByLabelText(/^Nombre/)
    await user.click(screen.getByRole('tab', { name: 'Vista previa' }))
    expect(await screen.findByAltText('Página 1 del formato')).toBeInTheDocument()
    expect(screen.getByAltText('Página 2 del formato')).toBeInTheDocument()
    expect(f.mock.calls.filter(([u]) => String(u).endsWith('/preview')).length).toBe(1)
    await user.click(screen.getByRole('tab', { name: 'Formulario' }))
    await user.type(screen.getByLabelText(/^Nombre/), 'z')
    await user.click(screen.getByRole('tab', { name: 'Vista previa' }))
    expect(screen.getByText(/Hay cambios nuevos/)).toBeInTheDocument()
    expect(f.mock.calls.filter(([u]) => String(u).endsWith('/preview')).length).toBe(1)
    await user.click(screen.getByRole('button', { name: /Actualizar vista previa/ }))
    await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u).endsWith('/preview')).length).toBe(2))
    const call = f.mock.calls.filter(([u]) => String(u).endsWith('/preview')).pop()!
    expect(JSON.parse(String(call[1]?.body)).valores.nombre).toBe('Anaz')
    await waitFor(() => expect(screen.queryByText(/Hay cambios nuevos/)).not.toBeInTheDocument())
  })

  it('cierra sin preguntar si no hay cambios', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('con borrador muestra el resumen y las pestañas Formulario | Resumen | Adjuntos', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await screen.findByLabelText(/^Nombre/)
    expect(screen.getByRole('tab', { name: 'Formulario' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Resumen' }))
    expect(screen.getByText('Neumonía en estudio')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(screen.getByRole('tab', { name: 'Adjuntos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Neumonía en estudio')).not.toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Formulario' }))
    expect(screen.getByLabelText(/^Nombre/)).toBeVisible()
  })

  it('sin resumen avisa que el ticket aún no lo tiene', async () => {
    const user = userEvent.setup()
    setup({}, null)
    await user.click(await screen.findByRole('button', { name: /Ingreso PEMEX/ }))
    await screen.findByLabelText(/^Nombre/)
    await user.click(screen.getByRole('tab', { name: 'Resumen' }))
    expect(screen.getByText('Este ticket aún no tiene resumen.')).toBeVisible()
  })
})
