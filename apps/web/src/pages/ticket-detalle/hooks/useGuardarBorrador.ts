import { useMutation } from '../../../hooks/useMutation'
import type { ValoresFormato } from '../lib/formatos'

/** Guarda las ediciones del borrador (PUT forms/:formato/draft). */
export function useGuardarBorrador(threadId: string) {
  const { mutate } = useMutation<unknown, { valores: ValoresFormato }>({ url: `/threads/${encodeURIComponent(threadId)}/forms`, method: 'PUT' })
  return { guardar: (formato: string, valores: ValoresFormato) => mutate({ urlParams: `/${encodeURIComponent(formato)}/draft`, body_params: { valores } }) }
}
