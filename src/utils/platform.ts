/**
 * Platform detection utilities
 * Functions for detecting the runtime environment
 */

export function isMobileApp(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any

  return (
    window.parent !== window ||
    !!win.Capacitor ||
    !!win.cordova ||
    /HadokuTaskApp\//.test(window.navigator.userAgent || '')
  )
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    (typeof window.navigator !== 'undefined' && window.navigator.maxTouchPoints > 0)
  )
}
