import { useCallback, useEffect, useState } from 'react'
import ErrorBox from '../components/ErrorBox'
import Spinner from '../components/Spinner'
import { useSession } from '../context/session'
import { useToast } from '../context/toasts'
import { jobsApi, mailApi, type JobsStatus, type MailStatus } from '../lib/api'
import { errorMessage, formatDate, plural } from '../lib/format'
import { usePolling } from '../lib/usePolling'

export default function Ajustes() {
  const { toast } = useToast()
  const { session, logout } = useSession()
  const [mail, setMail] = useState<MailStatus | null>(null)
  const [jobs, setJobs] = useState<JobsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async (silent = false) => {
    try {
      const [m, j] = await Promise.all([mailApi.status(), jobsApi.status()])
      setMail(m)
      setJobs(j)
      setError(null)
    } catch (e) {
      if (!silent) setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  usePolling(() => void load(true), 5000, !!mail?.running || !!jobs?.procesando || !!jobs?.pendiente)

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await mailApi.sync()
      toast(!r.started ? 'Ya se está sincronizando. Espera un momento.' : r.error ? 'No se pudo sincronizar el correo.' : 'Correo sincronizado.', !r.started ? 'info' : r.error ? 'error' : 'ok')
      await load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSyncing(false)
    }
  }

  const last = mail?.last
  const working = (jobs?.pendiente ?? 0) + (jobs?.procesando ?? 0)

  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-bold">Ajustes</h2>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && !mail && <Spinner text="Cargando…" />}

      {mail && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-lg font-bold">Tu buzón de correo</h3>
          <p className="break-all">{mail.connectedEmail ? <>✓ Conectado: <strong>{mail.connectedEmail}</strong></> : '⚠ Todavía no hay un buzón conectado.'}</p>
          <p className="text-slate-700">
            {mail.running
              ? '⏳ Sincronizando ahora…'
              : last
                ? last.error
                  ? `⚠ La última sincronización falló (${formatDate(last.at)}).`
                  : `Última sincronización: ${formatDate(last.at)} · ${plural(last.newMessages, 'correo nuevo', 'correos nuevos')}.`
                : 'Todavía no se ha sincronizado.'}
          </p>
          <button type="button" className="btn w-full" disabled={syncing || mail.running} onClick={() => void sync()}>
            {syncing || mail.running ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
      )}

      {jobs && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-lg font-bold">Trabajo en marcha</h3>
          <p className="text-slate-700">
            {working > 0 ? `⏳ Hay ${plural(working, 'tarea', 'tareas')} en proceso o en espera.` : '✓ No hay tareas pendientes.'}
          </p>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            <li className="rounded-lg bg-slate-50 p-2">En espera: <strong>{jobs.pendiente}</strong></li>
            <li className="rounded-lg bg-slate-50 p-2">En proceso: <strong>{jobs.procesando}</strong></li>
            <li className="rounded-lg bg-slate-50 p-2">Terminadas: <strong>{jobs.listo}</strong></li>
            <li className={`rounded-lg p-2 ${jobs.error > 0 ? 'bg-red-50 text-red-900' : 'bg-slate-50'}`}>Con error: <strong>{jobs.error}</strong></li>
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Sesión</h3>
        {session.status === 'authenticated' && <p className="break-all text-slate-700">Entraste como {session.email}</p>}
        <button type="button" className="btn btn-secondary w-full" onClick={() => void logout()}>Salir</button>
      </div>
    </section>
  )
}
