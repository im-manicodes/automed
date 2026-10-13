import { LuArrowDownToLine, LuArrowUpFromLine, LuCalculator, LuTrendingUp } from 'react-icons/lu'
import type { RespuestaPronostico, RespuestaUso } from '../../../lib/api'
import { formatoCosto, formatoTokens } from '../lib/uso'

function Tarjeta({ icono, titulo, valor, nota }: { icono: React.ReactNode; titulo: string; valor: string; nota?: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-2 text-slate-700">{icono}{titulo}</p>
      <p className="text-2xl font-bold">{valor}</p>
      {nota && <p className="text-sm text-slate-600">{nota}</p>}
    </div>
  )
}

export default function TarjetasUso({ uso, pronostico }: { uso: RespuestaUso; pronostico: RespuestaPronostico | null }) {
  const t = uso.totales
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Tarjeta icono={<LuArrowDownToLine className="size-5" aria-hidden />} titulo="Tokens de entrada" valor={formatoTokens(t.inputTokens)} nota={t.cachedTokens > 0 ? `${formatoTokens(t.cachedTokens)} desde caché` : undefined} />
        <Tarjeta icono={<LuArrowUpFromLine className="size-5" aria-hidden />} titulo="Tokens de salida" valor={formatoTokens(t.outputTokens)} />
        <Tarjeta icono={<LuCalculator className="size-5" aria-hidden />} titulo="Costo estimado" valor={formatoCosto(t.costo)} nota={t.paginasOcr > 0 ? `Incluye ${formatoTokens(t.paginasOcr)} páginas de OCR de pago` : undefined} />
        <Tarjeta
          icono={<LuTrendingUp className="size-5" aria-hidden />}
          titulo="Pronóstico (estimado)"
          valor={pronostico ? formatoCosto(pronostico.finDeMes) : '—'}
          nota={pronostico ? `al terminar el mes. Próximos 30 días: ${formatoCosto(pronostico.proximos30Dias)}` : 'Sin datos todavía'}
        />
      </div>
      {pronostico && pronostico.diasConDatos < 2 && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
          Hay pocos días de datos, así que el pronóstico puede no ser confiable. Mejora con el uso diario.
        </p>
      )}
    </div>
  )
}
