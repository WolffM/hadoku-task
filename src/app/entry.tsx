import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import App from './App'
import type { PlatformSeed } from '@wolffm/themes'
import { ErrorBoundary } from '../components/ErrorBoundary'
import '@wolffm/themes/style.css'
// Sizing + accent-tile rules for <Icon>. Unlayered, like style.css — see the
// import rule in THEME_USAGE_GUIDE.md.
import '@wolffm/themes/icons.css'
import '../styles/style.css'
import { logger } from '@wolffm/logger/client'
import { installDevLogSink } from '../utils/devLogSink'
import { getStoredSessionId, getStoredUserType, getAnonSessionId } from '../api/session'
import { isMobileApp } from '../utils/platform'
import type { UserType } from '../domain/types'

// Capacitor 7 draws the WebView edge-to-edge; without viewport-fit=cover the page
// has no way to read env(safe-area-inset-*). Patch the viewport meta in-place so
// hadoku-site doesn't need to know about the mobile wrapper.
function ensureSafeAreaViewport() {
  if (typeof document === 'undefined') return
  if (!isMobileApp()) return
  let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'viewport'
    document.head.appendChild(meta)
  }
  const current = meta.content || ''
  if (/viewport-fit\s*=\s*cover/.test(current)) return
  const next = current.length
    ? `${current.replace(/,\s*viewport-fit\s*=\s*[^,]+/g, '')}, viewport-fit=cover`
    : 'width=device-width, initial-scale=1.0, viewport-fit=cover'
  meta.content = next
}

// Task App Entry Point
// Service Worker disabled - parent app handles GitHub integration

// Re-export types for parent app
export type { ThemeName } from './types'

// Props interface for configuration from hadoku-site
export interface TaskAppProps {
  /**
   * The app's DISPLAY NAME, resolved by the platform from hadoku_site's
   * spec/categories.json — the same file that titles the browser tab and the
   * homepage tile. Render this; never hard-code the name in this repo.
   *
   * Absent when the app runs standalone (its own vite dev server, no host),
   * which is what `__HADOKU_APP_NAME__` covers — see vite.config.ts.
   */
  appName?: string
  basename?: string
  /** Caller tier, as the host resolved it from /session/whoami. */
  userType?: UserType
  /**
   * The registry userId from whoami — the identity the edge stamps as
   * X-User-Id. Accepted and deliberately unused: the worker reads identity off
   * the edge header, so the app never needs to send or key anything by it.
   */
  userId?: string | null
  sessionId?: string
  theme?: string // Theme to apply (overrides user preferences)
  /**
   * Device context resolved once by the host at mount. A SEED for first paint,
   * not the live value — read it through `usePlatform({ propsPlatform })`,
   * which owns every update after mount so a rotation is never lost. Absent
   * when there is no host (the Capacitor shell, the standalone dev server),
   * and that is fine: usePlatform detects for itself.
   *
   * Not to be confused with `isMobileApp()` in utils/platform.ts, which asks
   * whether we are inside the native shell — a question the host genuinely
   * cannot answer, and which stays local.
   */
  platform?: PlatformSeed
}

// Extend HTMLElement to include __root property
interface TaskElement extends HTMLElement {
  __root?: Root
}

export function mount(el: HTMLElement, props: TaskAppProps = {}) {
  installDevLogSink()
  ensureSafeAreaViewport()

  // userType and sessionId come from the host. hadoku_site's mf-loader resolves
  // them from /session/whoami (the edge owns identity) and both passes them as
  // props and stores them under hadoku_user_type / hadoku_session_id; the stored
  // copy wins so a mount that passes only registry defaults still sees the
  // signed-in tier. Never read a tier from the URL — the dev harness
  // (index.html) does that itself, and it is not part of the shipped bundle.
  const storedSessionId = getStoredSessionId()
  const storedUserType = getStoredUserType()

  const userType = storedUserType || props.userType || 'public'

  // Authed users' sessionId comes from the host (via hadoku_session_id / props).
  // Public users get the stable, host-independent anon id so their local tasks
  // survive reloads (the host wipes hadoku_session_id for public every boot).
  const sessionId =
    userType === 'public'
      ? getAnonSessionId()
      : storedSessionId || props.sessionId || 'public-session'

  const finalProps = { ...props, userType, sessionId }
  // The host page (Astro) may have rendered a static skeleton into #root to
  // paint at first paint. Clear it before createRoot so React doesn't render
  // alongside the static markup. (createRoot on a non-empty container appends
  // rather than replaces.)
  //
  // flushSync forces React's first commit to land in the SAME task as the
  // replaceChildren() clear, so the browser never paints the empty container
  // between the static skeleton being removed and React's (DOM-identical)
  // LoadingSkeleton appearing. Without it, createRoot().render() commits
  // asynchronously a frame+ later, leaving a visible blank flash between the
  // two skeletons — pronounced on cold/mobile loads where the gap widens.
  el.replaceChildren()
  const root = createRoot(el)
  flushSync(() => {
    root.render(
      <ErrorBoundary>
        <App {...finalProps} />
      </ErrorBoundary>
    )
  })
  ;(el as TaskElement).__root = root
  logger.info('[task-app] Mounted successfully', finalProps)
}
export function unmount(el: HTMLElement) {
  ;(el as TaskElement).__root?.unmount()
}
