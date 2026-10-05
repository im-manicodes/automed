import { createContext, useContext } from 'react'

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; error?: string }
  | { status: 'authenticated'; email: string }

export interface SessionCtx {
  session: SessionState
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionCtx | null>(null)

export function useSession(): SessionCtx {
  const c = useContext(SessionContext)
  if (!c) throw new Error('useSession debe usarse dentro de SessionProvider')
  return c
}
