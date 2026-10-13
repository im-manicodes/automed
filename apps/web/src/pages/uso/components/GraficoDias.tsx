import { formatDia } from '../../../lib/format'
import type { RespuestaUso } from '../../../lib/api'
import { formatoCosto, formatoTokens } from '../lib/uso'

export default function GraficoDias({ dias }: { dias: RespuestaUso['porDia'] }) {
  if (dias.length === 0) return <p className="text-slate-700">No hay días con uso en este periodo.</p>
  const max = Math.max(...dias.map((d) => d.costo), 0)
  const resumen = `Costo estimado por día: ${dias.map((d) => `${formatDia(d.fecha)} ${formatoCosto(d.costo)}`).join(', ')}.`
  return (
    <div className="space-y-2">
      <div role="img" aria-label={resumen} className="flex h-40 items-end gap-1 rounded-xl border border-slate-200 bg-white p-3">
        {dias.map((d) => (
          <div key={d.fecha} className="flex h-full min-w-1 flex-1 items-end" title={`${formatDia(d.fecha)}: ${formatoCosto(d.costo)}`}>
            <div className="w-full rounded-t bg-blue-600" style={{ height: `${max > 0 ? Math.max((d.costo / max) * 100, 2) : 2}%` }} />
          </div>
        ))}
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Ver los datos en tabla</summary>
        <table className="w-full text-left">
          <caption className="sr-only">Costo y tokens por día</caption>
          <thead><tr><th scope="col" className="py-1">Día</th><th scope="col">Tokens</th><th scope="col" className="text-right">Costo</th></tr></thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.fecha} className="border-t border-slate-100">
                <th scope="row" className="py-1 font-normal">{formatDia(d.fecha)}</th>
                <td>{formatoTokens(d.tokens)}</td>
                <td className="text-right">{formatoCosto(d.costo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
