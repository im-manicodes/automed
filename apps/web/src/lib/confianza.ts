import type { IconType } from 'react-icons'
import { LuCheck, LuFileText, LuTriangleAlert, LuCircleAlert } from 'react-icons/lu'
import type { NivelConfianza } from './api'

export interface InfoConfianza {
  label: string
  icon: IconType
  /** clases Tailwind: fondo + texto + borde (contraste AA) */
  classes: string
}

const INFO: Record<NivelConfianza, Omit<InfoConfianza, 'label'>> = {
  digital: { icon: LuFileText, classes: 'bg-slate-100 text-slate-800 border-slate-300' },
  alta: { icon: LuCheck, classes: 'bg-green-50 text-green-900 border-green-300' },
  media: { icon: LuCircleAlert, classes: 'bg-amber-50 text-amber-900 border-amber-400' },
  baja: { icon: LuTriangleAlert, classes: 'bg-red-50 text-red-900 border-red-300' },
}

/** Texto sencillo del indicador: «Lectura clara (92 %)», «Texto digital»… */
export function infoConfianza(nivel: NivelConfianza, confianza: number | null): InfoConfianza {
  const pct = confianza === null ? '' : ` (${Math.round(confianza * 100)} %)`
  const base = { digital: 'Texto digital', alta: 'Lectura clara', media: 'Lectura regular', baja: 'Lectura dudosa' }[nivel]
  return { ...INFO[nivel], label: nivel === 'digital' ? base : `${base}${pct}` }
}
