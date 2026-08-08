import { useEffect, useRef, useState } from 'react'

interface UsePullToRefreshOpts {
  enabled: boolean
  onRefresh: () => Promise<void>
  threshold?: number
}

interface UsePullToRefreshReturn {
  pullDistance: number
  isRefreshing: boolean
  threshold: number
}

export function usePullToRefresh({
  enabled,
  onRefresh,
  threshold = 70
}: UsePullToRefreshOpts): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const startYRef = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    const setDistance = (d: number) => {
      distanceRef.current = d
      setPullDistance(d)
    }

    const handleStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      if (e.touches.length !== 1) return
      // Never arm underneath a modal. The ancestor walk below only bails once an
      // inner container has ALREADY scrolled, so at the top of a dialog — a plan
      // in the notes popout, say — this used to arm anyway: `handleMove` then
      // preventDefault()s the downward drag, and releasing past the threshold
      // refreshes the board the user cannot even see. Pulling inside a dialog is
      // never a request to reload what is behind it.
      const target = e.target as Element | null
      if (target?.closest('[aria-modal="true"]')) return
      // Bail if the document OR any ancestor of the touch target has scrolled.
      // Without the ancestor walk, scrolled inner containers (modals, columns,
      // the body when html is height-locked) would still engage pull-to-refresh.
      if ((window.scrollY || 0) > 0) return
      let node: Element | null = target
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.scrollTop > 0) return
        node = node.parentElement
      }
      if ((document.body?.scrollTop || 0) > 0) return
      if ((document.documentElement?.scrollTop || 0) > 0) return
      startYRef.current = e.touches[0].clientY
    }

    const handleMove = (e: TouchEvent) => {
      if (startYRef.current === null) return
      if (refreshingRef.current) return
      const dy = e.touches[0].clientY - startYRef.current
      if (dy <= 0) {
        setDistance(0)
        return
      }
      // Damped — pull feels heavier as it stretches
      const damped = Math.min(dy * 0.5, threshold * 1.6)
      setDistance(damped)
      // Stop the document from rubber-banding once we've clearly committed to a pull
      if (dy > 5 && e.cancelable) e.preventDefault()
    }

    const handleEnd = async () => {
      if (startYRef.current === null) return
      startYRef.current = null
      const distance = distanceRef.current
      if (distance >= threshold) {
        refreshingRef.current = true
        setIsRefreshing(true)
        setDistance(threshold)
        try {
          await onRefreshRef.current()
        } finally {
          refreshingRef.current = false
          setIsRefreshing(false)
          setDistance(0)
        }
      } else {
        setDistance(0)
      }
    }

    window.addEventListener('touchstart', handleStart, { passive: true })
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleEnd)
    window.addEventListener('touchcancel', handleEnd)

    return () => {
      window.removeEventListener('touchstart', handleStart)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [enabled, threshold])

  return { pullDistance, isRefreshing, threshold }
}
