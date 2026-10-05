import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ToastContext as Ctx, type ToastKind as Kind } from './toasts-context'

interface Toast { id: number; kind: Kind; text: string }

let nextId = 1

const STYLE: Record<Kind, string> = {
  ok: 'bg-green-50 text-green-900 border-green-400',
  error: 'bg-red-50 text-red-900 border-red-400',
  info: 'bg-blue-50 text-blue-900 border-blue-400',
}
const ICON: Record<Kind, string> = { ok: '✓', error: '⚠', info: 'ℹ' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const toast = useCallback(
    (text: string, kind: Kind = 'info') => {
      const id = nextId++
      setItems((l) => [...l, { id, kind, text }])
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ toast }), [toast])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border p-3 shadow-lg ${STYLE[t.kind]}`}>
            <span aria-hidden>{ICON[t.kind]}</span>
            <p className="flex-1">{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Cerrar aviso" className="-m-2 min-h-11 min-w-11 rounded-lg">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
