import { useEffect, useRef } from 'react'

/** Llama a `fn` cada `ms` mientras `active` sea true y la pestaña esté visible. */
export function usePolling(fn: () => void, ms: number, active: boolean) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current()
    }, ms)
    return () => clearInterval(id)
  }, [ms, active])
}
