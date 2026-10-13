/** Tipos y utilidades de los formatos PDF (GET /forms, POST /threads/:id/form-draft). */

export type TipoCampo = 'texto' | 'texto_largo' | 'fecha' | 'casilla' | 'opcion'

export interface CampoFormato {
  clave: string
  etiqueta: string
  seccion: string
  tipo: TipoCampo
  opciones?: { valor: string; etiqueta: string }[]
  maxLen?: number
  soloManual?: boolean
}

export interface Formato {
  id: string
  titulo: string
  campos: CampoFormato[]
}

export type ValorCampo = string | boolean | null
export type ValoresFormato = Record<string, ValorCampo>

export interface BorradorFormato {
  formato: string
  valores: ValoresFormato
  faltantes: string[]
  errores: string[]
  guardado?: boolean
  desactualizado?: boolean
  camposEditados?: string[]
}

export interface BorradorGuardado {
  existe: boolean
  valores: ValoresFormato
  desactualizado: boolean
  actualizadoEn: string | null
  camposEditados: string[]
}

/** ¿El campo tiene un valor útil? (una casilla sin marcar es una respuesta válida: no cuenta como falta). */
export function estaLleno(c: CampoFormato, v: ValorCampo | undefined): boolean {
  if (c.tipo === 'casilla') return true
  return typeof v === 'string' && v.trim() !== ''
}

/** Campos que la IA debería llenar y siguen vacíos. */
export function contarSinLlenar(f: Formato, valores: ValoresFormato): number {
  return f.campos.filter((c) => !c.soloManual && !estaLleno(c, valores[c.clave])).length
}

/** Secciones en orden de aparición. */
export function agruparPorSeccion(campos: CampoFormato[]): { seccion: string; campos: CampoFormato[] }[] {
  const out: { seccion: string; campos: CampoFormato[] }[] = []
  for (const c of campos) {
    let g = out.find((x) => x.seccion === c.seccion)
    if (!g) out.push((g = { seccion: c.seccion, campos: [] }))
    g.campos.push(c)
  }
  return out
}

/** Valores listos para enviar: texto vacío -> null. */
export function paraEnviar(valores: ValoresFormato): ValoresFormato {
  return Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]))
}

/** En ingreso-pemex sexo y triage comparten el grupo de opciones del PDF: si se eligen ambos se pierde el triage. */
export function conflictoSexoTriage(formatoId: string, valores: ValoresFormato): boolean {
  if (formatoId !== 'ingreso-pemex') return false
  const lleno = (k: string) => typeof valores[k] === 'string' && valores[k] !== ''
  return lleno('sexo') && lleno('triage')
}
