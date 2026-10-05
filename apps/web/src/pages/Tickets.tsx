import { Link } from 'react-router-dom'

export default function Tickets() {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">Tus tickets</h2>
      <p className="text-slate-600">Aquí aparecerán tus hilos de correo. Todavía no hay ninguno.</p>
      <Link to="/tickets/ejemplo" className="btn w-full">Ver ticket de ejemplo</Link>
    </section>
  )
}
