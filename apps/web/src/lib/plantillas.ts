import type { TemplateKind } from './api'

export interface PlantillaTipo {
  id: TemplateKind
  /** Texto de la pestaña. */
  etiqueta: string
  titulo: string
  ayuda: string
  max: number
  /** Si exige al menos un título de sección (## Título). */
  exigeTitulos: boolean
  textoVistaPrevia: string
  vistaPreviaComoMarkdown: boolean
}

export const TIPOS_PLANTILLA: PlantillaTipo[] = [
  {
    id: 'resumen',
    etiqueta: 'Resumen del ticket',
    titulo: 'Plantilla del resumen',
    ayuda:
      'Aquí decides cómo se escribe el resumen de cada ticket. Cada título (## Título) es una sección; lo que va entre <!-- --> son instrucciones para la inteligencia artificial.',
    max: 20000,
    exigeTitulos: true,
    textoVistaPrevia: 'Muestra cómo quedaría con un ticket de ejemplo.',
    vistaPreviaComoMarkdown: true,
  },
  {
    id: 'whatsapp',
    etiqueta: 'Mensaje de WhatsApp',
    titulo: 'Formato del mensaje de WhatsApp',
    ayuda:
      'Aquí decides cómo se ve el mensaje de WhatsApp que se escribe con el último correo de un ticket: estructura, estilo y largo. Lo que va entre <!-- --> son instrucciones para la inteligencia artificial.',
    max: 3000,
    exigeTitulos: false,
    textoVistaPrevia: 'Muestra cómo quedaría con un correo de ejemplo.',
    vistaPreviaComoMarkdown: false,
  },
]

export function tipoPlantilla(id: string | null): PlantillaTipo {
  return TIPOS_PLANTILLA.find((t) => t.id === id) ?? TIPOS_PLANTILLA[0]
}
