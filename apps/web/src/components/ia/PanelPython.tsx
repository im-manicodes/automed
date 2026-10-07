import { useState } from 'react'
import { LuCheck, LuCopy, LuDownload, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import { useInstalarPython, useProgresoPython } from '../../hooks/useAjustesOcr'
import { usePolling } from '../../hooks/usePolling'
import type { AjustesOcr } from '../../lib/api'
import { copiarTexto } from '../../lib/clipboard'
import { errorMessage } from '../../lib/format'

interface Props {
  ajustes: AjustesOcr
  /** Vuelve a pedir los ajustes (detección de Python y estado del entorno). */
  onRecheck: () => Promise<unknown> | void
}

function ComandoCopiable({ comando }: { comando: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    if (await copiarTexto(comando)) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-sm whitespace-pre text-slate-50">{comando}</code>
      <button type="button" className="btn btn-secondary shrink-0" aria-label={`Copiar comando: ${comando}`} onClick={() => void copiar()}>
        {copiado ? <LuCheck className="size-5" aria-hidden /> : <LuCopy className="size-5" aria-hidden />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

function Guia({ guia }: { guia: AjustesOcr['python']['guia'] }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="font-bold">{guia.titulo}</h4>
      {guia.pasos.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-slate-800">
          {guia.pasos.map((p, i) => <li key={i}>{p}</li>)}
        </ol>
      )}
      {guia.comandos.map((c, i) => <ComandoCopiable key={i} comando={c} />)}
      {guia.enlace && (
        <a href={guia.enlace} target="_blank" rel="noreferrer" className="btn btn-secondary">
          <LuDownload className="size-5" aria-hidden />Descargar Python
        </a>
      )}
    </div>
  )
}

/** Estado de Python en este equipo, guía de instalación y preparación del entorno del OCR. */
export default function PanelPython({ ajustes, onRecheck }: Props) {
  const { python, entornoPython } = ajustes
  const [iniciado, setIniciado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)
  const instalar = useInstalarPython()
  const consultar = iniciado || entornoPython.estado === 'preparando'
  const progreso = useProgresoPython(consultar, {
    onSuccess: (d) => {
      if (d.estado === 'listo' || d.estado === 'error') void onRecheck()
    },
  })
  const estadoProg = progreso.data?.estado
  usePolling(() => void progreso.refetch(), 1500, consultar && estadoProg !== 'listo' && estadoProg !== 'error')

  const verificar = async () => {
    setVerificando(true)
    try {
      await onRecheck()
    } finally {
      setVerificando(false)
    }
  }

  const preparar = async () => {
    setFallo(null)
    try {
      await instalar.mutate()
      setIniciado(true)
      await progreso.refetch()
    } catch (e) {
      setFallo(errorMessage(e))
    }
  }

  const BotonVerificar = (
    <button type="button" className="btn btn-secondary" disabled={verificando} onClick={() => void verificar()}>
      <LuRefreshCw className="size-5" aria-hidden />{verificando ? 'Verificando…' : 'Verificar de nuevo'}
    </button>
  )

  if (!python.detectado || !python.compatible) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          {!python.detectado
            ? `No encontramos Python en tu computador. Necesitas la versión ${python.requerido}.`
            : `Encontramos Python ${python.version ?? ''}, pero no sirve para el OCR (se necesita ${python.rango}).${python.motivo ? ` ${python.motivo}` : ''}`}
        </p>
        <Guia guia={python.guia} />
        {BotonVerificar}
      </div>
    )
  }

  const preparando = estadoProg === 'preparando' || (iniciado && !estadoProg) || (entornoPython.estado === 'preparando' && estadoProg !== 'error' && estadoProg !== 'listo')
  const lineas = progreso.data?.lineas ?? []
  const errorMsg = fallo ?? (estadoProg === 'error' ? (progreso.data?.mensaje ?? 'No se pudo preparar el OCR.') : entornoPython.estado === 'error' && !preparando ? (entornoPython.mensaje ?? 'No se pudo preparar el OCR.') : null)
  const listo = entornoPython.estado === 'listo' && !preparando

  return (
    <div className="space-y-3">
      <p className="text-green-900"><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Python {python.version} es compatible.</p>
      {listo ? (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-900"><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />El OCR está preparado.</p>
      ) : (
        <>
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            Preparar el OCR necesita internet, puede tardar varios minutos y descarga más de 1 GB.
          </p>
          <button type="button" className="btn" disabled={preparando || instalar.loading} onClick={() => void preparar()}>
            {errorMsg ? <LuRefreshCw className="size-5" aria-hidden /> : <LuDownload className="size-5" aria-hidden />}
            {preparando ? 'Preparando…' : errorMsg ? 'Reintentar' : 'Preparar el OCR'}
          </button>
        </>
      )}
      {preparando && <p role="status" className="text-slate-800">Preparando el OCR. No cierres la aplicación.</p>}
      {lineas.length > 0 && !listo && (
        <pre role="log" aria-label="Detalle de la preparación" tabIndex={0} className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs whitespace-pre-wrap text-slate-50">
          {lineas.slice(-30).join('\n')}
        </pre>
      )}
      {errorMsg && <p role="alert" className="text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{errorMsg}</p>}
    </div>
  )
}
