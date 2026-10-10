import { Link } from 'react-router-dom'
import type { AttachmentInfo } from '../../../lib/api'
import { formatSize, plural } from '../../../lib/format'
import StatusBadge from '../../../components/StatusBadge'
import ConfianzaOcr from '../../../components/ConfianzaOcr'
import { LuFileText } from 'react-icons/lu'
import { useAttachmentPages } from '../hooks/useAttachmentPages'

/** Lista un PDF con su estado y la confianza de su lectura; si necesita revisión, cuenta las dudas (bajo demanda) y enlaza a la corrección. */
export default function AttachmentRow({ threadId, att }: { threadId: string; att: AttachmentInfo }) {
  const { data } = useAttachmentPages(att.id, att.status === 'necesita_revision' || att.status === 'listo')
  const doubts = data ? data.pages.reduce((n, p) => n + p.regions.filter((g) => g.status === 'dudoso').length, 0) : null

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="flex items-start gap-2 break-all font-medium"><LuFileText className="size-5 shrink-0" aria-hidden /><span>{att.filename}</span></p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={att.status} />
        {data?.nivel && <ConfianzaOcr nivel={data.nivel} confianza={data.confianza} />}
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
