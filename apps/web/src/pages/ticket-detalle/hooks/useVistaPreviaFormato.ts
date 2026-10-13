import { useMutation } from '../../../hooks/useMutation'
import type { ValoresFormato } from '../lib/formatos'

/** Páginas del formato ya llenado como imágenes de referencia (POST forms/:formato/preview). */
export function useVistaPreviaFormato(threadId: string) {
  const { mutate, loading } = useMutation<{ paginas: string[] }, { valores: ValoresFormato }>({ url: `/threads/${encodeURIComponent(threadId)}/forms` })
  return {
    pedir: async (formato: string, valores: ValoresFormato) => (await mutate({ urlParams: `/${encodeURIComponent(formato)}/preview`, body_params: { valores } })).paginas,
    cargando: loading,
  }
}
