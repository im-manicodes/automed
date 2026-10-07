import { useEffect, useRef, useState } from 'react'
import { LuCheck, LuDownload, LuTriangleAlert } from 'react-icons/lu'
import { useIniciarDescargaModelo, useProgresoDescarga } from '../../hooks/useAjustesIa'
import { usePolling } from '../../hooks/usePolling'
import type { HardwareIa } from '../../lib/api'
import { errorMessage } from '../../lib/format'

const instalado = (hw: HardwareIa, modelo: string) =>
  hw.ollama.modelos.some((m) => m === modelo || m === `${modelo}:latest`)

function DescargaModelo({ modelo, onListo }: { modelo: string; onListo: () => void }) {
  const [iniciado, setIniciado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const { mutate, loading } = useIniciarDescargaModelo()
  const listoRef = useRef(onListo)
  useEffect(() => {
    listoRef.current = onListo
  })
  const { data, refetch } = useProgresoDescarga(modelo, iniciado, {
    onSuccess: (d) => {
      if (d.estado === 'listo') listoRef.current()
    },
  })
  const estado = data?.estado
  usePolling(() => void refetch(), 1500, iniciado && estado !== 'listo' && estado !== 'error')

  const iniciar = async () => {
    setFallo(null)
    try {
      await mutate({ body_params: { modelo } })
      setIniciado(true)
    } catch (e) {
      setFallo(errorMessage(e))
    }
  }

  const pct = data && data.total > 0 ? Math.min(100, Math.round((data.completado / data.total) * 100)) : 0
  const descargando = iniciado && estado !== 'listo' && estado !== 'error'

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="break-all font-semibold">{modelo}</p>
      {estado === 'listo' ? (
        <p role="status" className="text-green-900"><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Modelo descargado</p>
      ) : (
        <button type="button" className="btn" disabled={loading || descargando} onClick={() => void iniciar()}>
          <LuDownload className="size-5" aria-hidden />{descargando ? 'Descargando…' : `Descargar ${modelo}`}
        </button>
      )}
      {descargando && (
        <div className="space-y-1">
          <div role="progressbar" aria-label={`Descarga de ${modelo}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-slate-700">{pct}%</p>
        </div>
      )}
      {(fallo || (estado === 'error' && (data?.error ?? 'La descarga falló.'))) && (
        <p role="alert" className="text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{fallo ?? data?.error ?? 'La descarga falló.'}</p>
      )}
    </div>
  )
}

interface Props {
  hardware: HardwareIa | null
  /** Vuelve a consultar al equipo (detección de Ollama y modelos instalados). */
  onRecheck: () => Promise<unknown> | void
  /** Modelos elegidos para las tareas (se ofrece descargar los que falten). */
  modelos: string[]
}

export default function PanelOllama({ hardware, onRecheck, modelos }: Props) {
  const [buscando, setBuscando] = useState(false)
  const recheck = async () => {
    setBuscando(true)
    try {
      await onRecheck()
    } finally {
      setBuscando(false)
    }
  }
  if (!hardware) return <p className="text-slate-700">Buscando Ollama…</p>

  if (!hardware.ollama.alcanzable) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />No encontramos Ollama en este equipo.
        </p>
        <p className="text-slate-700">Instálalo, ábrelo y vuelve aquí.</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href="https://ollama.com/download" target="_blank" rel="noreferrer">Descargar Ollama</a>
          <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void recheck()}>
            {buscando ? 'Buscando…' : 'Probar de nuevo'}
          </button>
        </div>
      </div>
    )
  }

  const faltan = [...new Set(modelos.filter(Boolean))].filter((m) => !instalado(hardware, m))
  return (
    <div className="space-y-3">
      <p role="status" className="text-green-900">
        <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Ollama está listo{hardware.ollama.version ? ` (versión ${hardware.ollama.version})` : ''}.
      </p>
      {hardware.ollama.requiereActualizar && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          Tu Ollama es anterior a la versión {hardware.ollama.versionMinima ?? '0.12.7'}, que el modelo recomendado (Qwen3-VL) necesita. Actualiza Ollama desde ollama.com/download y pulsa «Probar de nuevo».
        </p>
      )}
      <div>
        <p className="font-semibold">Modelos instalados</p>
        {hardware.ollama.modelos.length === 0 ? (
          <p className="text-slate-700">Todavía no hay modelos instalados.</p>
        ) : (
          <ul className="list-disc pl-6 text-slate-700">{hardware.ollama.modelos.map((m) => <li key={m} className="break-all">{m}</li>)}</ul>
        )}
      </div>
      {faltan.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Falta descargar</p>
          {faltan.map((m) => <DescargaModelo key={m} modelo={m} onListo={() => void onRecheck()} />)}
        </div>
      )}
      <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void recheck()}>
        {buscando ? 'Buscando…' : 'Probar de nuevo'}
      </button>
    </div>
  )
}
