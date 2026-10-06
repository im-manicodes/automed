import type { Reporte } from '../lib/api'

/** Barra de progreso del reporte: "Leyendo paciente N de M…". */
export default function ProgresoReporte({ progreso }: { progreso: Reporte['progreso'] }) {
  const { procesados, total } = progreso
  const indeterminada = total <= 0
  const valor = indeterminada ? 0 : Math.max(0, Math.min(100, Math.round((procesados / total) * 100)))
  const texto = indeterminada
    ? 'Preparando el reporte…'
    : procesados >= total
      ? 'Armando el Excel…'
      : `Leyendo paciente ${procesados + 1} de ${total}…`
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label="Progreso del reporte"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminada ? undefined : valor}
        aria-valuetext={texto}
        className="relative h-3 w-full overflow-hidden rounded-full bg-blue-100"
      >
        {indeterminada ? (
          <div className="progreso-indeterminado absolute inset-y-0 w-1/3 rounded-full bg-blue-700" />
        ) : (
          <div className="h-full rounded-full bg-blue-700 transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${valor}%` }} />
        )}
      </div>
      <p className="text-sm font-medium">
        {texto}
        {!indeterminada && <span className="ml-1 font-normal">{valor}%</span>}
      </p>
    </div>
  )
}
