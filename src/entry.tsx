import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

// Register Service Worker (client-side API)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./lib/sw.ts', import.meta.url), { type: 'module' })
}

// Props interface for configuration from hadoku-site
export interface TaskAppProps {
  basename?: string;
  apiUrl?: string;
  environment?: string;
  [key: string]: any;
}

export function mount(el: HTMLElement, props: TaskAppProps = {}) {
  const root = createRoot(el)
  root.render(<App {...props} />)
  ;(el as any).__root = root
  console.log('[task-app] Mounted successfully', props)
}
export function unmount(el: HTMLElement) {
  ;(el as any).__root?.unmount()
}
