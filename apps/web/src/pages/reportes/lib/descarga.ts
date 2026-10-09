/** 'YYYY-MM-DD' -> '6 oct 2026' (sin pasar por zonas horarias). */
export function formatFechaReporte(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return fecha
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatHora(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}
