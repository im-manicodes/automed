import { LuInfo } from 'react-icons/lu'
import type { MotorOcr } from '../../lib/api'
import type { AvanzadoOcr as Valor } from '../../lib/ocr'

interface Props {
  motor: MotorOcr
  valor: Valor
  onChange: (v: Valor) => void
}

const CAMPO = 'min-h-12 w-full rounded-xl border border-slate-300 px-3'

/** Opciones avanzadas de la lectura de PDFs escaneados. */
export default function AvanzadoOcr({ motor, valor, onChange }: Props) {
  const cambia = (c: Partial<Valor>) => onChange({ ...valor, ...c })
  const regionesMal = !Number.isInteger(valor.visionMaxRegions) || valor.visionMaxRegions < 1 || valor.visionMaxRegions > 200
  return (
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="min-h-11 cursor-pointer font-semibold">Opciones avanzadas de lectura</summary>
      <div className="mt-3 space-y-4">
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-3 font-semibold">
            <input
              type="checkbox"
              role="switch"
              className="size-5"
              checked={valor.visionRetry}
              onChange={(e) => cambia({ visionRetry: e.target.checked })}
            />
            Releer con IA las partes dudosas (letra a mano)
          </label>
          <p className="text-sm text-slate-700">
            <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Usa un modelo con visión (Ajustes → IA) y hace una llamada por parte dudosa; con AWS el contenido va a AWS.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="max-partes" className="block font-semibold">Máximo de partes a releer</label>
          <input
            id="max-partes"
            type="number"
            min={1}
            max={200}
            className={CAMPO}
            value={valor.visionMaxRegions}
            disabled={!valor.visionRetry}
            aria-invalid={regionesMal}
            onChange={(e) => cambia({ visionMaxRegions: Number(e.target.value) })}
          />
          <p className={`text-sm ${regionesMal ? 'text-red-700' : 'text-slate-700'}`}>Un número entre 1 y 200.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="calidad-lectura" className="block font-semibold">Calidad de lectura</label>
          <select id="calidad-lectura" className={CAMPO} value={valor.renderDpi} onChange={(e) => cambia({ renderDpi: Number(e.target.value) })}>
            <option value={200}>200 DPI (normal)</option>
            <option value={250}>250 DPI</option>
            <option value={300}>300 DPI (máxima)</option>
          </select>
          <p className="text-sm text-slate-700">Más alto lee mejor la letra pequeña, pero es más lento.</p>
        </div>

        {motor === 'textract' && (
          <div className="space-y-2">
            <label htmlFor="modo-textract" className="block font-semibold">Modo</label>
            <select id="modo-textract" className={CAMPO} value={valor.textractMode} onChange={(e) => cambia({ textractMode: e.target.value as Valor['textractMode'] })}>
              <option value="detect">Texto simple</option>
              <option value="analyze">Formularios y tablas (mejor con letra a mano)</option>
            </select>
          </div>
        )}
      </div>
    </details>
  )
}
