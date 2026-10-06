import { useMutation } from '../../../hooks/useMutation'
import { useQuery } from '../../../hooks/useQuery'
import type { JobsStatus } from '../../../lib/api'

/** Conteo de tareas del pipeline (GET /jobs/status). */
export function useJobsStatus() {
  return useQuery<JobsStatus>({ url: '/jobs/status' })
}

/** Desconecta Outlook (DELETE /mail/connection). */
export function useDisconnectOutlook() {
  return useMutation<void>({ url: '/mail/connection', method: 'DELETE' })
}
