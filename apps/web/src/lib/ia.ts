import type { AjustesIa, CambiosAjustesIa, LlmTask, ProveedorIa } from './api'
import { awsIncompleta, cambiosAws, type ClavesAws } from './ocr'

export const TAREAS: { id: LlmTask; etiqueta: string; ayuda?: string }[] = [
  { id: 'resumen', etiqueta: 'Resúmenes de tickets' },
  { id: 'whatsapp', etiqueta: 'Mensaje de WhatsApp' },
  { id: 'evento', etiqueta: 'Borrador de evento' },
  { id: 'reporte', etiqueta: 'Reporte de Excel' },
  { id: 'vision', etiqueta: 'Lectura de zonas dudosas (visión)', ayuda: 'Una sola pasada: lee las zonas dudosas y deja 2 sugerencias para la revisión. Conviene un modelo fuerte' },
]

export const esVision = (id: LlmTask) => id === 'vision'

export const PROVEEDORES: { id: ProveedorIa; nombre: string; descripcion: string }[] = [
  { id: 'ollama', nombre: 'Ollama (en este equipo)', descripcion: 'Gratis y privado: la IA corre aquí, sin enviar datos a internet.' },
  { id: 'openai', nombre: 'OpenAI', descripcion: 'Necesita una clave de API de OpenAI.' },
  { id: 'anthropic', nombre: 'Anthropic (Claude)', descripcion: 'Necesita una clave de API de Anthropic.' },
  { id: 'bedrock', nombre: 'Amazon Bedrock', descripcion: 'Para empresas con cuenta de AWS.' },
  { id: 'foundry', nombre: 'Microsoft Foundry', descripcion: 'Modelos desplegados en tu cuenta de Azure.' },
]

export const nombreProveedor = (p: ProveedorIa) => PROVEEDORES.find((x) => x.id === p)?.nombre ?? p

/** Lo que el usuario va editando antes de guardar. */
export interface BorradorIa {
  proveedor: ProveedorIa
  modelos: Record<LlmTask, string>
  ollamaUrl: string
  awsRegion: string
  foundryEndpoint: string
  maxInputTokens: number
  maxOutputTokens: number
  /** undefined = sin cambios, string = clave nueva, null = quitar la guardada. */
  claveOpenai?: string | null
  claveAnthropic?: string | null
  claveFoundry?: string | null
  /** Claves de AWS (Bedrock y Textract comparten las mismas). */
  aws?: ClavesAws
}

export function borradorDesde(a: AjustesIa): BorradorIa {
  return {
    proveedor: a.proveedor,
    modelos: { ...a.modelos },
    ollamaUrl: a.ollamaUrl,
    awsRegion: a.awsRegion,
    foundryEndpoint: a.foundryEndpoint ?? '',
    maxInputTokens: a.maxInputTokens,
    maxOutputTokens: a.maxOutputTokens,
  }
}

/** Cambia de proveedor y preselecciona los modelos sugeridos (el primero de cada lista). */
export function conProveedor(b: BorradorIa, a: AjustesIa, proveedor: ProveedorIa): BorradorIa {
  if (proveedor === b.proveedor) return b
  const sug = a.sugeridos[proveedor]
  const modelos = { ...b.modelos }
  for (const t of TAREAS) {
    const lista = esVision(t.id) ? sug?.vision : sug?.texto
    if (lista?.[0]) modelos[t.id] = lista[0]
  }
  return { ...b, proveedor, modelos }
}

export function cambiosDesde(b: BorradorIa): CambiosAjustesIa {
  const c: CambiosAjustesIa = {
    proveedor: b.proveedor,
    modelos: b.modelos,
    ollamaUrl: b.ollamaUrl,
    awsRegion: b.awsRegion,
    foundryEndpoint: b.foundryEndpoint,
    maxInputTokens: b.maxInputTokens,
    maxOutputTokens: b.maxOutputTokens,
  }
  if (b.claveOpenai !== undefined) c.claveOpenai = b.claveOpenai
  if (b.claveAnthropic !== undefined) c.claveAnthropic = b.claveAnthropic
  if (b.claveFoundry !== undefined) c.claveFoundry = b.claveFoundry
  if (b.aws) Object.assign(c, cambiosAws(b.aws))
  return c
}

/** ¿Falta la clave del proveedor elegido? (ni guardada ni escrita) */
export function faltaClave(b: BorradorIa, a: AjustesIa): boolean {
  if (b.proveedor === 'bedrock' && b.aws && awsIncompleta(b.aws)) return true
  if (b.proveedor === 'foundry') {
    if (b.foundryEndpoint.trim() === '') return true
    if (b.claveFoundry === null) return true
    if (b.claveFoundry === undefined) return !a.claves.foundry
    return b.claveFoundry.trim() === ''
  }
  const clave = b.proveedor === 'openai' ? b.claveOpenai : b.proveedor === 'anthropic' ? b.claveAnthropic : 'no aplica'
  const guardada = b.proveedor === 'openai' ? a.claves.openai : b.proveedor === 'anthropic' ? a.claves.anthropic : true
  if (clave === 'no aplica') return false
  if (clave === null) return true // la quitará
  if (clave === undefined) return !guardada
  return clave.trim() === ''
}
