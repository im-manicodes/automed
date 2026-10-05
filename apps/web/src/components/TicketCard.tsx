import { Link } from 'react-router-dom'
import type { ThreadListItem } from '../lib/api'
import { formatDate, plural } from '../lib/format'
import { canAnalyze } from '../lib/status'
import StatusBadge from './StatusBadge'

interface Props {
  ticket: ThreadListItem
  selected: boolean
  onToggle: (id: string) => void
}

export default function TicketCard({ ticket: t, selected, onToggle }: Props) {
  const selectable = canAnalyze(t)
  return (
    <li className={`flex items-stretch rounded-xl border bg-white shadow-sm ${selected ? 'border-blue-700 ring-2 ring-blue-700' : 'border-slate-200'}`}>
      <label className={`flex min-h-12 w-14 shrink-0 items-center justify-center ${selectable ? 'cursor-pointer' : 'opacity-30'}`}>
        <input
          type="checkbox"
          className="h-6 w-6 accent-blue-700"
          checked={selected}
          disabled={!selectable}
          onChange={() => onToggle(t.id)}
          aria-label={selectable ? `Elegir para analizar: ${t.subject || 'Sin asunto'}` : `No se puede analizar ahora: ${t.subject || 'Sin asunto'}`}
        />
      </label>
      <Link to={`/tickets/${t.id}`} className="min-w-0 flex-1 space-y-2 py-3 pr-3">
        <p className="line-clamp-2 break-words font-semibold">{t.subject || '(Sin asunto)'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {t.tieneMensajesNuevos && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-900">
              <span aria-hidden>✉</span>Mensajes nuevos
            </span>
          )}
        </div>
        <p className="text-sm text-slate-700">
          {plural(t.messageCount, 'correo', 'correos')} · {plural(t.attachmentCount, 'PDF', 'PDF')} · {formatDate(t.lastMessageAt)}
        </p>
      </Link>
    </li>
  )
}
