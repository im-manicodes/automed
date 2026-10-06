import type { SynthesisHistoryItem } from '../../../lib/api'
import { formatDate } from '../../../lib/format'

export default function VersionHistory({ history }: { history: SynthesisHistoryItem[] }) {
  if (history.length === 0) return null
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Historial de versiones ({history.length})</summary>
      <ul className="mt-2 space-y-2">
        {history.map((h) => (
          <li key={h.version} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p className="font-semibold">Versión {h.version} · {formatDate(h.createdAt)}</p>
            <p className="text-slate-700">
              {h.mode === 'full' ? 'Completa (se leyó todo el ticket)' : 'Solo con lo nuevo (consume menos)'}
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
