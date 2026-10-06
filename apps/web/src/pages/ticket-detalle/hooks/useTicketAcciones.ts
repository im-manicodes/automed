import { useMutation } from '../../../hooks/useMutation'
import type { EventoBorrador, ProcessStatus, RegenerateResponse } from '../../../lib/api'

const enc = encodeURIComponent

type Estado = { threadId: string; status: ProcessStatus }

/** Acciones sobre un ticket (cada una devuelve su `mutate`; los errores se relanzan como ApiError). */
export function useTicketAcciones(id: string) {
  const base = `/threads/${enc(id)}`
  const analyze = useMutation<Estado, Record<string, never>>({ url: `${base}/analyze` })
  const setSeguimiento = useMutation<{ id: string; seguimiento: boolean }, { seguimiento: boolean }>({
    url: `${base}/seguimiento`,
    method: 'PATCH',
  })
  const reprocess = useMutation<Estado>({ url: `${base}/reprocess` })
  const reanalyzeLast = useMutation<Estado & { mode: 'incremental'; messageId: string }>({ url: `${base}/reanalyze-last` })
  const regenerate = useMutation<RegenerateResponse>({ url: `${base}/synthesis/regenerate` })
  /** Mensaje de WhatsApp redactado por IA solo con el último correo (no guarda nada). */
  const whatsappLast = useMutation<{ texto: string }>({ url: `${base}/whatsapp-last` })
  /** Borrador del evento propuesto por IA con la síntesis vigente (no guarda nada). */
  const eventDraft = useMutation<EventoBorrador>({ url: `${base}/event-draft` })
  /** DELETE /events/:id con `urlParams: '/<id>'`. */
  const removeEvent = useMutation<void>({ url: '/events', method: 'DELETE' })

  return {
    analyze: () => analyze.mutate({ body_params: {} }),
    setSeguimiento: (seguimiento: boolean) => setSeguimiento.mutate({ body_params: { seguimiento } }),
    reprocess: () => reprocess.mutate(),
    reanalyzeLast: () => reanalyzeLast.mutate(),
    regenerate: () => regenerate.mutate(),
    whatsappLast: () => whatsappLast.mutate(),
    waLoading: whatsappLast.loading,
    eventDraft: () => eventDraft.mutate(),
    evLoading: eventDraft.loading,
    removeEvent: (eid: string) => removeEvent.mutate({ urlParams: `/${enc(eid)}` }),
  }
}
