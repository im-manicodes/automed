import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callsOf, mockFetch } from '../test/mockFetch'
import { SessionProvider } from './session'
import { useSession } from './session-context'

function Estado() {
  const { session } = useSession()
  return <p>{session.status === 'authenticated' ? `hola ${session.user.nombre}` : session.status}</p>
}

const usuario = { id: '1', email: 'a@b.c', nombre: 'Ana' }
const mostrar = () =>
  render(
    <SessionProvider>
      <Estado />
    </SessionProvider>,
  )

describe('SessionProvider al arrancar', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('usa la sesión si /me ya está autenticado y no refresca', async () => {
    const f = mockFetch({ 'GET /api/auth/me': { body: { authenticated: true, user: usuario } } })
    mostrar()
    await waitFor(() => expect(screen.getByText('hola Ana')).toBeInTheDocument())
    expect(callsOf(f)).not.toContain('POST /api/auth/refresh')
  })

  it('renueva con refresh cuando el access caducó (me no autenticado)', async () => {
    const f = mockFetch({
      'GET /api/auth/me': { body: { authenticated: false } },
      'POST /api/auth/refresh': { body: { user: usuario } },
    })
    mostrar()
    await waitFor(() => expect(screen.getByText('hola Ana')).toBeInTheDocument())
    expect(callsOf(f).filter((c) => c === 'POST /api/auth/refresh')).toHaveLength(1)
  })

  it('queda anónimo si el refresh también falla', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { authenticated: false } },
      'POST /api/auth/refresh': { status: 401, body: {} },
    })
    mostrar()
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument())
  })
})
