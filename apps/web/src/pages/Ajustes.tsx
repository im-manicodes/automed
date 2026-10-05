import { useCallback, useEffect, useState } from 'react'
import ErrorBox from '../components/ErrorBox'
import Spinner from '../components/Spinner'
import { useSession } from '../context/session-context'
import OutlookCard from '../components/OutlookCard'
import { useSearchParams } from 'react-router-dom'
import { jobsApi, mailApi, type JobsStatus, type MailStatus } from '../lib/api'
import { errorMessage, plural } from '../lib/format'
import { usePolling } from '../lib/usePolling'

export default function Ajustes() {
  const { session, logout } = useSession()
  const [mail, setMail] = useState<MailStatus | null>(null)
  const [jobs, setJobs] = useState<JobsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void load()
  }, [load])

  usePolling(() => void load(true), 5000, !!mail?.syncing || !!jobs?.procesando || !!jobs?.pendiente)

  const [params, setParams] = useSearchParams()
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null)
  const outlook = params.get('outlook')
  useEffect(() => {
    if (!outlook) return
    if (outlook === 'conectado') {
      // oxlint-disable-next-line react/set-state-in-effect -- lee el resultado de la redirección y limpia la URL
      setAviso({ ok: true, text: '¡Listo! Tu Outlook quedó conectado.' })
    } else {
      setAviso({ ok: false, text: 'No pudimos conectar tu Outlook. Puedes intentarlo de nuevo.' })
    }
    setParams({}, { replace: true })
    void load(true)
  }, [outlook, setParams, load])

  const working = (jobs?.pendiente ?? 0) + (jobs?.procesando ?? 0)

  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-bold">Ajustes</h2>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && !mail && <Spinner text="Cargando…" />}

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`rounded-xl border p-3 ${aviso.ok ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          <span aria-hidden>{aviso.ok ? '✓ ' : '⚠ '}</span>{aviso.text}
        </p>
      )}

      {mail && <OutlookCard mail={mail} onChanged={() => load(true)} />}

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
        {session.status === 'authenticated' && <p className="break-all text-slate-700">Entraste como {session.user.nombre} ({session.user.email})</p>}
        <button type="button" className="btn btn-secondary w-full" onClick={() => void logout()}>Salir</button>
      </div>
    </section>
  )
}
