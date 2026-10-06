import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LuChevronLeft, LuChevronRight, LuMaximize, LuMinus, LuPlus } from 'react-icons/lu'
import { usePaginaImagen } from '../revision/usePaginaImagen'
import { useRuedaZoom } from '../revision/useRuedaZoom'
import { ajustar, ajustarTamano, alternarZoom, desplazar, zoomEn, type Size, type Transform } from '../revision/lib/viewport'
import { urlImagenPagina } from '../revision/revisionApi'
import ErrorBox from './ErrorBox'
import Spinner from './Spinner'

interface Props {
  attachmentId: string
  /** Números de página disponibles (con imagen), en orden. */
  paginas: number[]
}

/** Visor simple de páginas de un documento: anterior/siguiente, zoom con rueda/botones, arrastre y doble clic. */
export default function VisorPaginas({ attachmentId, paginas }: Props) {
  const [indice, setIndice] = useState(0)
  const pageNumber = paginas[Math.min(indice, paginas.length - 1)]
  const { img, error, reintentar } = usePaginaImagen(attachmentId, pageNumber)
  const caja = useRef<HTMLDivElement>(null)
  const [vista, setVista] = useState<Size>({ w: 1, h: 1 })
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const arrastre = useRef<{ x: number; y: number } | null>(null)

  const natural: Size = img ? { w: img.naturalWidth || 1, h: img.naturalHeight || 1 } : { w: 1, h: 1 }
  const contenido = ajustarTamano(natural, vista)

  useLayoutEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setVista({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Al cambiar de página, de documento o de tamaño, se vuelve a ajustar a la pantalla.
  useEffect(() => {
    setT(ajustar(contenido, vista))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, attachmentId, img, vista.w, vista.h])

  useEffect(() => {
    setIndice(0)
  }, [attachmentId])

  useRuedaZoom(caja, (factor, x, y) => setT((prev) => zoomEn(prev, prev.scale * factor, x, y, contenido, vista)))

  const zoomBoton = useCallback(
    (factor: number) => setT((prev) => zoomEn(prev, prev.scale * factor, vista.w / 2, vista.h / 2, contenido, vista)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vista.w, vista.h, contenido.w, contenido.h],
  )

  const total = paginas.length
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary" aria-label="Página anterior" disabled={indice <= 0} onClick={() => setIndice((i) => i - 1)}>
          <LuChevronLeft className="size-5" aria-hidden />
        </button>
        <p className="flex-1 text-center font-semibold" aria-live="polite">Página {indice + 1} de {total}</p>
        <button type="button" className="btn btn-secondary" aria-label="Página siguiente" disabled={indice >= total - 1} onClick={() => setIndice((i) => i + 1)}>
          <LuChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <div
        ref={caja}
        className="relative min-h-64 flex-1 touch-none select-none overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-300"
        onPointerDown={(e) => {
          arrastre.current = { x: e.clientX, y: e.clientY }
          caja.current?.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const a = arrastre.current
          if (!a) return
          arrastre.current = { x: e.clientX, y: e.clientY }
          setT((prev) => desplazar(prev, e.clientX - a.x, e.clientY - a.y, contenido, vista))
        }}
        onPointerUp={() => (arrastre.current = null)}
        onPointerCancel={() => (arrastre.current = null)}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setT((prev) => alternarZoom(prev, e.clientX - r.left, e.clientY - r.top, contenido, vista))
        }}
      >
        {img && (
          <img
            src={urlImagenPagina(attachmentId, pageNumber)}
            alt={`Página ${indice + 1} de ${total} del documento`}
            draggable={false}
            className="absolute left-0 top-0 max-w-none bg-white"
            style={{ width: contenido.w, height: contenido.h, transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, transformOrigin: '0 0' }}
          />
        )}
        {!img && !error && <Spinner text="Cargando la página…" />}
        {error && (
          <div className="p-3">
            <ErrorBox message="No se pudo cargar la imagen de la página." onRetry={reintentar} />
          </div>
        )}
      </div>

      <div className="flex gap-2" role="group" aria-label="Zoom de la página">
        <button type="button" className="btn btn-secondary flex-1" aria-label="Acercar" onClick={() => zoomBoton(1.5)}>
          <LuPlus className="size-5" aria-hidden />
        </button>
        <button type="button" className="btn btn-secondary flex-1" aria-label="Alejar" onClick={() => zoomBoton(1 / 1.5)}>
          <LuMinus className="size-5" aria-hidden />
        </button>
        <button type="button" className="btn btn-secondary flex-[2]" onClick={() => setT(ajustar(contenido, vista))}>
          <LuMaximize className="size-5" aria-hidden />Ajustar
        </button>
      </div>
    </div>
  )
}
