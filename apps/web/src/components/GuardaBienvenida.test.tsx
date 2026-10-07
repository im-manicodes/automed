import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ajustesIa } from '../test/ajustesIa'
import { mockFetch } from '../test/mockFetch'
import GuardaBienvenida from './GuardaBienvenida'

function renderApp(ruta = '/tickets') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<GuardaBienvenida />}>
          <Route path="/bienvenida" element={<p>Asistente</p>} />
          <Route path="/tickets" element={<p>Mis tickets</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('GuardaBienvenida', () => {
  it('redirige a /bienvenida cuando hace falta', async () => {
    mockFetch({ 'GET /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: true }) } })
    renderApp()
    expect(await screen.findByText('Asistente')).toBeInTheDocument()
  })

  it('no redirige cuando ya se completó', async () => {
    mockFetch({ 'GET /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false }) } })
    renderApp()
    expect(await screen.findByText('Mis tickets')).toBeInTheDocument()
  })

  it('no bloquea la app si la consulta falla', async () => {
    mockFetch({ 'GET /api/settings/ia': { status: 500, body: { message: 'Fallo' } } })
    renderApp()
    await waitFor(() => expect(screen.getByText('Mis tickets')).toBeInTheDocument())
  })
})
