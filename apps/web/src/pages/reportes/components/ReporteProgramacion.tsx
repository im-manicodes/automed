import { useState } from 'react'
import { LuCheck, LuClock } from 'react-icons/lu'
import { errorMessage } from '../../../lib/format'
import { useAjustesReporte, useGuardarAjustesReporte, type CambiosAjustes } from '../hooks/useReportes'
import ErrorBox from '../../../components/ErrorBox'
import Spinner from '../../../components/Spinner'
import Switch from '../../../components/Switch'

/** Generación automática diaria: interruptor + hora (la zona horaria solo se muestra). */
export default function ReporteProgramacion() {
  const [hora, setHora] = useState('')
  const [guardado, setGuardado] = useState<string | null>(null)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)

  const { data: ajustes, error, refetch } = useAjustesReporte({ onSuccess: (a) => setHora(a.hora) })
  const { mutate, loading: guardando, data: guardados } = useGuardarAjustesReporte()
  // Tras guardar, los valores vigentes son los que devolvió el servidor.
  const vigentes = guardados ?? ajustes

  const guardar = async (cambios: CambiosAjustes, mensaje: string) => {
    setGuardado(null)
    setErrorGuardar(null)
    try {
      const a = await mutate({ body_params: cambios })
      setHora(a.hora)
      setGuardado(mensaje)
    } catch (e) {
      setErrorGuardar(errorMessage(e))
    }
  }

  if (error && !vigentes) return <ErrorBox message={error} onRetry={() => void refetch()} />
  if (!vigentes) return <Spinner text="Cargando…" />

  const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)

  return (
    <div className="space-y-3">
      <Switch label="Generar cada día" checked={vigentes.programado} disabled={guardando} onChange={(v) => void guardar({ programado: v }, v ? 'Listo: se generará cada día.' : 'Listo: ya no se genera solo.')} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="reporte-hora" className="font-semibold">Hora</label>
          <input
            id="reporte-hora"
            type="time"
            value={hora}
            onChange={(e) => {
              setHora(e.target.value)
              setGuardado(null)
            }}
            className="block min-h-12 rounded-xl border border-slate-400 bg-white px-3"
          />
        </div>
        <button type="button" className="btn btn-secondary" disabled={guardando || !horaValida || hora === vigentes.hora} onClick={() => void guardar({ hora }, 'Listo: hora guardada.')}>
          {guardando ? 'Guardando…' : 'Guardar hora'}
        </button>
      </div>
      <p className="text-sm text-slate-700">
        <LuClock className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        Zona horaria: {vigentes.zona}
      </p>
      {guardado && (
        <p role="status" className="font-medium text-green-800">
          <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          {guardado}
        </p>
      )}
      {errorGuardar && <p role="alert" className="text-red-800">{errorGuardar}</p>}
    </div>
  )
}
