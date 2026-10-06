import type { EventoEstado } from '../../../lib/api'

export const MAX_VALOR = 2000
export const MAX_NOVEDAD = 1000

export const ESTADOS: { value: EventoEstado; label: string }[] = [
  { value: 'hospitalizado', label: 'Hospitalizado' },
  { value: 'alta', label: 'Alta' },
  { value: 'otro', label: 'Otro' },
]

export const ESTADO_CLASES: Record<EventoEstado, string> = {
  hospitalizado: 'bg-blue-50 text-blue-900 border-blue-300',
  alta: 'bg-green-50 text-green-900 border-green-300',
  otro: 'bg-slate-100 text-slate-800 border-slate-300',
}

export function estadoLabel(e: string): string {
  return ESTADOS.find((o) => o.value === e)?.label ?? e
}
