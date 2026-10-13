import { useState } from 'react'
import type { LlmTask, ProveedorIa } from '../../lib/api'
import Switch from '../Switch'
import { TAREAS, esVision, type InterruptorIa } from '../../lib/ia'

const OTRO = '__otro__'

interface Props {
  proveedor: ProveedorIa
  modelos: Record<LlmTask, string>
  sugeridos: { texto: string[]; vision: string[] }
  onChange: (tarea: LlmTask, modelo: string) => void
  /** Estado de los interruptores de las tareas que se pueden apagar (ausente = activadas). */
  activas?: Record<InterruptorIa, boolean>
  onActivar?: (interruptor: InterruptorIa, activa: boolean) => void
}

function Fila({ id, etiqueta, ayuda, valor, lista, recomendado, onChange, activa = true, onActivar }: { id: LlmTask; etiqueta: string; ayuda?: string; valor: string; lista: string[]; recomendado?: string; onChange: (m: string) => void; activa?: boolean; onActivar?: (a: boolean) => void }) {
  const [otroForzado, setOtroForzado] = useState(false)
  const esOtro = otroForzado || !lista.includes(valor)
  return (
    <div className={`space-y-2 ${activa ? '' : 'opacity-60'}`}>
      {onActivar && (
        <div className="rounded-xl border border-slate-200 bg-white px-3">
          <Switch label={`Usar: ${etiqueta}`} checked={activa} onChange={onActivar} />
        </div>
      )}
      {!activa && <p className="text-sm font-semibold text-slate-700">Desactivado</p>}
      <label htmlFor={`modelo-${id}`} className="block font-semibold">{etiqueta}</label>
      {ayuda && <p className="text-sm text-slate-600">{ayuda}</p>}
      <select
        id={`modelo-${id}`}
        disabled={!activa}
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
        {lista.map((m) => <option key={m} value={m}>{m === recomendado ? `${m} (recomendado)` : m}</option>)}
        <option value={OTRO}>Otro…</option>
      </select>
      {esOtro && (
        <input
          type="text"
          aria-label={`Nombre del modelo para ${etiqueta}`}
          disabled={!activa}
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

/** Una fila por tarea: modelos sugeridos del proveedor u "Otro" con nombre libre. */
export default function ModeloPorTarea({ proveedor, modelos, sugeridos, onChange, activas, onActivar }: Props) {
  return (
    <div className="space-y-4">
      {TAREAS.map((t) => (
        <Fila
          key={`${proveedor}-${t.id}`}
          id={t.id}
          etiqueta={t.etiqueta}
          ayuda={t.ayuda}
          valor={modelos[t.id]}
          lista={esVision(t.id) ? sugeridos.vision : sugeridos.texto}
          recomendado={proveedor === 'ollama' ? (esVision(t.id) ? sugeridos.vision : sugeridos.texto)[0] : undefined}
          onChange={(m) => onChange(t.id, m)}
          activa={t.interruptor ? (activas?.[t.interruptor] ?? true) : true}
          onActivar={t.interruptor && onActivar ? (a) => onActivar(t.interruptor!, a) : undefined}
        />
      ))}
    </div>
  )
}
