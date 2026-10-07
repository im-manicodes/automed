import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '../context/session'
import * as apiLib from '../lib/api'
import { mockFetch } from '../test/mockFetch'
import ProtectedRoute from './ProtectedRoute'

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/secreto']}>
      <SessionProvider>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/secreto" element={<p>Contenido privado</p>} />
          </Route>
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

const yo = { id: '1', email: 'a@b.c', nombre: 'Ana' }

describe('ruta protegida', () => {
  it('sin sesión muestra la pantalla de entrada', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { authenticated: false } },
      'POST /api/auth/refresh': { status: 401, body: {} },
      'GET /api/auth/setup-status': { body: { needsSetup: false } },
    })
    renderApp()
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('sin sesión y sin ningún usuario muestra el formulario del primer usuario', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { authenticated: false } },
      'POST /api/auth/refresh': { status: 401, body: {} },
      'GET /api/auth/setup-status': { body: { needsSetup: true } },
    })
    renderApp()
    expect(await screen.findByRole('button', { name: 'Crear usuario y entrar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
  })

  it('si la consulta de configuración inicial falla, muestra la entrada (no bloquea)', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { authenticated: false } },
      'POST /api/auth/refresh': { status: 401, body: {} },
      'GET /api/auth/setup-status': { status: 500, body: {} },
    })
    renderApp()
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('con sesión muestra el contenido', async () => {
    mockFetch({ 'GET /api/auth/me': { body: { authenticated: true, user: yo } } })
    renderApp()
    await waitFor(() => expect(screen.getByText('Contenido privado')).toBeInTheDocument())
  })

  it('un 401 posterior devuelve a la pantalla de entrada', async () => {
    mockFetch({ 'GET /api/auth/me': { body: { authenticated: true, user: yo } } })
    renderApp()
    await screen.findByText('Contenido privado')
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(url.endsWith('/auth/setup-status') ? '{"needsSetup":false}' : '{}', { status: url.endsWith('/auth/setup-status') ? 200 : 401 }))))
    await apiLib.api('/threads').catch(() => {})
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
