import type { IconType } from 'react-icons'
import type { ProcessStatus } from './api'
import { LuCircle, LuHourglass, LuCheck, LuHand, LuTriangleAlert } from 'react-icons/lu'

export interface StatusInfo {
  label: string
  icon: IconType
  /** clases Tailwind: fondo + texto + borde (contraste AA) */
  classes: string
  /** el ticket está en marcha (la lista se refresca sola) */
  busy: boolean
}

export const STATUS_INFO: Record<ProcessStatus, StatusInfo> = {
  sin_analizar: { label: 'Sin analizar', icon: LuCircle, classes: 'bg-slate-100 text-slate-800 border-slate-300', busy: false },
  pendiente: { label: 'Analizando…', icon: LuHourglass, classes: 'bg-blue-50 text-blue-900 border-blue-300', busy: true },
  procesando: { label: 'Analizando…', icon: LuHourglass, classes: 'bg-blue-50 text-blue-900 border-blue-300', busy: true },
  listo: { label: 'Listo', icon: LuCheck, classes: 'bg-green-50 text-green-900 border-green-300', busy: false },
  necesita_revision: { label: 'Necesita tu ayuda', icon: LuHand, classes: 'bg-amber-50 text-amber-900 border-amber-400', busy: false },
  error: { label: 'Error', icon: LuTriangleAlert, classes: 'bg-red-50 text-red-900 border-red-300', busy: false },
}

export function statusLabel(s: ProcessStatus): string {
  return STATUS_INFO[s]?.label ?? s
}

export function isBusy(s: ProcessStatus): boolean {
  return STATUS_INFO[s]?.busy ?? false
}

/** Filtros de la lista (chips). `undefined` = todos. */
export const FILTERS: { value: ProcessStatus | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'sin_analizar', label: 'Sin analizar' },
  { value: 'procesando', label: 'Analizando' },
  { value: 'listo', label: 'Listos' },
  { value: 'necesita_revision', label: 'Necesitan tu ayuda' },
  { value: 'error', label: 'Con error' },
]

/** Un ticket se puede analizar si no analizado, con error, o con mensajes nuevos. */
export function canAnalyze(t: { status: ProcessStatus; tieneMensajesNuevos: boolean }): boolean {
  return (
    t.status === 'sin_analizar' ||
    t.status === 'error' ||
    ((t.status === 'listo' || t.status === 'necesita_revision') && t.tieneMensajesNuevos)
  )
}
