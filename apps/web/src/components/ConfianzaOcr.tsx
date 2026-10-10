import type { NivelConfianza } from '../lib/api'
import { infoConfianza } from '../lib/confianza'

/** Indicador de qué tan segura fue la lectura del documento (icono + texto, no solo color). */
export default function ConfianzaOcr({ nivel, confianza }: { nivel: NivelConfianza; confianza: number | null }) {
  const c = infoConfianza(nivel, confianza)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${c.classes}`}>
      <c.icon className="size-4 shrink-0" aria-hidden />
      {c.label}
    </span>
  )
}
