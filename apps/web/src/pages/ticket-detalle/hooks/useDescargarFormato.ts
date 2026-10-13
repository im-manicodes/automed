import { useMutation } from '../../../hooks/useMutation'
import { guardarArchivo } from '../../../lib/descarga'
import type { ValoresFormato } from '../lib/formatos'

/** Genera el PDF con los valores editados y lo guarda en el dispositivo. */
export function useDescargarFormato(threadId: string) {
  const { mutate, loading } = useMutation<Blob, { valores: ValoresFormato }>({
    url: `/threads/${encodeURIComponent(threadId)}/forms`,
    responseType: 'blob',
  })
  const descargar = async (formato: string, valores: ValoresFormato) => {
    const blob = await mutate({ urlParams: `/${encodeURIComponent(formato)}/pdf`, body_params: { valores } })
    guardarArchivo(blob, `${formato}.pdf`)
  }
  return { descargar, descargando: loading }
}
