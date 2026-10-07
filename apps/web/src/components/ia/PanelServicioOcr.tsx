import { useState } from 'react'
import { LuCheck, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import type { AjustesOcr } from '../../lib/api'
import BotonProbarOcr from './BotonProbarOcr'

interface Props {
  ajustes: AjustesOcr
  /** Vuelve a pedir los ajustes (estado real del servicio OCR del servidor). */
  onRecheck: () => Promise<unknown> | void
}

/** Estado del servicio de OCR local (contenedor ocr-local) cuando la app corre en un servidor. */
export default function PanelServicioOcr({ ajustes, onRecheck }: Props) {
  const { estado, fallbackReason, mensaje } = ajustes.servicioLocal
  const [buscando, setBuscando] = useState(false)

  const verificar = async () => {
    setBuscando(true)
    try {
      await onRecheck()
    } finally {
      setBuscando(false)
    }
  }

  if (estado === 'listo') {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-900">
          <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />El servicio de OCR está funcionando.
        </p>
        {fallbackReason && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
            <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
            Usa Tesseract como respaldo, menos preciso con manuscrito.
          </p>
        )}
        <BotonProbarOcr etiqueta="Probar el OCR" nota={null} />
      </div>
    )
  }

  const iniciando = estado === 'iniciando'
  return (
    <div className="space-y-3">
      <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">
        <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        {iniciando ? 'El servicio de OCR se está iniciando.' : 'El servicio de OCR no está disponible.'}
        {mensaje ? ` ${mensaje}` : ''}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-slate-800">
        <li>Levanta el servicio con <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">docker compose up -d ocr-local</code></li>
        <li>Pulsa Probar de nuevo.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={buscando} onClick={() => void verificar()}>
          <LuRefreshCw className="size-5" aria-hidden />{buscando ? 'Buscando…' : 'Probar de nuevo'}
        </button>
      </div>
      <BotonProbarOcr etiqueta="Probar el OCR" nota={null} />
    </div>
  )
}
