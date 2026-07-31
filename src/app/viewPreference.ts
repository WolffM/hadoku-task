/**
 * Persistence for the board/calendar view choice.
 *
 * The view used to reset to 'board' on every reload, which made a scheduled task
 * effectively undiscoverable: a calendar user landed on the board, had no signal
 * that anything was scheduled, and had to re-open the calendar every single time.
 *
 * This is a DEVICE preference, not a user one — it rides in localStorage rather
 * than the synced preferences file, so it neither waits on the prefs handshake
 * (the view is picked during the first render, before prefs land) nor follows a
 * person onto a screen where they'd want the other view.
 */

import type { ViewType } from './types'

const VIEW_KEY = 'task-app-view'

function isViewType(value: string | null): value is ViewType {
  return value === 'board' || value === 'calendar'
}

/** The last view this device was left on. Defaults to the board. */
export function loadViewPreference(): ViewType {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY)
    return isViewType(stored) ? stored : 'board'
  } catch {
    // Private-mode / disabled storage: the board default is still correct.
    return 'board'
  }
}

/** Remember the view. Storage failures are not worth interrupting a view switch. */
export function saveViewPreference(view: ViewType): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view)
  } catch {
    // See loadViewPreference — non-fatal, the app just won't restore the view.
  }
}
