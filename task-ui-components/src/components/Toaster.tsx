/**
 * Toaster Container Component
 * Manages and displays multiple toast notifications
 */

import React from 'react'
import { Toast } from './Toast'
import '../toaster.css'

export interface ToastState {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration?: number
}

export interface ToasterProps {
  toasts: ToastState[]
  onDismiss: (id: number) => void
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
}

export function Toaster({ toasts, onDismiss, position = 'bottom-center' }: ToasterProps) {
  return (
    <div className={`toast-container toast-container--${position}`}>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  )
}
