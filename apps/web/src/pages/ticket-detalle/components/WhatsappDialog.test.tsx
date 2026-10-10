import { render, screen, waitFor } from '@testing-library/react'
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
  it('es un diálogo modal con vista previa por defecto y nota de ayuda', () => {
    renderDlg('*Hola*')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(screen.getByText(/resumen del ticket/)).toBeInTheDocument()
    expect(screen.getByText('Hola').tagName).toBe('STRONG')
  })

  it('la vista previa renderiza negrita, cursiva y código', () => {
    renderDlg('*a* _b_ `c`\n• item')
    expect(screen.getByText('a').tagName).toBe('STRONG')
    expect(screen.getByText('b').tagName).toBe('EM')
    expect(screen.getByText('c').tagName).toBe('CODE')
    expect(screen.getByText('item')).toBeInTheDocument()
  })

  it('copia el texto editado CON las marcas y cierra con Esc / Cerrar', async () => {
    const copy = vi.spyOn(clipboard, 'copiarTexto').mockResolvedValue(true)
    const onClose = renderDlg('*hola*')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Editar' }))
    await user.type(screen.getByLabelText('Texto del mensaje'), ' mundo')
    await user.click(screen.getByRole('button', { name: /Copiar/ }))
    expect(copy).toHaveBeenCalledWith('*hola* mundo')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('los botones insertan formato sobre la selección', async () => {
    renderDlg('hola mundo')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Editar' }))
    const ta = screen.getByLabelText('Texto del mensaje') as HTMLTextAreaElement
    ta.setSelectionRange(5, 10)
    await user.click(screen.getByRole('button', { name: 'Negrita' }))
    expect(ta).toHaveValue('hola *mundo*')
    await waitFor(() => expect(ta.selectionStart).toBe(6))
    ta.setSelectionRange(0, 4)
    await user.click(screen.getByRole('button', { name: 'Cursiva' }))
    expect(ta).toHaveValue('_hola_ *mundo*')
    await waitFor(() => expect(ta.selectionStart).toBe(1))
    ta.setSelectionRange(0, 0)
    await user.click(screen.getByRole('button', { name: 'Código' }))
    expect(ta).toHaveValue('``_hola_ *mundo*')
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
