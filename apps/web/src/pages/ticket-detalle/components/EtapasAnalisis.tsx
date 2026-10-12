import { useState } from 'react'
import { LuCircleCheck, LuEye, LuFileText, LuHand, LuScanLine, LuSparkles } from 'react-icons/lu'
import type { IconType } from 'react-icons'
import type { EtapaProgreso, ProgresoAnalisis } from '../../../lib/api'

interface Props {
  progreso?: ProgresoAnalisis | null
}

type PasoId = 'ocr' | 'ia' | 'dudosas' | 'revision' | 'resumen' | 'listo'

const PASOS: { id: PasoId; etiqueta: string; Icono: IconType }[] = [
  { id: 'ocr', etiqueta: 'Escaneando el PDF con OCR', Icono: LuScanLine },
  { id: 'ia', etiqueta: 'Pasando a la IA las partes dudosas', Icono: LuSparkles },
  { id: 'dudosas', etiqueta: 'Procesando las partes dudosas', Icono: LuEye },
  { id: 'revision', etiqueta: 'Revisión manual', Icono: LuHand },
  { id: 'resumen', etiqueta: 'Generando el resumen', Icono: LuFileText },
  { id: 'listo', etiqueta: 'Resumen generado', Icono: LuCircleCheck },
]

/** Posición (en PASOS) del paso en curso; -1 = aún en cola. */
const POSICION: Record<EtapaProgreso, number> = {
  en_cola: -1,
  escaneando_ocr: 0,
  ia_dudosas: 1,
  procesando_dudosas: 2,
  revision_manual: 3,
  generando_resumen: 4,
  resumen_listo: 5,
}

type Estado = 'hecho' | 'actual' | 'pendiente'

/** Lista animada de las etapas del análisis (tab «Resumen» mientras se analiza). */
export default function EtapasAnalisis({ progreso }: Props) {
  const etapa: EtapaProgreso = progreso?.etapa ?? 'en_cola'
  // El paso 3 solo se muestra si está o estuvo activo (o ya hay un conteo de zonas).
  const [vioDudosas, setVioDudosas] = useState(false)
  const activaAhora = etapa === 'procesando_dudosas' || !!progreso?.regiones
  if (activaAhora && !vioDudosas) setVioDudosas(true)
  const mostrarDudosas = vioDudosas || activaAhora

  const actual = POSICION[etapa]
  const visibles = PASOS.filter((p) => {
    if (p.id === 'dudosas') return mostrarDudosas
    if (p.id === 'revision') return etapa === 'revision_manual'
    return true
  })

  const estadoDe = (id: PasoId): Estado => {
    const pos = PASOS.findIndex((p) => p.id === id)
    if (etapa === 'resumen_listo') return 'hecho'
    if (pos < actual) return 'hecho'
    if (pos === actual) return 'actual'
    return 'pendiente'
  }

  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-4">
      <ol className="space-y-3">
        {visibles.map(({ id, etiqueta, Icono }) => {
          const estado = estadoDe(id)
          const detalle =
            id === 'ocr' && estado === 'actual' && progreso?.paginas
              ? `Páginas leídas: ${progreso.paginas.leidas} de ${progreso.paginas.total}`
              : id === 'dudosas' && estado === 'actual' && progreso?.regiones
                ? `Zona ${Math.min(progreso.regiones.hechas + 1, progreso.regiones.total)} de ${progreso.regiones.total}`
                : id === 'revision' && estado === 'actual'
                  ? 'Corrige las zonas marcadas en rojo para seguir.'
                  : ''
          const color =
            estado === 'hecho'
              ? 'bg-green-100 text-green-800'
              : estado === 'actual'
                ? 'bg-blue-100 text-blue-800 animate-pulse motion-reduce:animate-none'
                : 'bg-slate-100 text-slate-500'
          return (
            <li
              key={id}
              data-estado={estado}
              aria-current={estado === 'actual' ? 'step' : undefined}
              className={`flex items-start gap-3 transition-opacity duration-500 motion-reduce:transition-none ${estado === 'pendiente' ? 'opacity-60' : 'opacity-100'}`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-500 motion-reduce:transition-none ${color}`}>
                {estado === 'hecho' && id !== 'listo' ? <LuCircleCheck className="size-5" aria-hidden /> : <Icono className="size-5" aria-hidden />}
              </span>
              <span className="min-w-0 pt-1">
                <span className={`block ${estado === 'actual' ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {etiqueta}
                  <span className="sr-only">{estado === 'hecho' ? ' (hecho)' : estado === 'actual' ? ' (en curso)' : ' (pendiente)'}</span>
                </span>
                {detalle && <span className="block text-sm text-slate-700">{detalle}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
