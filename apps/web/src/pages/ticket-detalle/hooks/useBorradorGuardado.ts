import { useQuery } from '../../../hooks/useQuery'
import type { BorradorGuardado } from '../lib/formatos'

/** Borrador guardado de un formato (GET forms/:formato/draft, sin IA). Solo se pide si hay `formato`. */
export function useBorradorGuardado(
  threadId: string,
  formato: string | null,
  opciones: { onSuccess?: (d: BorradorGuardado) => void; onError?: (m: string) => void } = {},
) {
  return useQuery<BorradorGuardado>({
    url: `/threads/${encodeURIComponent(threadId)}/forms/${encodeURIComponent(formato ?? '_')}/draft`,
    enabled: formato !== null,
    ...opciones,
  })
}
