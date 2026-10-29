import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void
}

export const ToastContext = createContext<ToastContextValue>({ push: () => {} })

export const useToast = () => useContext(ToastContext)
