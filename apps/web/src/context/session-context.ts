import { createContext, useContext } from 'react'
import type { User } from '../lib/api'

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; error?: string }
  | { status: 'authenticated'; user: User }

export interface SessionCtx {
  session: SessionState
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionCtx | null>(null)

export function useSession(): SessionCtx {
  const c = useContext(SessionContext)
  if (!c) throw new Error('useSession debe usarse dentro de SessionProvider')
  return c
}
