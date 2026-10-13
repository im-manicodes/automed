import { useQuery } from '../../../hooks/useQuery'
import type { Formato } from '../lib/formatos'

/** Catálogo de formatos PDF disponibles (GET /forms). Solo se pide cuando `enabled`. */
export function useFormatos(enabled = true) {
  return useQuery<Formato[]>({ url: '/forms', enabled })
}
