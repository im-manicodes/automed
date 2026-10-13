import type { UsoPorModelo } from '../../../lib/api'
import { etiquetaActividad, formatoCosto, formatoTokens } from '../lib/uso'

export default function TablaModelos({ filas }: { filas: UsoPorModelo[] }) {
  if (filas.length === 0) return <p className="text-slate-700">Todavía no hay uso en este periodo.</p>
  return (
    <ul aria-label="Uso por modelo y actividad" className="space-y-2">
      {filas.map((f) => (
        <li key={`${f.kind}|${f.provider}|${f.model}|${f.task}`} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
          <p className="font-semibold">{etiquetaActividad(f.task)}</p>
          <p className="break-all text-sm text-slate-600">{f.model} · {f.provider}</p>
          <p className="text-slate-800">
            {f.kind === 'ocr'
              ? `${formatoTokens(f.paginas)} páginas`
              : `${formatoTokens(f.inputTokens)} entrada · ${formatoTokens(f.outputTokens)} salida`}
            {' · '}{f.llamadas === 1 ? '1 llamada' : `${formatoTokens(f.llamadas)} llamadas`}
          </p>
          {f.kind === 'llm' && ((f.cachedTokens ?? 0) > 0 || (f.cacheWriteTokens ?? 0) > 0) && (
            <p className="text-sm text-slate-600">
              Caché: {formatoTokens(f.cachedTokens ?? 0)} leídos · {formatoTokens(f.cacheWriteTokens ?? 0)} escritos
            </p>
          )}
          <p className="font-semibold">
            {f.costo === null ? <span className="text-amber-800">Sin precio</span> : formatoCosto(f.costo)}
            {f.estimado && <span className="ml-2 text-sm font-normal text-slate-600">(estimado)</span>}
          </p>
        </li>
      ))}
    </ul>
  )
}
