import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionProvider } from '../../context/session'
import { callsOf, mockFetch, type MockHandler } from '../../test/mockFetch'
import Login from './page'

const user = { id: '1', email: 'a@b.c', nombre: 'Ana' }

function renderLogin(login?: MockHandler) {
  const f = mockFetch({
    'GET /api/auth/me': { body: { authenticated: false } },
    'POST /api/auth/refresh': { status: 401, body: {} },
    ...(login ? { 'POST /api/auth/login': login } : {}),
  })
  render(
    <SessionProvider>
      <Login />
    </SessionProvider>,
  )
  return f
}

async function fill(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText('Correo'), 'a@b.c')
  await u.type(screen.getByLabelText('Contraseña'), 'secreta123')
}

afterEach(() => vi.unstubAllGlobals())

describe('login', () => {
  it('envía correo y contraseña (también con Enter)', async () => {
    const bodies: unknown[] = []
    const u = userEvent.setup()
    renderLogin((r) => (bodies.push(r.body), { body: { user } }))
    await u.type(screen.getByLabelText('Correo'), 'a@b.c')
    await u.type(screen.getByLabelText('Contraseña'), 'secreta123{Enter}')
    await waitFor(() => expect(bodies).toEqual([{ email: 'a@b.c', password: 'secreta123' }]))
  })

  it('error 401: mensaje genérico', async () => {
    const u = userEvent.setup()
    renderLogin({ status: 401, body: { message: 'Correo o contraseña incorrectos' } })
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos')
  })

  it('429: pide esperar un minuto', async () => {
    const u = userEvent.setup()
    renderLogin({ status: 429, body: {} })
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
    const u = userEvent.setup()
    const f = renderLogin()
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(callsOf(f)).not.toContain('POST /api/auth/login')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
