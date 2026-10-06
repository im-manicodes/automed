import { useMutation } from './useMutation'
import { useQuery } from './useQuery'
import type { MailStatus, SyncResult } from '../lib/api'

/** Estado de la conexión con Outlook (GET /mail/status). `refetch()` vuelve a consultarlo. */
export function useMailStatus(options: { enabled?: boolean } = {}) {
  return useQuery<MailStatus>({ url: '/mail/status', enabled: options.enabled })
}

/** Sincroniza el correo ahora (POST /mail/sync). `mutate()` devuelve el SyncResult y relanza el ApiError. */
export function useSyncMail() {
  return useMutation<SyncResult>({ url: '/mail/sync' })
}

/** Pide la dirección de Microsoft para conectar Outlook (POST /mail/connect). */
export function useConnectOutlook() {
  return useMutation<{ url: string }>({ url: '/mail/connect' })
}
