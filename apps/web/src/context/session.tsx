import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, setUnauthorizedHandler } from '../lib/api'
import { SessionContext as Ctx, type SessionState } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setUnauthorizedHandler(() => setSession({ status: 'anonymous' }))
    authApi
      .me()
      .then((r) => {
        if (!alive) return
        setSession(r.authenticated ? { status: 'authenticated', email: r.email ?? '' } : { status: 'anonymous' })
      })
      .catch((e: unknown) => {
        if (alive) setSession({ status: 'anonymous', error: e instanceof Error ? e.message : undefined })
      })
    return () => {
      alive = false
      setUnauthorizedHandler(null)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setSession({ status: 'anonymous' })
    }
  }, [])

  const value = useMemo(() => ({ session, logout }), [session, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
