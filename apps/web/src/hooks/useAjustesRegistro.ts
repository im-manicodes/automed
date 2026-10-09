import { useCallback, useState } from 'react'
import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import { usePolling } from './usePolling'
import type { EntradaRegistro, NivelRegistro, RespuestaRegistro } from '../lib/api'

/** Líneas que se conservan en pantalla (igual que el buffer del servidor). */
export const MAX_LINEAS_REGISTRO = 2000
export const INTERVALO_REGISTRO_MS = 3000

export interface FiltroRegistro {
  /** Gravedad mínima ('warn' = avisos y errores); sin valor = todo. */
  nivel?: NivelRegistro
  q?: string
}

interface Estado {
  base: string
  lineas: EntradaRegistro[]
  ultimoId: number
}

const vacio = (base: string, ultimoId = 0): Estado => ({ base, lineas: [], ultimoId })

function urlBase({ nivel, q }: FiltroRegistro): string {
  const qs = new URLSearchParams({ limit: '500' })
  if (nivel) qs.set('nivel', nivel)
  if (q?.trim()) qs.set('q', q.trim())
  return `/settings/logs?${qs.toString()}`
}

/**
 * Registro de la API con polling incremental: la primera carga trae las últimas líneas del filtro
 * y luego cada ~3 s solo las nuevas (`desde=<ultimoId>`). `pausado` detiene el polling.
 */
export function useRegistroApi(filtro: FiltroRegistro, pausado: boolean) {
  const base = urlBase(filtro)
  const [estado, setEstado] = useState<Estado>(() => vacio(base))
  const actual = estado.base === base ? estado : vacio(base)

  const query = useQuery<RespuestaRegistro>({
    url: base,
    onSuccess: (d) =>
      setEstado((prev) => {
        const p = prev.base === base ? prev : vacio(base)
        // El servidor se reinició (ids desde 1): se empieza de nuevo.
        if (d.ultimoId < p.ultimoId) return { base, lineas: d.entries.slice(-MAX_LINEAS_REGISTRO), ultimoId: d.ultimoId }
        const ultima = p.lineas.at(-1)?.id ?? 0
        const nuevas = d.entries.filter((e) => e.id > ultima)
        if (nuevas.length === 0 && d.ultimoId === p.ultimoId && prev === p) return prev
        return { base, lineas: [...p.lineas, ...nuevas].slice(-MAX_LINEAS_REGISTRO), ultimoId: d.ultimoId }
      }),
  })
  const { refetch } = query

  usePolling(() => void refetch(`${base}&desde=${actual.ultimoId}`), INTERVALO_REGISTRO_MS, !pausado && !query.loading)

  /** Vacía la lista local (tras limpiar en el servidor); los ids siguen creciendo. */
  const vaciar = useCallback(() => setEstado((prev) => vacio(base, prev.ultimoId)), [base])

  return { lineas: actual.lineas, loading: query.loading, error: query.error, refetch: () => refetch(), vaciar }
}

export function useDescargarRegistro() {
  return useMutation<Blob>({ url: '/settings/logs/descargar', method: 'GET', responseType: 'blob' })
}

export function useLimpiarRegistro() {
  return useMutation<null>({ url: '/settings/logs', method: 'DELETE' })
}
