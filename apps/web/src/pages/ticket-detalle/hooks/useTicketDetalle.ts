import { useCallback } from 'react'
import { useQuery } from '../../../hooks/useQuery'
import type { Evento, SynthesisResponse, ThreadDetail } from '../../../lib/api'

const enc = encodeURIComponent

/** Hilo + síntesis + bitácora de eventos del ticket. Un fallo de «events» no tumba la pantalla. */
export function useTicketDetalle(id: string) {
  const base = `/threads/${enc(id)}`
  const thread = useQuery<ThreadDetail>({ url: base })
  const synth = useQuery<SynthesisResponse>({ url: `${base}/synthesis` })
  const events = useQuery<{ eventos: Evento[]; synthesisId: string | null }>({ url: `${base}/events` })

  const { refetch: refetchThread } = thread
  const { refetch: refetchSynth } = synth
  const { refetch: refetchEvents } = events

  /** Recarga las tres; no lanza (los errores quedan en `error` solo si aún no hay datos). */
  const refetch = useCallback(async () => {
    await Promise.all([refetchThread(), refetchSynth(), refetchEvents()])
  }, [refetchThread, refetchSynth, refetchEvents])

  // Un error al recargar (polling) con datos ya mostrados se ignora; solo cuenta si falta la carga inicial.
  const error = (!thread.data && thread.error) || (!synth.data && synth.error) || null

  return {
    thread: thread.data,
    synth: synth.data,
    eventos: events.data?.eventos ?? [],
    eventoSynthId: events.data?.synthesisId ?? null,
    error,
    refetch,
  }
}
