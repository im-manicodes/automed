import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LuDownload, LuFileSpreadsheet, LuInfo, LuTriangleAlert } from 'react-icons/lu'
import ErrorBox from '../../components/ErrorBox'
import ProgresoReporte from './components/ProgresoReporte'
import ReporteProgramacion from './components/ReporteProgramacion'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import type { Reporte, ReporteDetalle } from '../../lib/api'
import { formatFechaReporte, formatHora, guardarArchivo } from './lib/descarga'
import { errorMessage } from '../../lib/format'
import { usePolling } from '../../hooks/usePolling'
import { useCrearReporte, useDescargarReporte, useDetalleReporte, useListaReportes } from './hooks/useReportes'

const ESTADO_FILA: Record<string, string> = { hospitalizado: 'Hospitalizado', alta: 'Alta', otro: 'Otro' }

function nombreArchivo(r: Pick<Reporte, 'fileName' | 'fecha'>): string {
  return r.fileName || `reporte-${r.fecha}.xlsx`
}

function Total({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <p className="text-3xl font-bold">{valor}</p>
      <p className="text-sm text-slate-700">{etiqueta}</p>
    </div>
  )
}

function EstadoChip({ estado }: { estado: string }) {
  const clases = estado === 'alta' ? 'bg-green-50 text-green-900 border-green-300' : 'bg-blue-50 text-blue-900 border-blue-300'
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium ${clases}`}>{ESTADO_FILA[estado] ?? estado}</span>
}

function Avisos({ fila }: { fila: ReporteDetalle['filasConNovedad'][number] }) {
  return (
    <>
      {fila.desactualizado && (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-900">
          <LuTriangleAlert className="size-4 shrink-0" aria-hidden />Resumen desactualizado
        </span>
      )}
      {!fila.extraccionOk && (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-900">
          <LuTriangleAlert className="size-4 shrink-0" aria-hidden />Datos incompletos
        </span>
      )}
    </>
  )
}

function FilasNovedad({ reporte }: { reporte: ReporteDetalle }) {
  const filas = reporte.filasConNovedad ?? []
  if (reporte.totales.conNovedad === 0) return <p className="text-slate-700">Hoy no hay pacientes con novedad.</p>
  if (filas.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-lg font-bold">Novedades</h4>
      {/* móvil: tarjetas */}
      <ul className="space-y-2 md:hidden">
        {filas.map((f) => (
          <li key={f.threadId} className="space-y-1.5 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/tickets/${f.threadId}`} className="font-semibold text-blue-800 underline">{f.asunto}</Link>
              <EstadoChip estado={f.estado} />
            </div>
            <p className="text-slate-800">{f.novedadTexto}</p>
            <div className="flex flex-wrap gap-x-3"><Avisos fila={f} /></div>
          </li>
        ))}
      </ul>
      {/* >= md: tabla compacta */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2">Paciente / ticket</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Novedad</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.threadId} className="border-t border-slate-200 align-top">
                <td className="px-3 py-2"><Link to={`/tickets/${f.threadId}`} className="font-semibold text-blue-800 underline">{f.asunto}</Link></td>
                <td className="px-3 py-2"><EstadoChip estado={f.estado} /></td>
                <td className="space-y-1 px-3 py-2">
                  <p>{f.novedadTexto}</p>
                  <div className="flex flex-wrap gap-x-3"><Avisos fila={f} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reporte.totales.conNovedad > filas.length && (
        <p className="text-sm text-slate-700">Se muestran {filas.length} de {reporte.totales.conNovedad}. El resto está en el Excel.</p>
      )}
    </div>
  )
}

