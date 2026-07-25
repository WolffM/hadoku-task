import type { Board } from '../types'

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
