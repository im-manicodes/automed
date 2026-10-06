import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useToast } from '../context/toasts-context'
import { ApiError, authApi } from '../lib/api'
import { MIN_PASSWORD, validarNuevaPassword } from '../lib/password'
import { LuTriangleAlert } from 'react-icons/lu'

export default function CambiarPasswordDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validarNuevaPassword(actual, nueva, confirmar)
    if (v) return setError(v)
    setBusy(true)
    setError(null)
    try {
      await authApi.changePassword(actual, nueva)
      toast('Listo: tu contraseña se cambió.', 'ok')
      onClose()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'La contraseña actual no es correcta.' : err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.')
      setBusy(false)
    }
  }

  const type = show ? 'text' : 'password'
  const cls = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <form role="dialog" aria-modal="true" aria-labelledby="pw-title" noValidate onSubmit={(e) => void submit(e)} className="max-h-full w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="pw-title" className="text-xl font-bold">Cambiar contraseña</h2>
        <div aria-live="assertive">{error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{error}</p>}</div>
        <div className="space-y-1">
          <label htmlFor="pw-actual" className="block font-semibold">Contraseña actual</label>
          <input ref={first} id="pw-actual" type={type} autoComplete="current-password" className={cls} value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="pw-nueva" className="block font-semibold">Contraseña nueva</label>
          <input id="pw-nueva" type={type} autoComplete="new-password" aria-describedby="pw-ayuda" className={cls} value={nueva} onChange={(e) => setNueva(e.target.value)} />
          <p id="pw-ayuda" className="text-sm text-slate-600">Mínimo {MIN_PASSWORD} caracteres. Una frase larga es más fácil de recordar.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="pw-confirmar" className="block font-semibold">Repite la contraseña nueva</label>
          <input id="pw-confirmar" type={type} autoComplete="new-password" className={cls} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary w-full" aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}</button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        </div>
      </form>
    </div>
  )
}
