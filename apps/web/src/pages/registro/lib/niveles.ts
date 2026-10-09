import type { NivelRegistro } from '../../../lib/api'

export type FiltroNivel = 'todo' | 'warn' | 'error'

export const FILTROS_NIVEL: { valor: FiltroNivel; etiqueta: string }[] = [
  { valor: 'todo', etiqueta: 'Todo' },
  { valor: 'warn', etiqueta: 'Avisos y errores' },
  { valor: 'error', etiqueta: 'Solo errores' },
]

export const NOMBRE_NIVEL: Record<NivelRegistro, string> = {
  error: 'Error',
  warn: 'Aviso',
  log: 'Info',
  debug: 'Detalle',
  verbose: 'Detalle',
}

/** 'HH:MM:SS' local de una marca ISO. */
export function horaRegistro(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function nombreArchivoRegistro(ahora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `registro-api-${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}.txt`
}
