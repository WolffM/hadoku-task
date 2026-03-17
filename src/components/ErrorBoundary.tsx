/**
 * Error Boundary Component
 * Catches React errors and displays fallback UI
 */

import React, { Component, type ReactNode } from 'react'
import { logger } from '@wolffm/task-ui-components'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('[ErrorBoundary] Caught error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--color-text-primary, #333)'
          }}
        >
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--color-text-secondary, #666)' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              background: 'var(--color-primary, #3b82f6)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
