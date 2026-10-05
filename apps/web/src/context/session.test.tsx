import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../lib/api'
import { SessionProvider } from './session'
import { useSession } from './session-context'

vi.mock('../lib/api', () => ({
  authApi: { me: vi.fn(), refresh: vi.fn(), login: vi.fn(), logout: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))

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
  beforeEach(() => vi.clearAllMocks())

  it('usa la sesión si /me ya está autenticado y no refresca', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ authenticated: true, user: usuario })
    mostrar()
    await waitFor(() => expect(screen.getByText('hola Ana')).toBeInTheDocument())
    expect(authApi.refresh).not.toHaveBeenCalled()
  })

  it('renueva con refresh cuando el access caducó (me no autenticado)', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ authenticated: false })
    vi.mocked(authApi.refresh).mockResolvedValue({ user: usuario })
    mostrar()
    await waitFor(() => expect(screen.getByText('hola Ana')).toBeInTheDocument())
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('queda anónimo si el refresh también falla', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ authenticated: false })
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('401'))
    mostrar()
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument())
  })
})
