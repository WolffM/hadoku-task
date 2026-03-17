/**
 * Client-Side Logging Utility for UI Components
 *
 * Provides structured logging with admin-only visibility
 * Logs are shown in development mode or when user is authenticated as admin
 */

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'

interface LogContext {
  [key: string]: unknown
}

class Logger {
  private static instance: Logger
  private isAdmin: boolean = false
  private prefix: string = '[UI]'
  private isDevelopment: boolean

  private constructor() {
    // Check if running in development
    this.isDevelopment =
      typeof window !== 'undefined'
        ? window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        : false

    // Try to restore admin status from storage
    this.checkAdminStatus()
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  /**
   * Check if current user has admin status in localStorage
   */
  private checkAdminStatus() {
    if (typeof window === 'undefined') return
    this.isAdmin = localStorage.getItem('isAdmin') === 'true'
  }

  /**
   * Set admin status (should be called after authentication)
   * Persists to localStorage
   */
  setAdminStatus(isAdmin: boolean) {
    this.isAdmin = isAdmin
    if (typeof window !== 'undefined') {
      localStorage.setItem('isAdmin', isAdmin ? 'true' : 'false')
      if (isAdmin) {
        console.log(`${this.prefix} Admin mode enabled - all logs visible`)
      }
    }
  }

  /**
   * Check if logging is enabled (development or admin)
   */
  private shouldLog(): boolean {
    return this.isDevelopment || this.isAdmin
  }

  /**
   * Format log message with timestamp and context
   */
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    return `${this.prefix} [${timestamp}] [${level}] ${message}${contextStr}`
  }

  /**
   * Log error message (always shown)
   */
  error(message: string, context?: LogContext) {
    const formatted = this.formatMessage('ERROR', message, context)
    console.error(formatted)
  }

  /**
   * Log warning message (development or admin only)
   */
  warn(message: string, context?: LogContext) {
    if (!this.shouldLog()) return
    const formatted = this.formatMessage('WARN', message, context)
    console.warn(formatted)
  }

  /**
   * Log info message (development or admin only)
   */
  info(message: string, context?: LogContext) {
    if (!this.shouldLog()) return
    const formatted = this.formatMessage('INFO', message, context)
    console.log(formatted)
  }

  /**
   * Log debug message (development or admin only)
   */
  debug(message: string, context?: LogContext) {
    if (!this.shouldLog()) return
    const formatted = this.formatMessage('DEBUG', message, context)
    console.log(formatted)
  }

  /**
   * Log component lifecycle event (development or admin only)
   */
  component(event: 'mount' | 'unmount' | 'update', componentName: string, context?: LogContext) {
    if (!this.shouldLog()) return
    this.debug(`Component ${componentName} ${event}`, context)
  }

  /**
   * Log theme change (development or admin only)
   */
  theme(theme: string, context?: LogContext) {
    if (!this.shouldLog()) return
    this.info(`Theme changed: ${theme}`, context)
  }

  /**
   * Log preference change (development or admin only)
   */
  preference(key: string, value: unknown) {
    if (!this.shouldLog()) return
    this.info(`Preference changed: ${key}`, { value })
  }

  /**
   * Log API request (development or admin only)
   */
  apiRequest(method: string, path: string, context?: LogContext) {
    if (!this.shouldLog()) return
    this.info(`API ${method} ${path}`, context)
  }

  /**
   * Log API response (development or admin only, errors always shown)
   */
  apiResponse(method: string, path: string, status: number, context?: LogContext) {
    if (status >= 400) {
      this.error(`API ${method} ${path} failed with ${status}`, context)
    } else if (this.shouldLog()) {
      this.info(`API ${method} ${path} → ${status}`, context)
    }
  }

  /**
   * Log fallback/retry (development or admin only)
   */
  fallback(message: string, context?: LogContext) {
    if (!this.shouldLog()) return
    this.warn(`FALLBACK: ${message}`, context)
  }
}

// Export singleton instance
export const logger = Logger.getInstance()
