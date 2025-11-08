/**
 * Production-safe logging utility
 * Conditionally logs based on environment
 */

const isDevelopment = import.meta.env.DEV ?? process.env.NODE_ENV !== 'production'

export const logger = {
  /**
   * Log informational messages (only in development)
   */
  log(...args: any[]) {
    if (isDevelopment) {
      console.log(...args)
    }
  },

  /**
   * Log warnings (always logged)
   */
  warn(...args: any[]) {
    console.warn(...args)
  },

  /**
   * Log errors (always logged)
   */
  error(...args: any[]) {
    console.error(...args)
  },

  /**
   * Log debug information (only in development)
   */
  debug(...args: any[]) {
    if (isDevelopment) {
      console.debug(...args)
    }
  },

  /**
   * Log grouped information (only in development)
   */
  group(label: string, fn: () => void) {
    if (isDevelopment) {
      console.group(label)
      fn()
      console.groupEnd()
    }
  }
}
