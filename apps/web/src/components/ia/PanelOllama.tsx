import { useEffect, useRef, useState } from 'react'
import { LuCheck, LuCopy, LuRotateCw, LuTriangleAlert } from 'react-icons/lu'
import { useGuardarAjustesIa } from '../../hooks/useAjustesIa'
import { instalado, useModelosOllama, type EstadoModelo } from '../../hooks/useModelosOllama'
import type { HardwareIa } from '../../lib/api'
import { formatoAvance } from '../../lib/format'

const COMANDO_DOCKER = `printf '[Service]\\nEnvironment="OLLAMA_HOST=0.0.0.0"\\nEnvironment="OLLAMA_CONTEXT_LENGTH=8192"\\n' | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama`

function GuiaDocker() {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(COMANDO_DOCKER)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-slate-700">En Linux, abre una terminal y pega estos comandos (crean el archivo <span className="break-all">/etc/systemd/system/ollama.service.d/override.conf</span> y reinician Ollama):</p>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-sm text-slate-50">{COMANDO_DOCKER}</pre>
      <button type="button" className="btn btn-secondary" onClick={() => void copiar()}>
        <LuCopy className="size-5" aria-hidden />{copiado ? 'Copiado' : 'Copiar'}
      </button>
      <p className="text-sm text-slate-700">En Mac o Windows con Docker Desktop debería funcionar sin cambios; revisa la URL en Ajustes.</p>
    </div>
  )
}

function DescargaModelo({ modelo, estado, onReintentar }: { modelo: string; estado?: EstadoModelo; onReintentar: () => void }) {
  const pct = estado && estado.total > 0 ? Math.min(100, Math.round((estado.completado / estado.total) * 100)) : 0
  const error = estado?.estado === 'error'
  const listo = estado?.estado === 'listo'
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="break-all font-semibold">{modelo}</p>
      {listo ? (
        <p role="status" className="text-green-900"><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Listo</p>
      ) : error ? (
        <>
          <p role="alert" className="text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{estado?.error ?? 'La descarga falló.'}</p>
          <button type="button" className="btn" onClick={onReintentar}><LuRotateCw className="size-5" aria-hidden />Reintentar</button>
        </>
      ) : (
        <>
          <p className="text-slate-700">{estado?.estado === 'descargando' ? 'Descargando…' : 'En espera…'}</p>
          <div role="progressbar" aria-label={`Descarga de ${modelo}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
          </div>
          {estado && estado.total > 0 && <p className="text-sm text-slate-700">{formatoAvance(estado.completado, estado.total)}</p>}
        </>
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
  /** Si es false no se detecta ni se descarga nada (por defecto true). */
  activo?: boolean
  /** Avisa cuando cambia si Ollama y todos los modelos están listos (también al montar). */
  onListoChange?: (listo: boolean) => void
}

export default function PanelOllama({ hardware, onRecheck, modelos, activo = true, onListoChange }: Props) {
  const { estados, listo, desactualizado, reintentar } = useModelosOllama({ activo, hardware, modelos, onRecheck })
  const avisoRef = useRef(onListoChange)
  useEffect(() => {
    avisoRef.current = onListoChange
  })
  useEffect(() => {
    avisoRef.current?.(listo)
  }, [listo])
  useEffect(() => () => avisoRef.current?.(false), [])
  const [buscando, setBuscando] = useState(false)
  const onRecheckRef = useRef(onRecheck)
  useEffect(() => {
    onRecheckRef.current = onRecheck
  })
  const guardar = useGuardarAjustesIa()
  const guardarRef = useRef(guardar.mutate)
  useEffect(() => {
    guardarRef.current = guardar.mutate
  })
  const urlDetectada = hardware?.ollama.urlDetectada
  const urlGuardada = useRef<string | null>(null)
  useEffect(() => {
    if (!activo || !urlDetectada || urlGuardada.current === urlDetectada) return
    urlGuardada.current = urlDetectada
    void Promise.resolve(guardarRef.current({ body_params: { ollamaUrl: urlDetectada } }))
      .then(() => onRecheckRef.current())
      .catch(() => {})
  }, [activo, urlDetectada])
  const recheck = async () => {
    setBuscando(true)
    try {
      await onRecheck()
    } finally {
      setBuscando(false)
    }
  }
  if (!hardware) return <p className="text-slate-700">Buscando Ollama…</p>

  if (!hardware.ollama.alcanzable && hardware.entorno === 'docker') {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Ollama no acepta conexiones desde Docker.
        </p>
        <GuiaDocker />
        <div className="flex flex-wrap gap-2">
          <a className="btn" href="https://ollama.com/download" target="_blank" rel="noreferrer">Descargar Ollama</a>
          <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void recheck()}>
            {buscando ? 'Buscando…' : 'Probar de nuevo'}
          </button>
        </div>
      </div>
    )
  }

  if (!hardware.ollama.alcanzable) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />No encontramos Ollama en este equipo.
        </p>
        <p className="text-slate-700">Instálalo y ábrelo: lo detectaremos solos y descargaremos el modelo por ti.</p>
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
      {desactualizado && (
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
          {faltan.map((m) => <DescargaModelo key={m} modelo={m} estado={estados[m]} onReintentar={() => reintentar(m)} />)}
        </div>
      )}
      <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void recheck()}>
        {buscando ? 'Buscando…' : 'Probar de nuevo'}
      </button>
    </div>
  )
}
