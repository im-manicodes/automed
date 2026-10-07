import { useOutletContext } from 'react-router-dom'

export interface BienvenidaCtx {
  /** Avisa a la guarda de que el asistente ya terminó (evita volver a redirigir). */
  marcarCompletada: () => void
}

/** Disponible dentro de GuardaBienvenida; fuera de ella devuelve undefined. */
export function useBienvenidaCtx(): BienvenidaCtx | undefined {
  return useOutletContext<BienvenidaCtx | undefined>()
}
