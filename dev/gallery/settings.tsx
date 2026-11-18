/**
 * A host that opts in to the Content tab (`contentVisibility`), as conjure
 * does. The task app does not — it makes no content determination —
 * so e2e/settings-prefetch.spec.ts drives the Content tab here and asserts its
 * absence on the task app.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { HadokuThemeRoot } from '@wolffm/themes'
import { AppHeader } from '@wolffm/task-ui-components'
import '@wolffm/themes/style.css'
import '@wolffm/themes/icons.css'
import '../../src/styles/style.css'
import './gallery.css'

function Host() {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <HadokuThemeRoot containerRef={containerRef}>
      <div className="task-app-container" ref={containerRef}>
        <AppHeader title="Settings host" settingsProps={{ contentVisibility: true }} />
      </div>
    </HadokuThemeRoot>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('settings host: #root is missing from settings.html')

createRoot(rootEl).render(
  <React.StrictMode>
    <Host />
  </React.StrictMode>
)
