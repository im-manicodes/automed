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
