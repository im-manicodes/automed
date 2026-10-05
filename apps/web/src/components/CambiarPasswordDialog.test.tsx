import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../context/toasts'
import * as apiLib from '../lib/api'
import { validarNuevaPassword } from '../lib/password'
import CambiarPasswordDialog from './CambiarPasswordDialog'

afterEach(() => vi.restoreAllMocks())

describe('validarNuevaPassword', () => {
  it('aplica la política', () => {
    expect(validarNuevaPassword('', 'x'.repeat(10), 'x'.repeat(10))).toMatch(/actual/)
    expect(validarNuevaPassword('a', 'corta', 'corta')).toMatch(/al menos 10/)
    expect(validarNuevaPassword('a', 'x'.repeat(10), 'y'.repeat(10))).toMatch(/no coinciden/)
    expect(validarNuevaPassword('x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10))).toMatch(/distinta/)
    expect(validarNuevaPassword('a', 'x'.repeat(10), 'x'.repeat(10))).toBeNull()
  })
})

describe('diálogo de cambio de contraseña', () => {
  const setup = () => {
    const onClose = vi.fn()
    render(<ToastProvider><CambiarPasswordDialog onClose={onClose} /></ToastProvider>)
    return onClose
  }

  it('rechaza una contraseña corta sin llamar a la API', async () => {
    const change = vi.spyOn(apiLib.authApi, 'changePassword')
    const u = userEvent.setup()
    setup()
    await u.type(screen.getByLabelText('Contraseña actual'), 'vieja')
    await u.type(screen.getByLabelText('Contraseña nueva'), 'corta')
    await u.type(screen.getByLabelText('Repite la contraseña nueva'), 'corta')
    await u.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('al menos 10')
    expect(change).not.toHaveBeenCalled()
  })

  it('guarda y cierra', async () => {
    const change = vi.spyOn(apiLib.authApi, 'changePassword').mockResolvedValue(undefined)
    const u = userEvent.setup()
    const onClose = setup()
    await u.type(screen.getByLabelText('Contraseña actual'), 'vieja')
    await u.type(screen.getByLabelText('Contraseña nueva'), 'nueva-larga-1')
    await u.type(screen.getByLabelText('Repite la contraseña nueva'), 'nueva-larga-1')
    await u.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    await waitFor(() => expect(change).toHaveBeenCalledWith('vieja', 'nueva-larga-1'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
