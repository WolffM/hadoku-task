/**
 * The verify dialog's signal (J5 of hadoku_site
 * docs/planning/account-journeys-2026-11-18.md): one window event, raised two
 * ways, heard by the header.
 *
 *   - an app calls `requestVerification({ reason })` before an action it knows
 *     needs a verified account;
 *   - any same-origin fetch on the page answers `403 MEMBER_NOT_VERIFIED`.
 *     ConnectedSettings installs the fetch hook at mount, so an app adds no
 *     code for this half: whatever client it fetches through, the refusal is
 *     seen.
 *
 * An event on `window` rather than a module-level callback because an app can
 * carry its own copy of this package beside the site's: every copy's hook and
 * every copy's `requestVerification` reach whichever header is mounted, and the
 * first header to hear an event marks it handled so only one dialog opens.
 *
 * Whether it opens at all is the header's call: only for a guest.
 */
import { wrapFetchForVerify } from './accountPrompts'

export const VERIFY_EVENT = 'hadoku:verify-needed'

export interface VerifyEventDetail {
  /** What the person was doing, e.g. "Saving decks"; titles the dialog. */
  reason?: string
  /** `app`: requestVerification(). `fetch`: a refused request. */
  source: 'app' | 'fetch'
  /** Set by the first header that takes it. */
  handled?: boolean
}

function raise(detail: VerifyEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new window.CustomEvent<VerifyEventDetail>(VERIFY_EVENT, { detail }))
}

/**
 * Ask the header to offer verification, before an action that needs it.
 * Does nothing for anyone but a guest, so an app may call it unconditionally.
 */
export function requestVerification(opts: { reason?: string } = {}): void {
  raise({ reason: opts.reason, source: 'app' })
}

/** One wrapper per page, whichever copy of this package installs it first. */
const HOOK_FLAG = '__hadokuVerifyFetchHook'

export function installVerifyFetchHook(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const w = window as unknown as Record<string, unknown>
  if (w[HOOK_FLAG]) return
  w[HOOK_FLAG] = true
  const sameOrigin = (url: string) => {
    try {
      return new URL(url, window.location.href).origin === window.location.origin
    } catch {
      // Not a URL this page could have fetched from itself.
      return false
    }
  }
  window.fetch = wrapFetchForVerify(
    window.fetch.bind(window),
    () => raise({ source: 'fetch' }),
    sameOrigin
  )
}

/**
 * Listen for the signal. `handler` runs once per event, for the first
 * listener on the page; returns the unsubscribe.
 */
export function onVerifyNeeded(handler: (detail: VerifyEventDetail) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as Event & { detail?: VerifyEventDetail }).detail
    if (!detail || detail.handled) return
    detail.handled = true
    handler(detail)
  }
  window.addEventListener(VERIFY_EVENT, listener)
  return () => window.removeEventListener(VERIFY_EVENT, listener)
}

/**
 * A refused request may repeat on its own (a retry, a poll), and a person who
 * said Not now must not have the dialog back for it. So after any close, a
 * refusal opens it again only once they have touched the page since: their
 * next action is a new attempt. `requestVerification()` is always an attempt.
 */
let fetchOpensArmed = true

export function fetchOpensDialog(): boolean {
  return fetchOpensArmed
}

export function holdFetchOpensUntilInteraction(): void {
  if (!fetchOpensArmed || typeof document === 'undefined') return
  fetchOpensArmed = false
  const rearm = () => {
    fetchOpensArmed = true
    document.removeEventListener('pointerdown', rearm, true)
    document.removeEventListener('keydown', rearm, true)
  }
  document.addEventListener('pointerdown', rearm, true)
  document.addEventListener('keydown', rearm, true)
}
