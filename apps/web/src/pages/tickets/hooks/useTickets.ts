import { useMutation } from '../../../hooks/useMutation'
import { useQuery } from '../../../hooks/useQuery'
import type { AnalyzeResult, ThreadListItem } from '../../../lib/api'

/** Lista de tickets (GET /threads). */
export function useTicketsList(onSuccess?: (list: ThreadListItem[]) => void) {
  return useQuery<ThreadListItem[]>({ url: '/threads', onSuccess })
}

/** Analiza varios hilos a la vez (POST /threads/analyze). */
export function useAnalizarVarios() {
  return useMutation<{ results: AnalyzeResult[] }, { ids: string[] }>({ url: '/threads/analyze' })
}
