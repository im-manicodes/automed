import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../context/toasts'
import * as clipboard from '../../../lib/clipboard'
import WhatsappDialog from './WhatsappDialog'

function renderDlg(initial: string, onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WhatsappDialog initial={initial} onClose={onClose} />
      </ToastProvider>
    </MemoryRouter>,
  )
  return onClose
}

afterEach(() => vi.restoreAllMocks())

describe('WhatsappDialog', () => {
  it('es un diálogo modal con el texto editable y enfocado', () => {
    renderDlg('*Hola*')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    const ta = screen.getByLabelText('Texto del mensaje')
    expect(ta).toHaveValue('*Hola*')
    expect(ta).toHaveFocus()
    expect(screen.getByText(/solo el último correo/)).toBeInTheDocument()
  })

  it('copia el texto editado y cierra con Esc / Cerrar', async () => {
    const copy = vi.spyOn(clipboard, 'copiarTexto').mockResolvedValue(true)
    const onClose = renderDlg('hola')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Texto del mensaje'), ' mundo')
    await user.click(screen.getByRole('button', { name: /Copiar/ }))
    expect(copy).toHaveBeenCalledWith('hola mundo')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('Abrir WhatsApp es un enlace con el texto, y se deshabilita si es largo', async () => {
    renderDlg('hola')
    expect(screen.getByRole('link', { name: /Abrir WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/?text=hola')
  })

  it('ofrece un enlace para editar el formato del mensaje', async () => {
    const onClose = renderDlg('hola')
    const link = screen.getByRole('link', { name: /Editar formato del mensaje/ })
    expect(link).toHaveAttribute('href', '/plantilla?tipo=whatsapp')
    await userEvent.setup().click(link)
    expect(onClose).toHaveBeenCalled()
  })

  it('texto largo: botón deshabilitado con ayuda', () => {
    renderDlg('a'.repeat(3000))
    expect(screen.queryByRole('link', { name: /Abrir WhatsApp/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Abrir WhatsApp/ })).toBeDisabled()
    expect(screen.getByText(/muy largo/)).toBeInTheDocument()
  })
})
