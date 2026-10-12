import type { ProgresoAnalisis as Progreso } from '../lib/api'

interface Props {
  progreso?: Progreso | null
  /** versión de la lista: solo barra y una línea corta */
  compact?: boolean
}

/** Texto sencillo de la etapa actual. */
function etapaTexto(p?: Progreso | null): string {
  if (!p) return 'Analizando…'
  if (p.reintento) return `Reintentando (${p.reintento.intento} de ${p.reintento.maximo})…`
  switch (p.etapa) {
    case 'en_cola':
      return 'En cola…'
    case 'escaneando_ocr': {
      const { total, listos } = p.adjuntos
      const actual = Math.min(listos + 1, total)
      return total > 1 ? `Escaneando el PDF ${actual} de ${total}…` : 'Escaneando el PDF…'
    }
    case 'ia_dudosas':
      return 'Pasando a la IA las partes dudosas…'
    case 'procesando_dudosas':
      return 'Procesando las partes dudosas…'
    case 'revision_manual':
      return 'Esperando tu revisión…'
    case 'generando_resumen':
      return 'Generando el resumen…'
    case 'resumen_listo':
      return 'Resumen generado'
  }
}

export default function ProgresoAnalisis({ progreso, compact = false }: Props) {
  const texto = etapaTexto(progreso)
  // Sin datos, o mientras se escribe el resumen (no se sabe cuánto tarda): barra indeterminada
  const indeterminada = !progreso || progreso.etapa === 'generando_resumen'
  const valor = progreso ? Math.max(0, Math.min(100, Math.round(progreso.porcentaje))) : 0
  const paginas = progreso?.etapa === 'escaneando_ocr' ? progreso.paginas : undefined
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div
        role="progressbar"
        aria-label="Progreso del análisis"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminada ? undefined : valor}
        aria-valuetext={texto}
        className={`relative w-full overflow-hidden rounded-full bg-blue-100 ${compact ? 'h-1.5' : 'h-3'}`}
      >
        {indeterminada ? (
          <div className="progreso-indeterminado absolute inset-y-0 w-1/3 rounded-full bg-blue-700" />
        ) : (
          <div
            className="h-full rounded-full bg-blue-700 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${valor}%` }}
          />
        )}
      </div>
      <p className={compact ? 'text-sm text-blue-900' : 'text-sm font-medium'}>
        {texto}
        {!compact && !indeterminada && <span className="ml-1 font-normal">{valor}%</span>}
        {!compact && paginas && (
          <span className="block font-normal">
            Páginas leídas: {paginas.leidas} de {paginas.total}
          </span>
        )}
      </p>
    </div>
  )
}
