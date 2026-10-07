import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import type {
  AjustesIa,
  CambiosAjustesIa,
  DescargaOllama,
  HardwareIa,
  PruebaIaBorrador,
  PruebaIaResultado,
} from '../lib/api'

type Callbacks<T> = { onSuccess?: (data: T) => void; onError?: (message: string) => void }

export function useAjustesIa(cb: Callbacks<AjustesIa> = {}) {
  return useQuery<AjustesIa>({ url: '/settings/ia', ...cb })
}

export function useGuardarAjustesIa(cb: Callbacks<AjustesIa> = {}) {
  return useMutation<AjustesIa, CambiosAjustesIa>({ url: '/settings/ia', method: 'PUT', ...cb })
}

export function usePruebaIa() {
  return useMutation<PruebaIaResultado, PruebaIaBorrador>({ url: '/settings/ia/test' })
}

export function useHardware() {
  return useQuery<HardwareIa>({ url: '/settings/ia/hardware' })
}

export function useIniciarDescargaModelo() {
  return useMutation<{ modelo: string; estado: string }, { modelo: string }>({ url: '/settings/ia/ollama/pull' })
}

/** Progreso de la descarga de un modelo; solo consulta cuando `enabled`. */
export function useProgresoDescarga(modelo: string, enabled: boolean, cb: Callbacks<DescargaOllama> = {}) {
  return useQuery<DescargaOllama>({
    url: `/settings/ia/ollama/pull?modelo=${encodeURIComponent(modelo)}`,
    enabled,
    ...cb,
  })
}
