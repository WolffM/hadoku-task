/**
 * useToast hook
 * Manages toast notification state and display
 */

import { useState, useCallback } from 'react'

export interface ToastState {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration?: number
}

export interface UseToastReturn {
  toasts: ToastState[]
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning',
    duration?: number
  ) => void
  dismissToast: (id: number) => void
  clearAll: () => void
}

let toastIdCounter = 0

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<ToastState[]>([])

  const showToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'info' | 'warning' = 'info',
      duration: number = 3000
    ) => {
      const id = ++toastIdCounter
      setToasts(prev => [...prev, { id, message, type, duration }])
    },
    []
  )

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setToasts([])
  }, [])

  return {
    toasts,
    showToast,
    dismissToast,
    clearAll
  }
}
