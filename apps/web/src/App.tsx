import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import GuardaBienvenida from './components/GuardaBienvenida'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Spinner from './components/Spinner'
import Ajustes from './pages/ajustes/page'
import Bienvenida from './pages/bienvenida/page'
import ConfiguracionIa from './pages/configuracion-ia/page'
import Plantilla from './pages/plantilla/page'
import Reportes from './pages/reportes/page'
import TicketDetalle from './pages/ticket-detalle/page'
import Tickets from './pages/tickets/page'

// Flujo de corrección de OCR (carga diferida).
const RevisionPage = lazy(() => import('./pages/revision/page'))

export default function App() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
       <Route element={<GuardaBienvenida />}>
        <Route path="/bienvenida" element={<Bienvenida />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/tickets/:id" element={<TicketDetalle />} />
          <Route
            path="/tickets/:id/revision/:attachmentId"
            element={
              <Suspense fallback={<Spinner text="Cargando…" />}>
                <RevisionPage />
              </Suspense>
            }
          />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/plantilla" element={<Plantilla />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="/ajustes/ia" element={<ConfiguracionIa />} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Route>
       </Route>
      </Route>
    </Routes>
  )
}
