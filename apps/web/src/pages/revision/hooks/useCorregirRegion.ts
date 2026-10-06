import { useMutation } from '../../../hooks/useMutation';

/** Guarda la corrección de una región. `mutate({ urlParams: '/<id>', body_params: { textoUsuario } })`. */
export function useCorregirRegion() {
  return useMutation<{ id: string; status: string; textoUsuario: string }, { textoUsuario: string }>({
    url: '/ocr/regions',
    method: 'PATCH',
  });
}
