/**
 * Platform detection utilities
 * Functions for detecting the runtime environment
 */

/** Globals injected by the native shells we ship inside; absent in a browser. */
interface NativeShellGlobals {
  Capacitor?: unknown
  cordova?: unknown
}

export function isMobileApp(): boolean {
  const win = window as typeof window & NativeShellGlobals

  return (
    window.parent !== window ||
    !!win.Capacitor ||
    !!win.cordova ||
    /HadokuTaskApp\//.test(window.navigator.userAgent || '')
  )
}
