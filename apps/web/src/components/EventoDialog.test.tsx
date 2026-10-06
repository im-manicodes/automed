import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import { ApiError, type Evento, type EventoBorrador, type MessageInfo } from '../lib/api'
import EventoDialog from './EventoDialog'

const borrador = (o: Partial<EventoBorrador> = {}): EventoBorrador => ({
  synthesisId: 's1',
  templateVersion: 2,
  columnas: [
    { nombre: 'Paciente', instruccion: 'Nombre completo' },
    { nombre: 'Diagnóstico', instruccion: 'Diagnóstico principal' },
  ],
  datos: { Paciente: 'Ana', Diagnóstico: 'Neumonía con derrame pleural bilateral y fiebre persistente de tres días' },
  estado: 'hospitalizado',
  novedadTexto: 'Mejora la fiebre',
  fechaEvento: '2026-10-05T15:00:00.000Z',
  yaRegistrado: null,
  ...o,
})

const creado: Evento = {
  id: 'e1', threadId: 't1', synthesisId: 's1', fechaEvento: '2026-10-05T15:00:00.000Z', fecha: '2026-10-05',
  estado: 'hospitalizado', novedadTexto: '', datos: {}, columnas: [], templateVersion: 2, createdAt: '2026-10-06T10:00:00Z',
}

const mensajes = (n = 1): MessageInfo[] => [
  {
    id: 'm1', from: 'dra@hosp.mx', to: [], cc: [], subject: 's', bodyText: '', isFromMe: false, receivedAt: '2026-10-05T10:00:00Z',
    attachments: Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, filename: `informe${i + 1}.pdf`, size: 1, sha256: 'x', status: 'listo' as const })),
  },
]

function renderDlg(b = borrador(), extra: { onClose?: () => void; onSaved?: (e: Evento) => void; onConflict?: () => void; mensajes?: MessageInfo[]; resumen?: string | null } = {}) {
  const props = { onClose: vi.fn(), onSaved: vi.fn(), ...extra }
  render(
    <ToastProvider>
      <button>abrir</button>
      <EventoDialog threadId="t1" asunto="Paciente Uno" resumen="# Resumen vigente" borrador={b} {...props} />
    </ToastProvider>,
  )
  return props
}

afterEach(() => vi.restoreAllMocks())

