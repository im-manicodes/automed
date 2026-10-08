import { useCallback, useEffect, useState } from 'react'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useSession } from '../../context/session-context'
import OutlookCard from './components/OutlookCard'
import ConfigMicrosoftCard from './components/ConfigMicrosoftCard'
import { Link, useSearchParams } from 'react-router-dom'
import { plural } from '../../lib/format'
import { useMailStatus } from '../../hooks/useMail'
import { useJobsStatus } from './hooks/useAjustes'
import { useConfigMicrosoft } from './hooks/useConfigMicrosoft'
import { usePolling } from '../../hooks/usePolling'
import { useAjustesIa } from '../../hooks/useAjustesIa'
import { useAjustesAlmacenamiento } from '../../hooks/useAjustesAlmacenamiento'
import { nombreProveedor } from '../../lib/ia'
import { nombreAlmacenamiento } from '../../lib/almacenamiento'
import { LuCheck, LuTriangleAlert, LuHourglass } from 'react-icons/lu'

export default function Ajustes() {
  const { session, logout } = useSession()
  const { data: ia } = useAjustesIa()
  const { data: alm } = useAjustesAlmacenamiento()
  const { data: mail, error: mailError, refetch: refetchMail } = useMailStatus()
  const { data: msConfig, refetch: refetchMs } = useConfigMicrosoft()
  const { data: jobs, error: jobsError, refetch: refetchJobs } = useJobsStatus()
  // Un fallo de una recarga silenciosa (polling) con datos ya cargados no se muestra.
  const error = (!mail || !jobs) && (mailError ?? jobsError) ? (mailError ?? jobsError) : null

  const load = useCallback(async () => {
    await Promise.all([refetchMail(), refetchJobs()])
  }, [refetchMail, refetchJobs])

  usePolling(() => void load(), 5000, !!mail?.syncing || !!jobs?.procesando || !!jobs?.pendiente)

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
    void load()
  }, [outlook, setParams, load])

  const working = (jobs?.pendiente ?? 0) + (jobs?.procesando ?? 0)

  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-bold">Ajustes</h2>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && !mail && <Spinner text="Cargando…" />}

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`rounded-xl border p-3 ${aviso.ok ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          {aviso.ok ? <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden /> : <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />}{aviso.text}
        </p>
      )}

      <div className="space-y-5 md:grid md:grid-cols-2 md:items-start md:gap-5 md:space-y-0">
      {mail && <div className="md:col-span-2"><OutlookCard mail={mail} configurado={msConfig?.configurado ?? true} onChanged={() => load()} /></div>}
      {msConfig && <div className="md:col-span-2"><ConfigMicrosoftCard config={msConfig} onSaved={async () => { await refetchMs() }} /></div>}

      {jobs && (
        <div className="space-y-2 md:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-lg font-bold">Trabajo en marcha</h3>
          <p className="text-slate-700">
            {working > 0
              ? <><LuHourglass className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{`Hay ${plural(working, 'tarea', 'tareas')} en proceso o en espera.`}</>
              : <><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />No hay tareas pendientes.</>}
          </p>
          <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <li className="rounded-lg bg-slate-50 p-2">En espera: <strong>{jobs.pendiente}</strong></li>
            <li className="rounded-lg bg-slate-50 p-2">En proceso: <strong>{jobs.procesando}</strong></li>
            <li className="rounded-lg bg-slate-50 p-2">Terminadas: <strong>{jobs.listo}</strong></li>
            <li className={`rounded-lg p-2 ${jobs.error > 0 ? 'bg-red-50 text-red-900' : 'bg-slate-50'}`}>Con error: <strong>{jobs.error}</strong></li>
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Inteligencia artificial</h3>
        {ia && <p className="text-slate-700">Proveedor actual: <strong>{nombreProveedor(ia.proveedor)}</strong></p>}
        <Link to="/ajustes/ia" className="btn btn-secondary w-full">Configurar</Link>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Almacenamiento</h3>
        {alm && <p className="text-slate-700">Se guardan en: <strong>{nombreAlmacenamiento(alm.proveedor)}</strong></p>}
        <Link to="/ajustes/almacenamiento" className="btn btn-secondary w-full">Configurar</Link>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Sesión</h3>
        {session.status === 'authenticated' && <p className="break-all text-slate-700">Entraste como {session.user.nombre} ({session.user.email})</p>}
        <button type="button" className="btn btn-secondary w-full" onClick={() => void logout()}>Salir</button>
      </div>
      </div>
    </section>
  )
}
