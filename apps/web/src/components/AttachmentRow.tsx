import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { attachmentsApi, type AttachmentInfo } from '../lib/api'
import { formatSize, plural } from '../lib/format'
import StatusBadge from './StatusBadge'

/** Lista un PDF con su estado; si necesita revisión, cuenta las dudas (bajo demanda) y enlaza a la corrección. */
export default function AttachmentRow({ threadId, att }: { threadId: string; att: AttachmentInfo }) {
  const [doubts, setDoubts] = useState<number | null>(null)
  useEffect(() => {
    if (att.status !== 'necesita_revision') return
    let alive = true
    attachmentsApi
      .pages(att.id)
      .then((r) => {
        if (alive) setDoubts(r.pages.reduce((n, p) => n + p.regions.filter((g) => g.status === 'dudoso').length, 0))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [att.id, att.status])

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="break-all font-medium">📄 {att.filename}</p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={att.status} />
        <span className="text-sm text-slate-700">{formatSize(att.size)}</span>
      </div>
      {att.status === 'necesita_revision' && (
        <Link to={`/tickets/${threadId}/revision/${att.id}`} className="btn w-full sm:w-auto">
          {doubts === null ? 'Revisar dudas' : doubts > 0 ? `${plural(doubts, 'duda', 'dudas')} por revisar` : 'Revisar'}
        </Link>
      )}
    </li>
  )
}
