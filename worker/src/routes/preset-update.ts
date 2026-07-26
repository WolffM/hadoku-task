/**
 * "Your provider has moved on" — detection only (§5.5).
 *
 * An automation board stores a snapshot of the lane contract it was activated
 * from. The provider keeps publishing; the board doesn't follow. Before this,
 * the only thing that noticed was a human re-running the activation handshake by
 * hand, which is exactly the drifting local copy the preset endpoint exists to
 * kill.
 *
 * This compares the two version numbers we already hold and says so. It writes
 * nothing and grants nothing: activation stays owner-only, and the owner still
 * drives the dryRun → digest → commit handshake. The only thing that changes is
 * that the panel knows there is something to offer.
 */

import { countStranded } from './board-automation'
import { peekPresets, presetsNeedRefresh, listPresets } from './board-presets'
import type { AutomationPreset } from './board-presets'

/** Advertised on a hydrated board when its lane set is behind the provider. */
export interface PresetUpdate {
  providerId: string
  providerLabel: string
  schemaId: string
  /** What the provider publishes now — the version to activate up to. */
  schemaVersion: number
  label: string
  description: string | null
  /**
   * Applying this would move no task. False means it is a real migration that
   * strands work in the Inbox, and the UI must show what lands where first.
   */
  safe: boolean
  /** Active tasks that would be cleared to the Inbox (0 when `safe`). */
  toInbox: number
}

export interface PresetUpdateInput {
  /** Only the owner can act on this, so only the owner is told about it. */
  access: string
  mode: string
  schemaId: string | null
  schemaVersion: number | null
  /** Active task tags, as already loaded to hydrate the response. */
  taskTags: Array<string | null | undefined>
}

/**
 * Pick the provider contract this board was activated from. Boards record the
 * `schemaId` but not which provider served it, so that is the only key we have —
 * and it is enough in practice, since a schema id names one pipeline. If two
 * providers ever publish the same id, the first configured source wins, matching
 * the order the picker lists them in.
 */
function matchPreset(presets: AutomationPreset[], schemaId: string): AutomationPreset | undefined {
  return presets.find(p => p.schemaId === schemaId)
}

/**
 * Compute the update flag from cached provider state. Never fetches — see
 * `peekPresets`; a cold isolate simply reports nothing this once.
 */
export function detectPresetUpdate(
  rawBinding: string | undefined,
  input: PresetUpdateInput
): PresetUpdate | null {
  if (input.access !== 'owner') return null
  if (input.mode !== 'automation' || !input.schemaId) return null

  const preset = matchPreset(peekPresets(rawBinding), input.schemaId)
  if (!preset || preset.schemaVersion === null) return null

  // A board activated from an unversioned contract reads as version 0, so a
  // provider that has since started versioning shows up as an update rather
  // than silently never matching.
  if (preset.schemaVersion <= (input.schemaVersion ?? 0)) return null

  const toInbox = countStranded(preset.lanes, input.taskTags)
  return {
    providerId: preset.providerId,
    providerLabel: preset.providerLabel,
    schemaId: preset.schemaId,
    schemaVersion: preset.schemaVersion,
    label: preset.label,
    description: preset.description,
    safe: toInbox === 0,
    toInbox
  }
}

/**
 * Refresh the preset cache outside the response path, so the read that found a
 * cold or stale cache doesn't pay for the fetch and the next one is accurate.
 * Skipped when every source is already fresh, so a board under active polling
 * doesn't queue a redundant warm per request.
 *
 * Takes the Hono context rather than a `waitUntil` function because
 * `c.executionCtx` is a THROWING GETTER, not a possibly-undefined property —
 * `c.executionCtx?.waitUntil(p)` reads as safe and is not, it raises "This
 * context has no ExecutionContext" wherever one isn't supplied (the dev stack,
 * and any direct `app.request()` caller). Owning that hazard here keeps it from
 * being re-introduced at the next call site.
 */
export function warmPresets(rawBinding: string | undefined, c: unknown): void {
  if (!presetsNeedRefresh(rawBinding)) return

  let waitUntil: ((p: Promise<unknown>) => void) | null = null
  try {
    const ctx = (c as { executionCtx?: ExecutionContextLike }).executionCtx
    if (ctx && typeof ctx.waitUntil === 'function') waitUntil = ctx.waitUntil.bind(ctx)
  } catch {
    // No ExecutionContext in this environment. Not an error: the read already
    // answered from cache, and refreshing is a nicety we simply skip.
    return
  }
  if (!waitUntil) return

  // listPresets never throws — an unreachable provider is a reported outcome.
  waitUntil(listPresets(rawBinding))
}

interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void
}
