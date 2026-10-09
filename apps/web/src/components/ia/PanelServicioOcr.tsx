import { useEffect, useRef, useState } from 'react'
import {
  LuCheck,
  LuDownload,
  LuHardDrive,
  LuPlay,
  LuRefreshCw,
  LuRotateCcw,
  LuSquare,
  LuTrash2,
  LuTriangleAlert,
  LuWifi,
} from 'react-icons/lu'
import {
  useDesinstalarOcrLocal,
  useDetenerOcrLocal,
  useIniciarOcrLocal,
  useInstalarOcrLocal,
  useOcrLocal,
} from '../../hooks/useAjustesOcr'
import type { AjustesOcr, OcrLocal } from '../../lib/api'
import { errorMessage } from '../../lib/format'
import BotonProbarOcr from './BotonProbarOcr'

interface Props {
  ajustes: AjustesOcr
  /** Vuelve a pedir los ajustes (estado real del servicio OCR del servidor). */
  onRecheck: () => Promise<unknown> | void
}

const instalando = (o: OcrLocal) => o.estado === 'instalando' || o.estado === 'descargando-modelos'

/** Aviso de lo que hace falta antes de instalar. */
function Requisitos({ local }: { local: OcrLocal }) {
  return (
    <ul className="space-y-1 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
      <li>
        <LuHardDrive className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        Necesita unos {local.requisitos.espacioGb} GB libres o más (Python, el programa y los modelos de lectura).
      </li>
      <li>
        <LuWifi className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        El servidor necesita internet para descargarlo. Puede tardar varios minutos.
      </li>
    </ul>
  )
}

/** Últimas líneas de la instalación (texto técnico, plegable). */
function UltimasLineas({ local, abierto = false }: { local: OcrLocal; abierto?: boolean }) {
  if (local.lineas.length === 0) return null
  return (
    <details open={abierto} className="rounded-lg border border-slate-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-slate-800">Ver detalles técnicos</summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 p-3 text-xs text-slate-700">
        {local.lineas.map((l) => l.mensaje).join('\n')}
      </pre>
    </details>
  )
}

/**
 * OCR local cuando la app corre en un servidor. En modo gestionado la propia app lo instala
 * (botón «Instalar OCR local»), lo inicia y lo detiene; con un servicio externo (OCR_LOCAL_URL)
 * solo muestra su estado.
 */
