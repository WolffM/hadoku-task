import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

// Service Worker disabled - parent app handles GitHub integration

// Props interface for configuration from hadoku-site
export interface TaskAppProps {
  basename?: string;
  apiUrl?: string;
  environment?: string;
  userType?: 'public' | 'friend' | 'admin';
  userId?: string;
  sessionId?: string;
}

export function mount(el: HTMLElement, props: TaskAppProps = {}) {
  // Extract userType from URL params if not provided in props
  const urlParams = new URLSearchParams(window.location.search)
  const userType = props.userType || (urlParams.get('userType') as ('public' | 'friend' | 'admin')) || 'public'
  const userId = props.userId || urlParams.get('userId') || 'public'
  const sessionId = props.sessionId // Session ID from parent (for authenticated requests)
  
  const finalProps = { ...props, userType, userId, sessionId }
  const root = createRoot(el)
  root.render(<App {...finalProps} />)
  ;(el as any).__root = root
  console.log('[task-app] Mounted successfully', finalProps)
}
export function unmount(el: HTMLElement) {
  ;(el as any).__root?.unmount()
}
