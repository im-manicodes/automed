import { useEffect, useRef } from 'react'

interface Props {
  title: string
  children: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancelar', busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="dlg-title" className="text-xl font-bold">{title}</h2>
        <div className="space-y-2 text-slate-700">{children}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={ref} type="button" className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn" disabled={busy} onClick={onConfirm}>{busy ? 'Un momento…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
