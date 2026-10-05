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
      .then(async (r) => {
        if (r.authenticated && r.user) return r.user
        // El access token dura 15 min: si caducó, /me responde "no autenticado"
        // aunque el refresh siga vigente, así que se intenta renovar antes de pedir login.
        try {
          return (await authApi.refresh()).user
        } catch {
          return null
        }
      })
      .then((user) => {
        if (!alive) return
        setSession(user ? { status: 'authenticated', user } : { status: 'anonymous' })
      })
      .catch((e: unknown) => {
        if (alive) setSession({ status: 'anonymous', error: e instanceof Error ? e.message : undefined })
      })
    return () => {
      alive = false
      setUnauthorizedHandler(null)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await authApi.login(email, password)
    setSession({ status: 'authenticated', user: r.user })
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // aunque falle la red, se cierra la sesión en pantalla
    } finally {
      setSession({ status: 'anonymous' })
    }
  }, [])

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
