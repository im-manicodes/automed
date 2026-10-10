import { Link } from 'react-router-dom'
import { LuHand, LuPencil } from 'react-icons/lu'
import { plural } from '../../../lib/format'

interface Props {
  threadId: string
  /** PDF del ticket que aún piden revisión (en orden). */
  pendientes: { id: string; filename: string }[]
  busy: boolean
  onContinuar: () => void
}

/** Antes de generar el resumen se revisan a mano las zonas que el OCR no entendió. */
export default function AvisoRevision({ threadId, pendientes, busy, onContinuar }: Props) {
  if (pendientes.length === 0) return null
  return (
    <div role="status" className="space-y-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-950">
      <p>
        <LuHand className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        Antes de generar el resumen, revisa las zonas marcadas en rojo de {plural(pendientes.length, 'PDF', 'PDF')}. Así el resumen sale completo y sin partes sin sentido.
      </p>
      <Link to={`/tickets/${threadId}/revision/${pendientes[0].id}`} className="btn w-full">
        <LuPencil className="size-5 shrink-0" aria-hidden />Revisar ahora
      </Link>
      <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={onContinuar}>
        Generar el resumen sin corregir
      </button>
    </div>
  )
}
