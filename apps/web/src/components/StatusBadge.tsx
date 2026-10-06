import type { ProcessStatus } from '../lib/api'
import { STATUS_INFO } from '../lib/status'

export default function StatusBadge({ status }: { status: ProcessStatus }) {
  const s = STATUS_INFO[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${s.classes}`}>
      <s.icon className="size-4 shrink-0" aria-hidden />
      {s.label}
    </span>
  )
}
