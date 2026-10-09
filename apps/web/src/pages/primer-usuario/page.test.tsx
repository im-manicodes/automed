import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '../../components/ProtectedRoute'
import { SessionProvider } from '../../context/session'
import { mockFetch, type MockHandler } from '../../test/mockFetch'

afterEach(() => vi.unstubAllGlobals())

const yo = { id: '1', email: 'ana@clinica.mx', nombre: 'Ana' }

function renderApp(setup: MockHandler, requiresToken = false) {
  const f = mockFetch({
    'GET /api/auth/me': { body: { authenticated: false } },
    'POST /api/auth/refresh': { status: 401, body: {} },
    'GET /api/auth/setup-status': { body: { needsSetup: true, requiresToken } },
    'POST /api/auth/setup': setup,
  })
  render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<p>Dentro de la app</p>} />
          </Route>
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
  return f
}

async function llenar(user: ReturnType<typeof userEvent.setup>, password = 'una-clave-larga-1') {
  await user.type(await screen.findByLabelText('Correo'), 'ana@clinica.mx')
  await user.type(screen.getByLabelText('Nombre'), 'Ana')
  await user.type(screen.getByLabelText('Contraseña'), password)
}

describe('Primer usuario', () => {
  it('crea el usuario, entra con la sesión devuelta y envía los datos', async () => {
    const f = renderApp({ body: { user: yo } })
    const user = userEvent.setup()
    await llenar(user)
    await user.click(screen.getByRole('button', { name: 'Crear usuario y entrar' }))
    await waitFor(() => expect(screen.getByText('Dentro de la app')).toBeInTheDocument())
    const post = f.mock.calls.find(([u]) => String(u) === '/api/auth/setup')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ email: 'ana@clinica.mx', nombre: 'Ana', password: 'una-clave-larga-1' })
  })

  it('pide el código de instalación cuando el servidor lo exige y lo envía', async () => {
    const f = renderApp({ body: { user: yo } }, true)
    const user = userEvent.setup()
    await llenar(user)
    await user.type(await screen.findByLabelText('Código de instalación'), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Crear usuario y entrar' }))
    await waitFor(() => expect(screen.getByText('Dentro de la app')).toBeInTheDocument())
    const post = f.mock.calls.find(([u]) => String(u) === '/api/auth/setup')
    expect(JSON.parse(String(post?.[1]?.body)).setupToken).toBe('abc123')
  })

  it('exige 10 caracteres y no llama al servidor', async () => {
    const f = renderApp({ body: { user: yo } })
    const user = userEvent.setup()
    await llenar(user, 'corta')
    await user.click(screen.getByRole('button', { name: 'Crear usuario y entrar' }))
    expect(await screen.findByText('La contraseña debe tener al menos 10 caracteres.')).toBeInTheDocument()
    expect(f.mock.calls.some(([u]) => String(u) === '/api/auth/setup')).toBe(false)
  })

  it('Mostrar/Ocultar alterna la visibilidad de la contraseña', async () => {
    renderApp({ body: { user: yo } })
    const user = userEvent.setup()
    const campo = await screen.findByLabelText('Contraseña')
    expect(campo).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(campo).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument()
  })

  it('409: avisa que ya hay un usuario creado', async () => {
    renderApp({ status: 409, body: { message: 'Ya existe un usuario.' } })
    const user = userEvent.setup()
    await llenar(user)
    await user.click(screen.getByRole('button', { name: 'Crear usuario y entrar' }))
    expect(await screen.findByText(/Ya hay un usuario creado/)).toBeInTheDocument()
    expect(screen.queryByText('Dentro de la app')).not.toBeInTheDocument()
  })

  it('400: muestra el mensaje del servidor', async () => {
    renderApp({ status: 400, body: { message: 'El correo no es válido.' } })
    const user = userEvent.setup()
    await llenar(user)
    await user.click(screen.getByRole('button', { name: 'Crear usuario y entrar' }))
    expect(await screen.findByText('El correo no es válido.')).toBeInTheDocument()
  })
})
