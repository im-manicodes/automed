import { Outlet } from 'react-router-dom'
import { useSession } from '../context/session-context'
import { useSetupStatus } from '../hooks/useSetupStatus'
import Login from '../pages/login/page'
import PrimerUsuario from '../pages/primer-usuario/page'
import Spinner from './Spinner'

/** Sin sesión: crea el primer usuario si aún no hay ninguno; si la consulta falla, muestra la entrada. */
function SinSesion({ error }: { error?: string }) {
  const { data, loading } = useSetupStatus()
  if (loading && !data) return <Spinner text="Cargando…" full />
  if (data?.needsSetup) return <PrimerUsuario />
  return <Login error={error} />
}

/** Muestra la pantalla de entrada si no hay sesión (también tras un 401). */
export default function ProtectedRoute() {
  const { session } = useSession()
  if (session.status === 'loading') return <Spinner text="Cargando…" full />
  if (session.status === 'anonymous') return <SinSesion error={session.error} />
  return <Outlet />
}
