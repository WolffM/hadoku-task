import { useRef, useEffect } from 'react'

interface UseLongPressOptions {
  onLongPress: (e: React.TouchEvent) => void
  delay?: number
}

export function useLongPress({ onLongPress, delay = 500 }: UseLongPressOptions) {
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const start = (e: React.TouchEvent) => {
    timerRef.current = setTimeout(() => {
      onLongPress(e)
    }, delay)
  }

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    // Cleanup on unmount
    return cancel
  }, [])

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel
  }
}
