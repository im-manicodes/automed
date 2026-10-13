import type { ClaveOcrPrecio, PeriodoUso } from '../../../lib/api'

export const PERIODOS: { valor: PeriodoUso; etiqueta: string }[] = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: '7d', etiqueta: '7 días' },
  { valor: '30d', etiqueta: '30 días' },
  { valor: 'mes', etiqueta: 'Este mes' },
]

const ACTIVIDADES: Record<string, string> = {
  resumen: 'Resumen del ticket',
  whatsapp: 'Mensaje de WhatsApp',
  evento: 'Evento',
  reporte: 'Reporte de Excel',
  vision: 'Lectura de zonas dudosas (pasada 1)',
  vision_respaldo: 'Segundo intento de zonas dudosas',
  vision_sugerencias: 'Sugerencias en la revisión',
  ocr: 'OCR de pago (por página)',
}

export const etiquetaActividad = (task: string): string => ACTIVIDADES[task] ?? task

export const CLAVES_OCR: { clave: ClaveOcrPrecio; etiqueta: string }[] = [
  { clave: 'textract-detect', etiqueta: 'Amazon Textract (lectura de texto)' },
  { clave: 'textract-analyze', etiqueta: 'Amazon Textract (análisis)' },
  { clave: 'azure-read', etiqueta: 'Azure Document Intelligence' },
]

export const formatoTokens = (n: number): string => n.toLocaleString('es')

export function formatoCosto(n: number): string {
  return n.toLocaleString('es', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 })
}

/** Texto del campo -> número >= 0, o null si está vacío o es inválido. */
export function leerPrecio(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const textoPrecio = (n: number | undefined): string => (n === undefined ? '' : String(n))

/** Los motores de OCR se precian por página: nunca son modelos de LLM. */
export const esClaveOcr = (nombre: string): boolean => CLAVES_OCR.some(({ clave }) => clave === nombre)

/** Nombres de modelos LLM para el editor (sin motores OCR, sin vacíos ni duplicados). */
export const soloModelosLlm = (...listas: (readonly string[] | undefined)[]): string[] =>
  [...new Set(listas.flatMap((l) => l ?? []).map((m) => m.trim()).filter((m) => m !== '' && !esClaveOcr(m)))]
