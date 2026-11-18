/**
 * The keep-your-account banner's page state and its 7-day snooze.
 *
 * The snooze is the person's, not the tab's: it lives on the shared
 * 'portfolio' prefs row (`keepAccountSnoozedUntil`, user scope), the row the
 * theme has already read at boot, so knowing it costs no request. Read through
 * a subscription taken as this module evaluates, as settingsTab.ts in
 * @wolffm/themes does, never through `themePrefs.read()`, which would kick a
 * GET of its own. Only when the prefs save is refused does the snooze fall back
 * to this browser's localStorage.
 *
 * "Once per page" is module state: the first click anywhere, and a banner
 * already dismissed, hold for the life of the page whatever remounts.
 */
import { themePrefs } from '@wolffm/themes'
import { keepAccountSnoozeUntil } from './accountPrompts'

const LOCAL_SNOOZE_KEY = 'hadoku:keep-account-snoozed-until'

let prefsSnooze = 0
let clickedThisPage = false
let dismissedThisPage = false
let watching = false
const listeners = new Set<() => void>()

export interface KeepAccountPageState {
  /** The first click anywhere on the page has happened. */
  clicked: boolean
  /** Dismissed on this page (Later, or a passkey saved): it does not come back. */
  dismissed: boolean
  /** Epoch ms the snooze runs to; 0 when never snoozed. */
  snoozedUntil: number
}

let state: KeepAccountPageState = { clicked: false, dismissed: false, snoozedUntil: 0 }

function notify() {
  const next = {
    clicked: clickedThisPage,
    dismissed: dismissedThisPage,
    snoozedUntil: snoozedUntil()
  }
  // The prefs row also changes with the theme; only a change here re-renders.
  if (
    next.clicked === state.clicked &&
    next.dismissed === state.dismissed &&
    next.snoozedUntil === state.snoozedUntil
  )
    return
  state = next
  for (const l of listeners) l()
}

/** For useSyncExternalStore: a new object only when something changed. */
export function keepAccountState(): KeepAccountPageState {
  return state
}

themePrefs.subscribe(next => {
  prefsSnooze = next.keepAccountSnoozedUntil ?? 0
  notify()
})
// A snooze kept in this browser when prefs refused it.
notify()

function localSnooze(): number {
  try {
    return Number(window.localStorage.getItem(LOCAL_SNOOZE_KEY)) || 0
  } catch (err) {
    console.error('[keepAccount] snooze unreadable', (err as Error)?.message ?? err)
    return 0
  }
}

function snoozedUntil(): number {
  return Math.max(prefsSnooze, typeof window === 'undefined' ? 0 : localSnooze())
}

export function subscribeKeepAccount(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Later: a week without the banner, wherever this person signs in. */
export async function snoozeKeepAccount(now = Date.now()): Promise<void> {
  const until = keepAccountSnoozeUntil(now)
  dismissedThisPage = true
  notify()
  try {
    await themePrefs.save({ keepAccountSnoozedUntil: until }, { scope: 'user' })
  } catch (err) {
    console.error('[keepAccount] prefs refused the snooze', (err as Error)?.message ?? err)
    try {
      window.localStorage.setItem(LOCAL_SNOOZE_KEY, String(until))
    } catch (storeErr) {
      console.error('[keepAccount] snooze not kept', (storeErr as Error)?.message ?? storeErr)
    }
    notify()
  }
}

export function dismissKeepAccount(): void {
  dismissedThisPage = true
  notify()
}

/** Start listening for the first click; idempotent. */
export function watchFirstClick(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener(
    'click',
    () => {
      clickedThisPage = true
      notify()
    },
    { capture: true, once: true }
  )
}
