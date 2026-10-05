import type { ProcessStatus } from '../lib/api'
import { STATUS_INFO } from '../lib/status'

export default function StatusBadge({ status }: { status: ProcessStatus }) {
  const s = STATUS_INFO[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${s.classes}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  )
}
