import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiBlob } from '../lib/api'

interface UseMutationOptions<T> {
  /** Ruta base sin el prefijo /api, p.ej. '/threads'. */
  url: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
  responseType?: 'json' | 'blob'
  onSuccess?: (data: T) => void
  onError?: (message: string) => void
}

export interface MutateParams<V> {
  body_params?: V
  query_params?: Record<string, string | number | boolean | null | undefined>
  /** Se concatena tal cual a `url`, p.ej. '/abc/analyze'. */
  urlParams?: string
}

/** Petición con efecto (POST por defecto). `mutate` devuelve los datos y RELANZA el error tras guardarlo y llamar `onError`. */
export function useMutation<T, V = unknown>({
  url,
  method = 'POST',
  responseType,
  onSuccess,
  onError,
}: UseMutationOptions<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const mutate = useCallback(
    async ({ body_params, query_params, urlParams = '' }: MutateParams<V> = {}): Promise<T> => {
      let targetUrl = url + urlParams
      if (query_params) {
        const qs = new URLSearchParams()
        for (const [k, v] of Object.entries(query_params)) {
          if (v !== undefined && v !== null) qs.append(k, String(v))
        }
        const s = qs.toString()
        if (s) targetUrl += (targetUrl.includes('?') ? '&' : '?') + s
      }
      setLoading(true)
      setError(null)
      try {
        const opts = { method, body: body_params }
        const result = (
          responseType === 'blob' ? await apiBlob(targetUrl, opts) : await api<T>(targetUrl, opts)
        ) as T
        if (mountedRef.current) setData(result)
        onSuccessRef.current?.(result)
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : 'No se pudo completar la acción.'
        if (mountedRef.current) setError(message)
        onErrorRef.current?.(message)
        throw e
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [url, method, responseType],
  )

  return { data, loading, error, mutate }
}
