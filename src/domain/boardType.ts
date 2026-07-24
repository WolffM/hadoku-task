/**
 * Board-type descriptor (§5.3).
 *
 * The board's layout/behaviour magic numbers, pulled out of the code into one
 * place so a board's `mode` selects them instead of scattered literals. Two
 * presets today:
 *
 *   - `standard`   — every board that exists now. Reproduces today's rendering
 *                    EXACTLY (the e2e suite is the proof), so its values match
 *                    the literals they replaced.
 *   - `automation` — the two-track vertical flow for provider-driven boards
 *                    (TenHands et al.). Lanes come in the provider's declared
 *                    order, nothing is capped, and untagged capture is the Inbox
 *                    at the TOP (an untriaged task is the start of the flow).
 *
 * The YOURS | AGENT column split and lane-edit enforcement (editableBy) land in
 * T6 with the lane model; T4 provides the layout descriptor + the two-track
 * layout primitive.
 */
export interface BoardTypeConfig {
  /** How lanes are arranged: today's adaptive grid, or the two-track vertical flow. */
  layout: 'adaptive-grid' | 'two-track-flow'
  /** Lane ordering: by task frequency (standard) or the board's declared tag order. */
  laneOrder: 'frequency' | 'declared'
  /** How many lanes to show. null = uncapped. */
  laneLimit: { mobile: number | null; desktop: number | null }
  /** Max tasks rendered per lane. null = uncapped. */
  maxPerSection: number | null
  /** Where untagged tasks render relative to the lanes. */
  untaggedPosition: 'top' | 'bottom'
  /** Heading for the untagged section. */
  untaggedLabel: string
  /** Whether the user can create/edit tags (lanes) on this board. */
  tagsEditable: boolean
}

/** Today's board. These values MUST match the literals they replaced. */
export const STANDARD_BOARD: BoardTypeConfig = {
  layout: 'adaptive-grid',
  laneOrder: 'frequency',
  laneLimit: { mobile: 3, desktop: 6 },
  maxPerSection: 10,
  untaggedPosition: 'bottom',
  untaggedLabel: 'Other Tasks',
  tagsEditable: true
}

/** Two-track vertical flow for automation boards (§5.3). */
export const AUTOMATION_BOARD: BoardTypeConfig = {
  layout: 'two-track-flow',
  laneOrder: 'declared',
  laneLimit: { mobile: null, desktop: null },
  maxPerSection: null,
  untaggedPosition: 'top',
  untaggedLabel: 'Inbox',
  tagsEditable: false
}

/**
 * Resolve the board-type config from a board's `mode`. Anything that isn't
 * explicitly 'automation' is a standard board — so pre-mode boards and the
 * default keep today's behaviour.
 */
export function boardTypeConfig(mode: string | null | undefined): BoardTypeConfig {
  return mode === 'automation' ? AUTOMATION_BOARD : STANDARD_BOARD
}
