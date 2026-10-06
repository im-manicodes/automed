import { useEffect, useState } from 'react'
import { LuCheck, LuClock } from 'react-icons/lu'
import { reportsApi, type ReporteAjustes } from '../lib/api'
import { errorMessage } from '../lib/format'
import ErrorBox from './ErrorBox'
import Spinner from './Spinner'
import Switch from './Switch'

/** Generación automática diaria: interruptor + hora (la zona horaria solo se muestra). */
export default function ReporteProgramacion() {
  const [ajustes, setAjustes] = useState<ReporteAjustes | null>(null)
  const [hora, setHora] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState<string | null>(null)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)

  const cargar = async () => {
    try {
      const a = await reportsApi.settings()
      setAjustes(a)
      setHora(a.hora)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void cargar()
  }, [])

  const guardar = async (cambios: Partial<Pick<ReporteAjustes, 'programado' | 'hora'>>, mensaje: string) => {
    setGuardando(true)
    setGuardado(null)
    setErrorGuardar(null)
    try {
      const a = await reportsApi.saveSettings(cambios)
      setAjustes(a)
      setHora(a.hora)
      setGuardado(mensaje)
    } catch (e) {
      setErrorGuardar(errorMessage(e))
    } finally {
      setGuardando(false)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => void cargar()} />
  if (!ajustes) return <Spinner text="Cargando…" />

  const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)

  return (
    <div className="space-y-3">
      <Switch label="Generar cada día" checked={ajustes.programado} disabled={guardando} onChange={(v) => void guardar({ programado: v }, v ? 'Listo: se generará cada día.' : 'Listo: ya no se genera solo.')} />
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
        <button type="button" className="btn btn-secondary" disabled={guardando || !horaValida || hora === ajustes.hora} onClick={() => void guardar({ hora }, 'Listo: hora guardada.')}>
          {guardando ? 'Guardando…' : 'Guardar hora'}
        </button>
      </div>
      <p className="text-sm text-slate-700">
        <LuClock className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        Zona horaria: {ajustes.zona}
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
