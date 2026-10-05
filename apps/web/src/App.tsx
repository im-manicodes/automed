import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Ajustes from './pages/Ajustes'
import Plantilla from './pages/Plantilla'
import TicketDetalle from './pages/TicketDetalle'
import Tickets from './pages/Tickets'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/tickets" replace />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/tickets/:id" element={<TicketDetalle />} />
        <Route path="/plantilla" element={<Plantilla />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="*" element={<Navigate to="/tickets" replace />} />
      </Route>
    </Routes>
  )
}