export default function Reportes() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const [historial, setHistorial] = useState<Reporte[] | null>(null)
  const [actual, setActual] = useState<ReporteDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCrear, setErrorCrear] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)

  // Reportes cuya descarga automática está pendiente (se descarga una sola vez al pasar a "listo").
  const autoDescarga = useRef(new Set<string>())
  const generarAlCargar = useRef(params.get('generar') === '1')
  // Solo los fallos de la carga inicial se muestran; los de polling/historial se reintentan en silencio.
  const cargaInicial = useRef(false)
  const alFallarCarga = useCallback((m: string) => {
    if (cargaInicial.current) setError(m)
  }, [])
  const lista = useListaReportes({ onError: alFallarCarga })
  const detalle = useDetalleReporte({ onError: alFallarCarga })
  const crearReporte = useCrearReporte()
  const bajarExcel = useDescargarReporte()
  const { refetch: pedirLista } = lista
  const { consultar } = detalle
  const { mutate: mutarCrear } = crearReporte
  const { descargar: bajar } = bajarExcel

  const descargar = useCallback(async (r: Pick<Reporte, 'id' | 'fileName' | 'fecha'>) => {
    setDescargando(r.id)
    setErrorDescarga(null)
    try {
      guardarArchivo(await bajar(r.id), nombreArchivo(r))
    } catch (e) {
      setErrorDescarga(`No se pudo descargar el Excel. ${errorMessage(e)}`)
    } finally {
      setDescargando(null)
    }
  }, [bajar])

  const cargarHistorial = useCallback(async () => {
    // el historial es secundario: si falla se deja el anterior
    const r = await pedirLista()
    if (r) setHistorial(r.reportes)
  }, [pedirLista])

  /** Consulta el reporte; al pasar a "listo" lo descarga solo (una vez). */
  const seguir = useCallback(
    async (id: string) => {
      const d = await consultar(id) // si falla se reintenta en el siguiente ciclo
      if (!d) return
      setActual(d)
      if (d.status !== 'generando') {
        if (autoDescarga.current.delete(id) && d.status === 'listo') void descargar(d)
        void cargarHistorial()
      }
    },
    [consultar, descargar, cargarHistorial],
  )

  const crear = useCallback(async () => {
    setCreando(true)
    setErrorCrear(null)
    setErrorDescarga(null)
    try {
      const { reporte, reutilizado } = await mutarCrear()
      autoDescarga.current.add(reporte.id)
      setActual((prev) => (prev?.id === reporte.id ? { ...prev, ...reporte } : { ...reporte, columnas: [], filasConNovedad: [] }))
      if (reutilizado) toast('Ya había un reporte en curso. Te muestro su avance.', 'info')
      if (reporte.status !== 'generando') await seguir(reporte.id)
    } catch (e) {
      setErrorCrear(errorMessage(e))
    } finally {
      setCreando(false)
    }
  }, [mutarCrear, seguir, toast])

  useEffect(() => {
    const generar = generarAlCargar.current
    generarAlCargar.current = false
    if (params.get('generar')) {
      const next = new URLSearchParams(params)
      next.delete('generar')
      setParams(next, { replace: true })
    }
    void (async () => {
      cargaInicial.current = true
      try {
        const r = await pedirLista()
        if (!r) return
        const { reportes } = r
        setHistorial(reportes)
        const ultimo = reportes[0]
        if (ultimo) {
          const d = await consultar(ultimo.id)
          if (!d) return
          setActual(d)
          if (d.status === 'generando' && d.trigger === 'manual') autoDescarga.current.add(d.id)
        }
        if (generar && ultimo?.status !== 'generando') await crear()
        else if (generar && ultimo) toast('Ya había un reporte en curso. Te muestro su avance.', 'info')
      } finally {
        cargaInicial.current = false
      }
    })()
    // Solo al abrir la vista.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enCurso = actual?.status === 'generando'
  usePolling(() => actual && void seguir(actual.id), 2000, enCurso)

  const ocupado = creando || enCurso
  const listo = actual?.status === 'listo' ? actual : null

  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-bold">Reportes</h2>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <p className="text-slate-700">Un Excel con los pacientes hospitalizados y lo que cambió. Incluye solo los hilos que ya analizaste. Se descarga solo cuando termina.</p>
        <button type="button" className="btn !min-h-14 w-full text-lg md:w-auto md:min-w-72" disabled={ocupado} onClick={() => void crear()}>
          <LuFileSpreadsheet className="size-6" aria-hidden />
          {ocupado ? 'Generando…' : 'Generar Excel de hoy'}
        </button>
        {enCurso && actual && <ProgresoReporte progreso={actual.progreso} />}
        {errorCrear && <ErrorBox message={errorCrear} onRetry={() => void crear()} />}
        {actual?.status === 'error' && !errorCrear && (
          <ErrorBox message={actual.error || 'No se pudo generar el Excel.'} onRetry={ocupado ? undefined : () => void crear()} />
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => window.location.reload()} />}
      {!error && historial === null && <Spinner text="Cargando reportes…" />}

      {errorDescarga && actual && <ErrorBox message={errorDescarga} onRetry={() => void descargar(actual)} />}

      {listo && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold">Reporte del {formatFechaReporte(listo.fecha)}</h3>
              <p className="text-sm text-slate-700">Generado a las {formatHora(listo.finishedAt ?? listo.createdAt)}</p>
            </div>
            {listo.descargable && (
              <button type="button" className="btn btn-secondary" disabled={descargando === listo.id} onClick={() => void descargar(listo)}>
                <LuDownload className="size-5" aria-hidden />
                {descargando === listo.id ? 'Descargando…' : 'Descargar de nuevo'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Total valor={listo.totales.hospitalizados} etiqueta="Hospitalizados" />
            <Total valor={listo.totales.conNovedad} etiqueta="Con novedad" />
            <Total valor={listo.totales.altas} etiqueta="Altas" />
          </div>
          {listo.progreso.total === 0 ? (
            <p className="text-slate-700">
              Aún no hay hilos analizados. Analiza un ticket desde{' '}
              <Link to="/tickets" className="font-semibold text-blue-800 underline">Tickets</Link> y vuelve aquí.
            </p>
          ) : (
            <FilasNovedad reporte={listo} />
          )}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <h3 className="text-xl font-bold">Generar cada día</h3>
        <p className="text-sm text-slate-700">
          <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          Si lo activas, el Excel se prepara solo a la hora que elijas. No analiza hilos nuevos con IA.
        </p>
        <ReporteProgramacion />
      </div>

      {historial && historial.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
          <h3 className="text-xl font-bold">Reportes anteriores</h3>
          <ul className="divide-y divide-slate-200">
            {historial.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold">
                    {formatFechaReporte(r.fecha)} · {formatHora(r.createdAt)}
                    <span className="ml-2 text-sm font-normal text-slate-700">{r.trigger === 'programado' ? 'Automático' : 'Manual'}</span>
                  </p>
                  <p className="text-sm text-slate-700">
                    {r.status === 'listo'
                      ? `${r.totales.hospitalizados} hospitalizados · ${r.totales.conNovedad} con novedad · ${r.totales.altas} altas`
                      : r.status === 'generando'
                        ? 'Generando…'
                        : 'No se pudo generar'}
                  </p>
                </div>
                {r.descargable && (
                  <button type="button" className="btn btn-secondary" aria-label={`Descargar el reporte del ${formatFechaReporte(r.fecha)} ${formatHora(r.createdAt)}`} disabled={descargando === r.id} onClick={() => void descargar(r)}>
                    <LuDownload className="size-5" aria-hidden />
                    Descargar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
