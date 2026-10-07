import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import type { NuevoPrimerUsuario, SetupStatus, User } from '../lib/api'

/** ¿Hay que crear el primer usuario? (no requiere sesión) */
export function useSetupStatus() {
  return useQuery<SetupStatus>({ url: '/auth/setup-status' })
}

export function useCrearPrimerUsuario() {
  return useMutation<{ user: User }, NuevoPrimerUsuario>({ url: '/auth/setup' })
}
