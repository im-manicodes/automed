import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import type { AjustesAlmacenamiento, CambiosAlmacenamiento, PruebaAlmacenamientoResultado } from '../lib/api'

type Callbacks<T> = { onSuccess?: (data: T) => void; onError?: (message: string) => void }

export function useAjustesAlmacenamiento(cb: Callbacks<AjustesAlmacenamiento> & { enabled?: boolean } = {}) {
  return useQuery<AjustesAlmacenamiento>({ url: '/settings/storage', ...cb })
}

export function useGuardarAlmacenamiento(cb: Callbacks<AjustesAlmacenamiento> = {}) {
  return useMutation<AjustesAlmacenamiento, CambiosAlmacenamiento>({ url: '/settings/storage', method: 'PUT', ...cb })
}

export function usePruebaAlmacenamiento() {
  return useMutation<PruebaAlmacenamientoResultado, CambiosAlmacenamiento>({ url: '/settings/storage/test' })
}
