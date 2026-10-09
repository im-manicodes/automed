import { useMutation } from './useMutation'
import { useQuery } from './useQuery'
import type { AjustesMicrosoft, CambiosAjustesMicrosoft } from '../lib/api'

/** Configuración de la app de Microsoft (GET /settings/microsoft). El secreto nunca llega. */
export function useConfigMicrosoft() {
  return useQuery<AjustesMicrosoft>({ url: '/settings/microsoft' })
}

/** Guarda cambios parciales (PUT /settings/microsoft). */
export function useGuardarConfigMicrosoft() {
  return useMutation<AjustesMicrosoft, CambiosAjustesMicrosoft>({ url: '/settings/microsoft', method: 'PUT' })
}
