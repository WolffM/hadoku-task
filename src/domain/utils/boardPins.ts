import type { Board } from '../types'

/**
 * How many boards the top bar holds. This is a display budget, NOT a cap on how
 * many boards a user can have — the server never limited board count. Boards
 * beyond the pinned few are reached through the Edit Boards picker.
 */
export const TOPBAR_BOARD_SLOTS = 5

/**
 * The board ids that are "favorited" (pinned to the top bar), in display order.
 *
 * The top bar can only hold a few boards, so it shows the favorited set. When a
 * viewer has favorited NOTHING yet, default to the first `slots` standard boards
 * rather than showing an empty (or all) bar. This default is what makes
 * favoriting feel sane: without it, the first favorite collapses the bar from
 * "all boards" to "just that one" (there were zero explicit pins, so the new set
 * is a single id). With it, favoriting is an additive toggle from a sensible
 * baseline — the first favorite lands on top of the default five.
 *
 * Automation boards live on their own row and never occupy a top-bar slot, so
 * they don't seed the default. Explicit favorites are honoured verbatim (an
 * explicitly-pinned board of any mode stays in the set).
 */
export function effectivePinnedIds(boards: Board[], slots: number): string[] {
  const explicit = boards.filter(b => b.pinned)
  if (explicit.length > 0) return explicit.map(b => b.id)
  return boards
    .filter(b => b.mode !== 'automation')
    .slice(0, slots)
    .map(b => b.id)
}

/**
 * Where a just-created board goes in the pinned set, or null to leave it unpinned.
 *
 * Without this a new board was never pinned, so for anyone with explicit
 * favorites it showed only while selected: switch away and it vanished from the
 * bar, and creating it again was refused as a duplicate. Now it joins the end of
 * the favorites when the bar has room. With NO explicit favorites the default
 * set (the first `slots` standard boards) already covers it while there's room,
 * and pinning just the new board would collapse the bar to that one, so it's
 * left alone. A full bar stays as the user arranged it.
 *
 * `existing` is the board list BEFORE the new board is added.
 */
export function pinPositionForNewBoard(existing: Board[], slots: number): number | null {
  const pinned = existing.filter(b => b.pinned)
  if (pinned.length === 0) return null
  const standardPinned = pinned.filter(b => b.mode !== 'automation').length
  if (standardPinned >= slots) return null
  return Math.max(...pinned.map(b => b.position ?? 0)) + 1
}
