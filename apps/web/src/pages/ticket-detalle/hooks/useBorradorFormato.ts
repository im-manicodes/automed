import { useMutation } from '../../../hooks/useMutation'
import type { BorradorFormato } from '../lib/formatos'

/**
 * Borrador de un formato (POST form-draft). Sin `actualizar` devuelve lo guardado (o, si no hay, una primera
 * propuesta de la IA); con `actualizar` vuelve a llamar a la IA y solo rellena lo que el usuario no editó.
 */
export function useBorradorFormato(threadId: string) {
  const { mutate, loading } = useMutation<BorradorFormato, { formato: string; actualizar?: boolean }>({ url: `/threads/${encodeURIComponent(threadId)}/form-draft` })
  return {
    pedir: (formato: string, actualizar = false) => mutate({ body_params: actualizar ? { formato, actualizar: true } : { formato } }),
    cargando: loading,
  }
}
