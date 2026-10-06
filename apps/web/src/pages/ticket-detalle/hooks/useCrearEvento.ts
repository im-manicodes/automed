import { useMutation } from '../../../hooks/useMutation'
import type { Evento, EventoNuevo } from '../../../lib/api'

/** Guarda un evento en la bitácora del ticket (POST /threads/:id/events). */
export function useCrearEvento(threadId: string) {
  const { mutate, loading } = useMutation<Evento, EventoNuevo>({ url: `/threads/${encodeURIComponent(threadId)}/events` })
  return { crear: (evento: EventoNuevo) => mutate({ body_params: evento }), saving: loading }
}
