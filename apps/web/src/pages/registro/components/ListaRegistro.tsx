import type { IconType } from 'react-icons'
import { LuBug, LuCircleX, LuInfo, LuTriangleAlert } from 'react-icons/lu'
import type { EntradaRegistro, NivelRegistro } from '../../../lib/api'
import { horaRegistro, NOMBRE_NIVEL } from '../lib/niveles'

const ESTILO: Record<NivelRegistro, { icono: IconType; clase: string }> = {
  error: { icono: LuCircleX, clase: 'border-red-200 bg-red-50 text-red-900' },
  warn: { icono: LuTriangleAlert, clase: 'border-amber-200 bg-amber-50 text-amber-900' },
  log: { icono: LuInfo, clase: 'border-slate-200 bg-white text-slate-800' },
  debug: { icono: LuBug, clase: 'border-slate-200 bg-slate-50 text-slate-600' },
  verbose: { icono: LuBug, clase: 'border-slate-200 bg-slate-50 text-slate-600' },
}

/** Lista de líneas, la más reciente arriba. */
export default function ListaRegistro({ lineas }: { lineas: EntradaRegistro[] }) {
  if (lineas.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">No hay líneas para mostrar.</p>
  }
  const ordenadas = [...lineas].reverse()
  return (
    <ol aria-label="Líneas del registro" className="space-y-2">
      {ordenadas.map((l) => {
        const { icono: Icono, clase } = ESTILO[l.nivel] ?? ESTILO.log
        return (
          <li key={l.id} className={`rounded-lg border p-3 ${clase}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Icono className="size-4 shrink-0" aria-hidden />
              <span className="font-semibold">{NOMBRE_NIVEL[l.nivel] ?? l.nivel}</span>
              <time dateTime={l.ts} className="tabular-nums opacity-80">{horaRegistro(l.ts)}</time>
              <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs">{l.contexto}</span>
            </div>
            <p className="mt-1 font-mono text-sm break-words whitespace-pre-wrap">{l.mensaje}</p>
          </li>
        )
      })}
    </ol>
  )
}