describe('EventoDialog', () => {
  it('es un diálogo modal con aviso, un campo por columna y foco en el primero', () => {
    renderDlg()
    expect(screen.getByRole('dialog', { name: 'Añadir al Excel' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Revisa los datos: los propone la inteligencia artificial.')).toBeInTheDocument()
    const pac = screen.getByLabelText('Paciente')
    expect(pac).toHaveValue('Ana')
    expect(pac.tagName).toBe('INPUT')
    expect(pac).toHaveFocus()
    expect(screen.getByLabelText('Diagnóstico').tagName).toBe('TEXTAREA')
    expect(screen.getByText('Nombre completo')).toBeInTheDocument()
    expect(screen.getByLabelText('Estado')).toHaveValue('hospitalizado')
    expect(screen.getByLabelText('Qué cambió')).toHaveValue('Mejora la fiebre')
  })

  it('guarda lo editado con el contrato de la API y avisa', async () => {
    const create = vi.spyOn(apiLib.threadsApi, 'createEvent').mockResolvedValue(creado)
    const { onSaved } = renderDlg()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Paciente'), ' López')
    await user.selectOptions(screen.getByLabelText('Estado'), 'alta')
    await user.click(screen.getByRole('button', { name: 'Añadir al Excel' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(creado))
    expect(create).toHaveBeenCalledTimes(1)
    const [id, body] = create.mock.calls[0]
    expect(id).toBe('t1')
    expect(body).toMatchObject({ synthesisId: 's1', estado: 'alta', novedadTexto: 'Mejora la fiebre', fechaEvento: '2026-10-05T15:00:00.000Z' })
    expect(body.datos.Paciente).toBe('Ana López')
    expect(await screen.findByText('Añadido al Excel.')).toBeInTheDocument()
  })

  it('un valor de más de 2000 caracteres bloquea el guardado', () => {
    renderDlg(borrador({ datos: { Paciente: 'x'.repeat(2001), Diagnóstico: '' } }))
    expect(screen.getByRole('alert')).toHaveTextContent(/muy largo/)
    expect(screen.getByRole('button', { name: 'Añadir al Excel' })).toBeDisabled()
  })

  it('«Qué cambió» de más de 1000 caracteres bloquea el guardado', () => {
    renderDlg(borrador({ novedadTexto: 'y'.repeat(1001) }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Qué cambió/)
    expect(screen.getByRole('button', { name: 'Añadir al Excel' })).toBeDisabled()
  })

  it('una fecha futura lejana bloquea el guardado', async () => {
    renderDlg()
    const fecha = screen.getByLabelText('Fecha del evento')
    fireEvent.change(fecha, { target: { value: '2999-01-01' } })
    expect(await screen.findByText(/fecha válida/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Añadir al Excel' })).toBeDisabled()
  })

  it('409: explica el motivo en el diálogo y pide refrescar', async () => {
    vi.spyOn(apiLib.threadsApi, 'createEvent').mockRejectedValue(new ApiError(409, 'Conflict técnico'))
    const { onConflict, onSaved } = renderDlg(borrador(), { onConflict: vi.fn() })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Añadir al Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya se añadió, cambió/)
    expect(screen.queryByText('Conflict técnico')).toBeNull()
    expect(onConflict).toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('otros errores muestran el mensaje del servidor', async () => {
    vi.spyOn(apiLib.threadsApi, 'createEvent').mockRejectedValue(new ApiError(400, 'Dato inválido'))
    renderDlg()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Añadir al Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Dato inválido')
  })

  it('Esc y Cancelar cierran sin preguntar si no hay cambios', async () => {
    const { onClose } = renderDlg()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('con cambios, Esc pide confirmación: seguir revisando no cierra y salir sí', async () => {
    const { onClose } = renderDlg()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Paciente'), 'x')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Tienes cambios sin guardar')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(screen.getByRole('button', { name: 'Salir sin guardar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('muestra el asunto, el resumen y las pestañas; cambiar de pestaña no pierde lo tecleado', async () => {
    renderDlg(borrador(), { mensajes: mensajes() })
    const user = userEvent.setup()
    expect(screen.getByText('Paciente Uno')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Formulario' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Paciente'), ' Pérez')
    await user.click(screen.getByRole('tab', { name: 'Resumen' }))
    expect(screen.getByRole('heading', { name: 'Resumen vigente' })).toBeVisible()
    expect(screen.getByLabelText('Paciente', { selector: 'input' })).not.toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Formulario' }))
    expect(screen.getByLabelText('Paciente')).toHaveValue('Ana Pérez')
  })

  it('«Adjuntos» no pide nada hasta abrir la pestaña y luego carga las páginas', async () => {
    const pages = vi.spyOn(apiLib.attachmentsApi, 'pages').mockResolvedValue({ attachmentId: 'a1', filename: 'informe1.pdf', status: 'listo', pages: [{ pageNumber: 1, regions: [] }, { pageNumber: 2, regions: [] }] })
    renderDlg(borrador(), { mensajes: mensajes(2) })
    expect(pages).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument()
    expect(pages).toHaveBeenCalledTimes(1)
    expect(pages).toHaveBeenCalledWith('a1')
    expect(screen.getByRole('combobox', { name: 'Documento' })).toBeInTheDocument()
    expect(screen.getByText('Del correo de dra@hosp.mx')).toBeInTheDocument()
  })

  it('«Adjuntos» sin PDF o sin vista previa muestra un mensaje sencillo', async () => {
    const { unmount } = render(
      <ToastProvider>
        <EventoDialog threadId="t1" borrador={borrador()} mensajes={[]} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    )
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(screen.getByText('Este ticket no tiene PDF.')).toBeInTheDocument()
    unmount()

    vi.spyOn(apiLib.attachmentsApi, 'pages').mockResolvedValue({ attachmentId: 'a1', filename: 'informe1.pdf', status: 'listo', pages: [] })
    renderDlg(borrador(), { mensajes: mensajes() })
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(await screen.findByText('Este documento no tiene vista previa disponible.')).toBeInTheDocument()
  })

  it('«Adjuntos» muestra el error si fallan las páginas', async () => {
    vi.spyOn(apiLib.attachmentsApi, 'pages').mockRejectedValue(new ApiError(500, 'Falló la carga'))
    renderDlg(borrador(), { mensajes: mensajes() })
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(await screen.findByText('Falló la carga')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument()
  })

  it('devuelve el foco al elemento previo al desmontar', () => {
    const btn = document.createElement('button')
    document.body.append(btn)
    btn.focus()
    const { unmount } = render(
      <ToastProvider>
        <EventoDialog threadId="t1" borrador={borrador()} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    )
    expect(btn).not.toHaveFocus()
    unmount()
    expect(btn).toHaveFocus()
    btn.remove()
  })
})
