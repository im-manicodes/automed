export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado.'
}

export function slugify(s: string): string {
  return (s || 'ticket').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'ticket'
}

/** 'YYYY-MM-DD' -> '6 oct 2026' (sin desfase de zona horaria). */
export function formatDia(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? '')
  if (!m) return ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'] as const

function escala(bytes: number, unidad: number): string {
  const v = bytes / 1024 ** unidad
  return v.toLocaleString('es', { maximumFractionDigits: unidad === 0 ? 0 : 1 })
}

function unidadDe(bytes: number): number {
  let u = 0
  while (u < UNIDADES.length - 1 && bytes >= 1024 ** (u + 1)) u++
  return u
}

/** 3_500_000_000 -> '3,3 GB'. */
export function formatoBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const u = unidadDe(b)
  return `${escala(b, u)} ${UNIDADES[u]}`
}

/** Avance de una descarga con unidad común: '1,2 de 3,3 GB · 36 %'. */
export function formatoAvance(completado: number, total: number): string {
  if (!(total > 0)) return ''
  const u = unidadDe(total)
  const pct = Math.min(100, Math.round((completado / total) * 100))
  return `${escala(Math.min(completado, total), u)} de ${escala(total, u)} ${UNIDADES[u]} · ${pct} %`
}