export default function PanelServicioOcr({ ajustes, onRecheck }: Props) {
  const { estado, fallbackReason, mensaje } = ajustes.servicioLocal
  const local = useOcrLocal()
  const instalar = useInstalarOcrLocal()
  const iniciar = useIniciarOcrLocal()
  const detener = useDetenerOcrLocal()
  const desinstalar = useDesinstalarOcrLocal()
  const [buscando, setBuscando] = useState(false)
  const [accionError, setAccionError] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<'reinstalar' | 'desinstalar' | null>(null)

  const onRecheckRef = useRef(onRecheck)
  useEffect(() => {
    onRecheckRef.current = onRecheck
  })
  // Cuando cambia la instalación o el proceso, se refresca el estado general (desbloquea «Siguiente»).
  const clave = local.data ? `${local.data.estado}|${local.data.proceso}` : null
  const claveAnterior = useRef<string | null>(null)
  useEffect(() => {
    if (clave && claveAnterior.current && claveAnterior.current !== clave) void onRecheckRef.current()
    claveAnterior.current = clave
  }, [clave])

  const verificar = async () => {
    setBuscando(true)
    try {
      await Promise.all([onRecheck(), local.refetch()])
    } finally {
      setBuscando(false)
    }
  }

  const accion = async (fn: () => Promise<unknown>) => {
    setAccionError(null)
    setConfirmar(null)
    try {
      await fn()
    } catch (e) {
      setAccionError(errorMessage(e))
    } finally {
      await Promise.all([local.refetch(), onRecheck()])
    }
  }
  const ocupado = instalar.loading || iniciar.loading || detener.loading || desinstalar.loading

  const datos = local.data
  const gestionado = datos?.gestionado === true

  const avisoError = accionError && (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">
      <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
      {accionError}
    </p>
  )

  // --- Instalando / descargando modelos ---
  if (gestionado && datos && instalando(datos)) {
    const valor = Math.max(0, Math.min(100, Math.round(datos.progreso)))
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-950">
          Instalando el OCR local. Puedes seguir usando la app; la instalación continúa sola.
        </p>
        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-label="Progreso de la instalación"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={valor}
            aria-valuetext={datos.paso}
            className="relative h-3 w-full overflow-hidden rounded-full bg-blue-100"
          >
            <div className="h-full rounded-full bg-blue-700 transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${valor}%` }} />
          </div>
          <p className="text-sm font-medium">
            {datos.paso}
            <span className="ml-1 font-normal">{valor}%</span>
          </p>
        </div>
        <UltimasLineas local={datos} abierto />
        {avisoError}
      </div>
    )
  }

  // --- Sin instalar ---
  if (gestionado && datos && datos.estado === 'no-instalado') {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-3 text-amber-950">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          El OCR local todavía no está instalado en este servidor.
        </p>
        <Requisitos local={datos} />
        <button type="button" className="btn w-full sm:w-auto" disabled={ocupado} onClick={() => void accion(() => instalar.mutate())}>
          <LuDownload className="size-5" aria-hidden />
          {instalar.loading ? 'Empezando…' : 'Instalar OCR local'}
        </button>
        {avisoError}
      </div>
    )
  }

  // --- La instalación falló ---
  if (gestionado && datos && datos.estado === 'error') {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          No se pudo instalar el OCR local.{datos.error ? ` ${datos.error}` : ''}
        </p>
        <Requisitos local={datos} />
        <UltimasLineas local={datos} />
        <button type="button" className="btn w-full sm:w-auto" disabled={ocupado} onClick={() => void accion(() => instalar.mutate())}>
          <LuRotateCcw className="size-5" aria-hidden />
          {instalar.loading ? 'Empezando…' : 'Intentar de nuevo'}
        </button>
        {avisoError}
      </div>
    )
  }

  // --- Instalado (gestionado) o servicio externo ---
  const enMarcha = estado === 'listo'
  const iniciandoServicio = estado === 'iniciando'
  return (
    <div className="space-y-3">
      {enMarcha ? (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-900">
          <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />El servicio de OCR está funcionando.
        </p>
      ) : (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          {iniciandoServicio ? 'El servicio de OCR se está iniciando.' : 'El servicio de OCR no está disponible.'}
          {mensaje ? ` ${mensaje}` : ''}
        </p>
      )}
      {enMarcha && fallbackReason && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          Usa Tesseract como respaldo, menos preciso con manuscrito.
        </p>
      )}
      {gestionado && datos?.desactualizado && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">Hay una versión nueva del OCR. Pulsa «Reinstalar» cuando puedas.</p>
      )}
      {datos && !gestionado && !enMarcha && (
        <p className="text-sm text-slate-700">Este servidor usa un servicio de OCR aparte; revisa que esté encendido.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {gestionado && !enMarcha && (
          <button type="button" className="btn" disabled={ocupado || iniciandoServicio} onClick={() => void accion(() => iniciar.mutate())}>
            <LuPlay className="size-5" aria-hidden />
            {iniciar.loading || iniciandoServicio ? 'Iniciando…' : 'Iniciar'}
          </button>
        )}
        {gestionado && (enMarcha || iniciandoServicio) && (
          <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => void accion(() => detener.mutate())}>
            <LuSquare className="size-5" aria-hidden />
            {detener.loading ? 'Deteniendo…' : 'Detener'}
          </button>
        )}
        {!enMarcha && (
          <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void verificar()}>
            <LuRefreshCw className="size-5" aria-hidden />
            {buscando ? 'Buscando…' : 'Probar de nuevo'}
          </button>
        )}
      </div>

      {gestionado && datos && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => setConfirmar('reinstalar')}>
              <LuRotateCcw className="size-5" aria-hidden />
              Reinstalar
            </button>
            <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => setConfirmar('desinstalar')}>
              <LuTrash2 className="size-5" aria-hidden />
              Desinstalar
            </button>
          </div>
          {confirmar && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm text-slate-800">
                {confirmar === 'reinstalar'
                  ? 'Se vuelve a instalar todo. El OCR no funcionará mientras tanto y necesita internet.'
                  : 'Se borra el OCR local de este servidor (los modelos descargados se guardan). Las páginas escaneadas no se podrán leer hasta instalarlo otra vez.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={ocupado}
                  onClick={() => void accion(() => (confirmar === 'reinstalar' ? instalar.mutate() : desinstalar.mutate()))}
                >
                  {confirmar === 'reinstalar' ? 'Sí, reinstalar' : 'Sí, desinstalar'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmar(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {avisoError}
      <BotonProbarOcr etiqueta="Probar el OCR" nota={null} />
    </div>
  )
}
