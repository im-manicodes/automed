import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '../context/session'
import * as apiLib from '../lib/api'
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

afterEach(() => vi.restoreAllMocks())

describe('ruta protegida', () => {
  it('sin sesión muestra la pantalla de entrada', async () => {
    vi.spyOn(apiLib.authApi, 'me').mockResolvedValue({ authenticated: false })
    renderApp()
    expect(await screen.findByRole('button', { name: 'Entrar con Microsoft' })).toBeInTheDocument()
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument()
  })

  it('con sesión muestra el contenido', async () => {
    vi.spyOn(apiLib.authApi, 'me').mockResolvedValue({ authenticated: true, email: 'a@b.c' })
    renderApp()
    await waitFor(() => expect(screen.getByText('Contenido privado')).toBeInTheDocument())
  })

  it('un 401 posterior devuelve a la pantalla de entrada', async () => {
    vi.spyOn(apiLib.authApi, 'me').mockResolvedValue({ authenticated: true, email: 'a@b.c' })
    renderApp()
    await screen.findByText('Contenido privado')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await apiLib.api('/threads').catch(() => {})
    expect(await screen.findByRole('button', { name: 'Entrar con Microsoft' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
