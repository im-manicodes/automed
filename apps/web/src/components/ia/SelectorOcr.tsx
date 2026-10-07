import { LuInfo } from 'react-icons/lu'
import type { AjustesOcr, MotorOcr } from '../../lib/api'
import { OPCIONES_OCR } from '../../lib/ocr'

interface Props {
  value: MotorOcr
  onChange: (m: MotorOcr) => void
  entorno: AjustesOcr['entorno']
}

/** Tarjetas para elegir cómo se leen los PDF escaneados. */
export default function SelectorOcr({ value, onChange, entorno }: Props) {
  return (
    <div role="radiogroup" aria-label="Lectura de PDFs escaneados" className="grid gap-3">
      {OPCIONES_OCR.map((o) => {
        const bloqueado = o.id === 'local' && !entorno.servidor
        const activo = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-disabled={bloqueado || undefined}
            disabled={bloqueado}
            onClick={() => onChange(o.id)}
            className={`min-h-12 rounded-xl border-2 p-4 text-left ${activo ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'} ${bloqueado ? 'opacity-70' : ''}`}
          >
            <span className="block text-lg font-bold">{o.nombre}</span>
            <span className="block text-slate-700">{o.descripcion}</span>
            {bloqueado && (
              <span className="mt-2 block text-sm text-slate-800">
                <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
                No disponible en este entorno.
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
