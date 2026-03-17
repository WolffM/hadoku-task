/**
 * Toast Notification Component
 * Displays temporary notification messages with different types
 */

import React, { useEffect, useState } from 'react'

export interface ToastProps {
  message: string
  type?: 'success' | 'error' | 'info' | 'warning'
  duration?: number
  onClose: () => void
}

/**
 * Helper function to render SVG icon wrapper with consistent styling
 */
const renderIcon = (children: React.ReactNode) => (
  <svg
    className="toast__icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    {children}
  </svg>
)

export function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Fade in with slight delay for smoother appearance
    const showTimer = setTimeout(() => {
      setIsVisible(true)
    }, 50)

    // Auto-dismiss after duration
    const hideTimer = setTimeout(() => {
      setIsVisible(false)
      // Wait for fade-out animation before calling onClose
      setTimeout(onClose, 500)
    }, duration)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
    }
  }, [duration, onClose])

  const getIcon = () => {
    switch (type) {
      case 'success':
        return renderIcon(<path d="M20 6L9 17l-5-5" />)
      case 'error':
        return renderIcon(
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </>
        )
      case 'warning':
        return renderIcon(
          <>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        )
      case 'info':
      default:
        return renderIcon(
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </>
        )
    }
  }

  return (
    <div className={`toast toast--${type} ${isVisible ? 'toast--visible' : ''}`}>
      {getIcon()}
      <span className="toast__message">{message}</span>
    </div>
  )
}
