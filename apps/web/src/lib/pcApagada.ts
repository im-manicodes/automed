import { useSyncExternalStore } from 'react'

// Estado global «Tu computadora está apagada» (el relay responde con code 'pc_apagada').
// api() lo marca; <AvisoPcApagado /> lo muestra. Solo guarda un booleano, sin datos.
export const CODIGO_PC_APAGADA = 'pc_apagada'
export const MENSAJE_PC_APAGADA = 'Tu computadora está apagada o sin internet. Enciéndela y abre auto-med.'

let apagada = false
const oyentes = new Set<() => void>()

function cambiar(v: boolean) {
  if (apagada === v) return
  apagada = v
  oyentes.forEach((f) => f())
}

export const marcarPcApagada = () => cambiar(true)
export const limpiarPcApagada = () => cambiar(false)
export const estaPcApagada = () => apagada

export function usePcApagada(): boolean {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => oyentes.delete(f)
    },
    () => apagada,
    () => false,
  )
}

/** Recarga la app (separado para poder simularlo en pruebas). */
export const recargarApp = () => window.location.reload()
