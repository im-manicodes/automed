import { useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAjustesIa } from '../hooks/useAjustesIa'
import type { BienvenidaCtx } from './guarda-bienvenida-context'
import Spinner from './Spinner'

/** Lleva al asistente de bienvenida la primera vez. Si la consulta falla, no bloquea la app. */
export default function GuardaBienvenida() {
  const { data, loading } = useAjustesIa()
  const { pathname } = useLocation()
  const [completada, setCompletada] = useState(false)
  const ctx = useMemo<BienvenidaCtx>(() => ({ marcarCompletada: () => setCompletada(true) }), [])

  if (loading && !data) return <Spinner text="Cargando…" full />
  if (data?.necesitaBienvenida && !completada && pathname !== '/bienvenida') {
    return <Navigate to="/bienvenida" replace />
  }
  return <Outlet context={ctx} />
}
