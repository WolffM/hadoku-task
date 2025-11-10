import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '../components/ErrorBoundary'
import '@wolffm/themes/themes.css'
import '../styles/index.css'
import { logger } from '@wolffm/task-ui-components'

// Service Worker disabled - parent app handles GitHub integration

// Props interface for configuration from hadoku-site
export interface TaskAppProps {
  basename?: string
  apiUrl?: string
  environment?: string
  userType?: 'public' | 'friend' | 'admin'
  sessionId?: string
  userName?: string // Display name for welcome message
  onKeyValidation?: (isValid: boolean, userType?: string, userName?: string) => void // Callback when key is validated
}

// Extend HTMLElement to include __root property
interface TaskElement extends HTMLElement {
  __root?: Root
}

export function mount(el: HTMLElement, props: TaskAppProps = {}) {
  // Extract userType from URL params if not provided in props
  const urlParams = new URLSearchParams(window.location.search)
  const userType =
    props.userType || (urlParams.get('userType') as 'public' | 'friend' | 'admin') || 'admin' // TEMPORARY: Testing as admin
  const sessionId = props.sessionId || 'public-session' // Session ID from parent (for authenticated requests)

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
