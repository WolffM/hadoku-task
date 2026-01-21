import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '../components/ErrorBoundary'
import '@wolffm/themes/style.css'
import '../styles/style.css'
import { logger } from '@wolffm/task-ui-components'
import { getStoredSessionId, getStoredUserType } from '../api/session'
import type { UserType } from '../domain/types'

// Task App Entry Point
// Service Worker disabled - parent app handles GitHub integration

// Re-export types for parent app
export type { ThemeName } from './types'

// Props interface for configuration from hadoku-site
export interface TaskAppProps {
  basename?: string
  userType?: UserType
  sessionId?: string
  displayName?: string // Display name for welcome message
  theme?: string // Theme to apply (overrides user preferences)
  onKeyValidation?: (isValid: boolean, userType?: UserType, displayName?: string) => void // Callback when key is validated
}

// Extend HTMLElement to include __root property
interface TaskElement extends HTMLElement {
  __root?: Root
}

export function mount(el: HTMLElement, props: TaskAppProps = {}) {
  // Priority for userType and sessionId:
  // 1. Props passed to mount() (for embedding scenarios)
  // 2. localStorage (for session-based auth after key validation)
  // 3. URL query parameters (fallback)
  // 4. Default values
  const urlParams = new URLSearchParams(window.location.search)
  const storedSessionId = getStoredSessionId()
  const storedUserType = getStoredUserType()

  const userType =
    props.userType || storedUserType || (urlParams.get('userType') as UserType) || 'public'

  const sessionId = props.sessionId || storedSessionId || 'public-session'

  const finalProps = { ...props, userType, sessionId }
  const root = createRoot(el)
  root.render(
    <ErrorBoundary>
      <App {...finalProps} />
    </ErrorBoundary>
  )
  ;(el as TaskElement).__root = root
  logger.info('[task-app] Mounted successfully', finalProps)
}
export function unmount(el: HTMLElement) {
  ;(el as TaskElement).__root?.unmount()
}
