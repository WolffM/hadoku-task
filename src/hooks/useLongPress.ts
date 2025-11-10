/**
 * Hook for handling long-press gestures on touch devices
 */

import { useRef } from 'react'

interface UseLongPressOptions {
  onLongPress: (x: number, y: number) => void
  delay?: number
}

/**
 * Returns touch event handlers for long-press detection
 * @param options Configuration with onLongPress callback and optional delay
 * @returns Object with onTouchStart, onTouchEnd, and onTouchMove handlers
 */
export function useLongPress({ onLongPress, delay = 500 }: UseLongPressOptions) {
  const timerRef = useRef<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    timerRef.current = window.setTimeout(() => {
      onLongPress(touch.clientX, touch.clientY)
    }, delay)
  }

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handleTouchMove = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove
  }
}
