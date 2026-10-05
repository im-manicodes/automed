import { Outlet } from 'react-router-dom'
import { useSession } from '../context/session'
import Login from '../pages/Login'
import Spinner from './Spinner'

/** Muestra la pantalla de entrada si no hay sesión (también tras un 401). */
export default function ProtectedRoute() {
  const { session } = useSession()
  if (session.status === 'loading') return <Spinner text="Cargando…" full />
  if (session.status === 'anonymous') return <Login error={session.error} />
  return <Outlet />
}
