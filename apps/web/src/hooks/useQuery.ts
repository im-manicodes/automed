import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiBlob } from '../lib/api'

interface UseQueryOptions<T> {
  /** Ruta sin el prefijo /api, p.ej. '/threads'. */
  url: string
  onSuccess?: (data: T) => void
  onError?: (message: string) => void
  enabled?: boolean
  responseType?: 'json' | 'blob'
}

/**
 * GET con estado (data, loading, error). No relanza errores: los deja en `error` y llama `onError`.
 * Decisión: `loading` solo es true mientras no hay datos de ESA url (carga inicial o url nueva);
 * una recarga con datos ya cargados (refetch/polling) no lo enciende, para que la UI no parpadee.
 */
export function useQuery<T>({ url, onSuccess, onError, enabled = true, responseType }: UseQueryOptions<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  // Callbacks en refs: cambiar su identidad no dispara otra petición.
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  const mountedRef = useRef(false)
  const requestRef = useRef(0) // id de la última petición; las anteriores se ignoran
  const dataUrlRef = useRef<string | null>(null) // url que produjo `data`
  const prevFetchRef = useRef<unknown>(null) // evita el doble disparo (StrictMode)

  const fetchData = useCallback(
    async (overrideUrl?: string, forceRefetch = false): Promise<T | null> => {
      if (!enabled && !forceRefetch) return null
      const targetUrl = overrideUrl ?? url
      const id = ++requestRef.current
      const vigente = () => mountedRef.current && id === requestRef.current
      if (dataUrlRef.current !== targetUrl) setLoading(true)
      setError(null)
      try {
        const result = (responseType === 'blob' ? await apiBlob(targetUrl) : await api<T>(targetUrl)) as T
        if (!vigente()) return null
        dataUrlRef.current = targetUrl
        setData(result)
        onSuccessRef.current?.(result)
        return result
      } catch (e) {
        if (!vigente()) return null
        const message = e instanceof Error ? e.message : 'No se pudo completar la acción.'
        setError(message)
        onErrorRef.current?.(message)
        return null
      } finally {
        if (vigente()) setLoading(false)
      }
    },
    [url, enabled, responseType],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (prevFetchRef.current === fetchData) return
    prevFetchRef.current = fetchData
    // Es sincronizar con un sistema externo (la red): el setState de fetchData es intencional.
    // oxlint-disable-next-line react/set-state-in-effect
    if (enabled) void fetchData()
  }, [fetchData, enabled])

  const refetch = useCallback((overrideUrl?: string) => fetchData(overrideUrl, true), [fetchData])

  return { data, loading, error, refetch }
}
