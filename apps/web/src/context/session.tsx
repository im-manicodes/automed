import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '../hooks/useMutation'
import { setUnauthorizedHandler, type User } from '../lib/api'
import { SessionContext as Ctx, type SessionState } from './session-context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  // /auth/me, /auth/refresh, /auth/login y /auth/logout están en NO_REFRESH de api(): un 401 no dispara refresh.
  const { mutate: me } = useMutation<{ authenticated: boolean; user?: User }>({ url: '/auth/me', method: 'GET' })
  const { mutate: refresh } = useMutation<{ user: User }>({ url: '/auth/refresh' })
  const { mutate: loginReq } = useMutation<{ user: User }, { email: string; password: string }>({ url: '/auth/login' })
  const { mutate: logoutReq } = useMutation<void>({ url: '/auth/logout' })

  useEffect(() => {
    let alive = true
    setUnauthorizedHandler(() => setSession({ status: 'anonymous' }))
    me()
      .then(async (r) => {
        if (r.authenticated && r.user) return r.user
        // El access token dura 15 min: si caducó, /me responde "no autenticado"
        // aunque el refresh siga vigente, así que se intenta renovar antes de pedir login.
        try {
          return (await refresh()).user
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
  }, [me, refresh])

  const login = useCallback(async (email: string, password: string) => {
    const r = await loginReq({ body_params: { email, password } })
    setSession({ status: 'authenticated', user: r.user })
  }, [loginReq])

  const logout = useCallback(async () => {
    try {
      await logoutReq()
    } catch {
      // aunque falle la red, se cierra la sesión en pantalla
    } finally {
      setSession({ status: 'anonymous' })
    }
  }, [logoutReq])

  const aceptarSesion = useCallback((user: User) => setSession({ status: 'authenticated', user }), [])

  const value = useMemo(() => ({ session, login, logout, aceptarSesion }), [session, login, logout, aceptarSesion])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
