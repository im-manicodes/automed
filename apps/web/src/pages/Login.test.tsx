import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionProvider } from '../context/session'
import * as apiLib from '../lib/api'
import Login from './Login'

const user = { id: '1', email: 'a@b.c', nombre: 'Ana' }

function renderLogin() {
  vi.spyOn(apiLib.authApi, 'me').mockResolvedValue({ authenticated: false })
  return render(
    <SessionProvider>
      <Login />
    </SessionProvider>,
  )
}

async function fill(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText('Correo'), 'a@b.c')
  await u.type(screen.getByLabelText('Contraseña'), 'secreta123')
}

afterEach(() => vi.restoreAllMocks())

describe('login', () => {
  it('envía correo y contraseña (también con Enter)', async () => {
    const login = vi.spyOn(apiLib.authApi, 'login').mockResolvedValue({ user })
    const u = userEvent.setup()
    renderLogin()
    await u.type(screen.getByLabelText('Correo'), 'a@b.c')
    await u.type(screen.getByLabelText('Contraseña'), 'secreta123{Enter}')
    await waitFor(() => expect(login).toHaveBeenCalledWith('a@b.c', 'secreta123'))
  })

  it('error 401: mensaje genérico', async () => {
    vi.spyOn(apiLib.authApi, 'login').mockRejectedValue(new apiLib.ApiError(401, 'Correo o contraseña incorrectos'))
    const u = userEvent.setup()
    renderLogin()
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos')
  })

  it('429: pide esperar un minuto', async () => {
    vi.spyOn(apiLib.authApi, 'login').mockRejectedValue(new apiLib.ApiError(429, 'x'))
    const u = userEvent.setup()
    renderLogin()
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Espera un minuto')
  })

  it('muestra y oculta la contraseña', async () => {
    const u = userEvent.setup()
    renderLogin()
    const input = screen.getByLabelText('Contraseña')
    expect(input).toHaveAttribute('type', 'password')
    await u.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(input).toHaveAttribute('type', 'text')
  })

  it('sin datos no llama a la API', async () => {
    const login = vi.spyOn(apiLib.authApi, 'login')
    const u = userEvent.setup()
    renderLogin()
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(login).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
