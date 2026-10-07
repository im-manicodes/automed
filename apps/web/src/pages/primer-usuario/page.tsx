import { useState, type FormEvent } from 'react'
import { LuTriangleAlert, LuUserPlus } from 'react-icons/lu'
import { useSession } from '../../context/session-context'
import { useCrearPrimerUsuario } from '../../hooks/useSetupStatus'
import { ApiError } from '../../lib/api'
import { MIN_PASSWORD } from '../../lib/password'

function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return 'Ya hay un usuario creado. Entra con tu correo y tu contraseña.'
    if (e.status === 429) return 'Hubo demasiados intentos. Espera un minuto y vuelve a intentar.'
    if (e.status === 0) return e.message
    if (e.status === 400 && e.message) return e.message
  }
  return 'No pudimos crear tu usuario. Intenta de nuevo en un momento.'
}

/** Primera vez: se crea la cuenta de la persona que usará la aplicación y se entra con ella. */
export default function PrimerUsuario() {
  const { aceptarSesion } = useSession()
  const { mutate } = useCrearPrimerUsuario()
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !nombre.trim()) {
      setMsg('Escribe tu correo y tu nombre.')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setMsg(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await mutate({ body_params: { email: email.trim(), nombre: nombre.trim(), password } })
      aceptarSesion(r.user)
    } catch (err) {
      setMsg(mensajeError(err))
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-2 text-center">
        <LuUserPlus className="mx-auto size-12 text-blue-800" aria-hidden />
        <h1 className="text-3xl font-bold">Te damos la bienvenida</h1>
        <p className="text-slate-700">Crea tu usuario para empezar. Después te ayudamos a configurar la aplicación.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="space-y-4 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-6 md:shadow-sm" noValidate>
        <div aria-live="assertive">
          {msg && (
            <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
              <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{msg}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="nuevo-email" className="block font-semibold">Correo</label>
          <input id="nuevo-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="nuevo-nombre" className="block font-semibold">Nombre</label>
          <input id="nuevo-nombre" name="nombre" type="text" autoComplete="name" required
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-lg" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="nuevo-password" className="block font-semibold">Contraseña</label>
          <div className="flex gap-2">
            <input id="nuevo-password" name="password" type={show ? 'text' : 'password'} autoComplete="new-password" required
              aria-describedby="nuevo-password-ayuda"
              className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-lg" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn btn-secondary shrink-0" aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p id="nuevo-password-ayuda" className="text-sm text-slate-700">Mínimo {MIN_PASSWORD} caracteres.</p>
        </div>
        <button type="submit" className="btn w-full text-lg" disabled={busy}>{busy ? 'Creando…' : 'Crear usuario y entrar'}</button>
      </form>
    </main>
  )
}
