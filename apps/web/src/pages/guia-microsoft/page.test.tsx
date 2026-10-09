import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { mockFetch } from '../../test/mockFetch'
import GuiaMicrosoft from './page'

afterEach(() => vi.unstubAllGlobals())

function renderPage() {
  render(
    <MemoryRouter>
      <GuiaMicrosoft />
    </MemoryRouter>,
  )
}

describe('Guía rápida de Microsoft', () => {
  it('muestra los pasos, los permisos y la dirección sugerida', async () => {
    mockFetch({
      'GET /api/settings/microsoft': { body: { configurado: false, clientId: '', tenantId: 'common', tieneSecreto: false, redirectUri: '', redirectUriSugerida: 'https://mi.app/api/auth/callback' } },
    })
    renderPage()
    expect(screen.getByRole('heading', { name: 'Guía rápida de Microsoft' })).toBeInTheDocument()
    expect(screen.getByText(/offline_access/)).toBeInTheDocument()
    expect(await screen.findByText('https://mi.app/api/auth/callback')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Volver a Ajustes/ })).toHaveAttribute('href', '/ajustes')
  })
})
