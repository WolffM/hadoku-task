/**
 * Platform detection utilities
 * Functions for detecting the runtime environment
 */

/**
 * Check if running inside a mobile app wrapper (Capacitor/Cordova/iframe)
 * This is different from screen size detection - it detects if we're inside a native app
 * @returns true if inside a mobile app wrapper
 */
export function isMobileApp(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any

  return (
    window.parent !== window || // Inside iframe/webview
    !!win.Capacitor || // Capacitor framework
    !!win.cordova // Cordova framework
  )
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return import.meta.env.DEV
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return import.meta.env.PROD
}
