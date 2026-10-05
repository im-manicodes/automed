import { useState, type FormEvent } from 'react'
import { useSession } from '../context/session-context'
import { ApiError } from '../lib/api'

function loginErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Hubo demasiados intentos. Espera un minuto y vuelve a intentar.'
    if (e.status === 401) return 'Correo o contraseña incorrectos.'
    if (e.status === 0) return e.message
  }
  return 'No pudimos entrar. Intenta de nuevo en un momento.'
}

export default function Login({ error }: { error?: string }) {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setMsg('Escribe tu correo y tu contraseña.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setMsg(loginErrorMessage(err))
      setBusy(false)
    }
  }

  const shown = msg ?? error
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-2 text-center">
        <p className="text-5xl" aria-hidden>📋</p>
        <h1 className="text-3xl font-bold">Auto-med</h1>
        <p className="text-slate-700">Entra con tu correo y tu contraseña.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <div aria-live="assertive">
          {shown && (
            <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
              <span aria-hidden>⚠ </span>{shown}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="login-email" className="block font-semibold">Correo</label>
          <input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="login-password" className="block font-semibold">Contraseña</label>
          <div className="flex gap-2">
            <input id="login-password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required
              className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-lg" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn btn-secondary shrink-0" aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>
        <button type="submit" className="btn w-full text-lg" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
