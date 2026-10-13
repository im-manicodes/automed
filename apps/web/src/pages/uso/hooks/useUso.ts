import { useQuery } from '../../../hooks/useQuery'
import { useMutation } from '../../../hooks/useMutation'
import type { CambiosPrecios, PeriodoUso, Precios, RespuestaPronostico, RespuestaUso } from '../../../lib/api'

export function useUso(periodo: PeriodoUso) {
  return useQuery<RespuestaUso>({ url: `/settings/uso?periodo=${periodo}` })
}

export function usePronostico(dias = 7) {
  return useQuery<RespuestaPronostico>({ url: `/settings/uso/pronostico?dias=${dias}` })
}

export function usePrecios() {
  return useQuery<Precios>({ url: '/settings/precios' })
}

export function useGuardarPrecios() {
  return useMutation<Precios, CambiosPrecios>({ url: '/settings/precios', method: 'PUT' })
}
