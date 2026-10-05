import { authApi } from '../lib/api'

export default function Login({ error }: { error?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <p className="text-5xl" aria-hidden>📋</p>
        <h1 className="text-3xl font-bold">Auto-med</h1>
        <p className="text-slate-700">Tus correos de Outlook, ordenados en tickets con un resumen claro.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
          <span aria-hidden>⚠ </span>{error}
        </p>
      )}
      <button type="button" className="btn w-full text-lg" onClick={() => window.location.assign(authApi.loginUrl)}>
        Entrar con Microsoft
      </button>
      <p className="text-sm text-slate-600">Usarás tu cuenta de Outlook. No guardamos tu contraseña.</p>
    </main>
  )
}
