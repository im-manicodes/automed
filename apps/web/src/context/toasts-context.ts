import { createContext, useContext } from 'react'

export type ToastKind = 'ok' | 'error' | 'info'
export interface ToastCtx { toast: (text: string, kind?: ToastKind) => void }

export const ToastContext = createContext<ToastCtx>({ toast: () => {} })

export function useToast(): ToastCtx {
  return useContext(ToastContext)
}
