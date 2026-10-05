import { Link, useParams } from 'react-router-dom'

export default function TicketDetalle() {
  const { id } = useParams()
  return (
    <section className="space-y-4">
      <Link to="/tickets" className="btn btn-secondary">← Volver</Link>
      <h2 className="text-2xl font-bold">Ticket {id}</h2>
      <p className="text-slate-600">Aquí verás el resumen y los documentos de este ticket.</p>
    </section>
  )
}
