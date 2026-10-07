import { useState } from 'react'
import type { LlmTask, ProveedorIa } from '../../lib/api'
import { TAREAS } from '../../lib/ia'

const OTRO = '__otro__'

interface Props {
  proveedor: ProveedorIa
  modelos: Record<LlmTask, string>
  sugeridos: { texto: string[]; vision: string[] }
  onChange: (tarea: LlmTask, modelo: string) => void
}

function Fila({ id, etiqueta, valor, lista, onChange }: { id: LlmTask; etiqueta: string; valor: string; lista: string[]; onChange: (m: string) => void }) {
  const [otroForzado, setOtroForzado] = useState(false)
  const esOtro = otroForzado || !lista.includes(valor)
  return (
    <div className="space-y-2">
      <label htmlFor={`modelo-${id}`} className="block font-semibold">{etiqueta}</label>
      <select
        id={`modelo-${id}`}
        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
        value={esOtro ? OTRO : valor}
        onChange={(e) => {
          if (e.target.value === OTRO) setOtroForzado(true)
          else {
            setOtroForzado(false)
            onChange(e.target.value)
          }
        }}
      >
        {lista.map((m) => <option key={m} value={m}>{m}</option>)}
        <option value={OTRO}>Otro…</option>
      </select>
      {esOtro && (
        <input
          type="text"
          aria-label={`Nombre del modelo para ${etiqueta}`}
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

/** Una fila por tarea: modelos sugeridos del proveedor u "Otro" con nombre libre. */
export default function ModeloPorTarea({ proveedor, modelos, sugeridos, onChange }: Props) {
  return (
    <div className="space-y-4">
      {TAREAS.map((t) => (
        <Fila
          key={`${proveedor}-${t.id}`}
          id={t.id}
          etiqueta={t.etiqueta}
          valor={modelos[t.id]}
          lista={t.id === 'vision' ? sugeridos.vision : sugeridos.texto}
          onChange={(m) => onChange(t.id, m)}
        />
      ))}
    </div>
  )
}
