/**
 * Automation boards (§5.4, §5.5): the provider lane contracts, the destructive
 * activate/deactivate migration, the repo link, and the actionable scan.
 */
import type {
  ActionableScan,
  AutomationPreset,
  PresetSourceStatus,
  PresetUpdate
} from '../domain/types'
import { adminHeaders, type ApiCtx } from './client-context'

export function automationMethods(ctx: ApiCtx) {
  const { userType, sessionId } = ctx
  return {
    /**
     * The lane contracts our providers publish (§5.4). The worker fetches them
     * from the provider and validates them, so this is a plain read: the picker
     * offers a live schema instead of asking a human to paste one.
     */
    async listAutomationPresets(): Promise<{
      presets: AutomationPreset[]
      sources: PresetSourceStatus[]
    }> {
      try {
        const res = await fetch('/task/api/automation/presets', {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return { presets: [], sources: [] }
        return (await res.json()) as { presets: AutomationPreset[]; sources: PresetSourceStatus[] }
      } catch {
        return { presets: [], sources: [] }
      }
    },

    /**
     * What this board's repo has open that the pipeline could take on (§5.6).
     * The worker asks TenHands with its own service key; we just read the list.
     *
     * Called on every board load, so a failure has to be quiet and legible:
     * `ok:false` + a reason, never a throw the board load has to survive. The
     * caller shows nothing on `ok:false` — an outage must not render as "there
     * is nothing left to automate".
     */
    async listActionable(boardRef: string): Promise<ActionableScan> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/actionable`, {
          headers: adminHeaders(userType, sessionId)
        })
        // 403 (read-only) and 404 (no such board) are answers, not faults — the
        // reason carries the status so a support question has something to go on.
        if (!res.ok) return { ok: false, repo: null, items: [], reason: `http_${res.status}` }
        return (await res.json()) as ActionableScan
      } catch {
        return { ok: false, repo: null, items: [], reason: 'network' }
      }
    },

    /**
     * Whether this board's lane set is behind the contract it was activated from
     * (§5.5). The worker computes it from its cached copy of the provider's
     * contract, so this is a plain read of the hydrated board. Null when the
     * board is current — or when the worker's preset cache is cold, which
     * resolves itself on the next read.
     */
    async getPresetUpdate(boardRef: string): Promise<PresetUpdate | null> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return null
        const data = (await res.json()) as { board?: { presetUpdate?: PresetUpdate } }
        return data.board?.presetUpdate ?? null
      } catch {
        return null
      }
    },

    /**
     * Activate (or preview) automation on a board (owner only, §5.4). Pass
     * `dryRun: true` for a preview + digest; echo that digest to commit. Returns
     * the raw result (preview/applied) or an error.
     */
    async activateAutomation(
      boardRef: string,
      payload: {
        lanes: unknown
        schemaId?: string | null
        schemaVersion?: number | null
        repo?: string | null
        dryRun?: boolean
        digest?: string
      }
    ): Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/activate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId),
            body: JSON.stringify(payload)
          }
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        if (!res.ok)
          return { ok: false, error: data.error ?? `Error ${res.status}`, code: data.code }
        return { ok: true, result: data }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Deactivate automation, restoring the standard tag list (owner only). */
    async deactivateAutomation(boardRef: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/deactivate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId)
          }
        )
        if (!res.ok) return { ok: false, error: `Error ${res.status}` }
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Persist a board's repo (owner only). Auto-called on successful validation. */
    async setRepo(boardRef: string, repo: string): Promise<{ ok: boolean; repo?: string | null }> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/repo`, {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ repo })
        })
        if (!res.ok) return { ok: false }
        return (await res.json()) as { ok: boolean; repo?: string | null }
      } catch {
        return { ok: false }
      }
    },

    /** Validate a repo (owner/name) by probing GitHub through the worker. */
    async validateRepo(repo: string): Promise<{
      repo: string
      valid: boolean
      reason: string
      private?: boolean
      defaultBranch?: string
      message?: string
    }> {
      try {
        const res = await fetch(`/task/api/repos/validate?repo=${encodeURIComponent(repo)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return { repo, valid: false, reason: 'error', message: `Error ${res.status}` }
        return (await res.json()) as {
          repo: string
          valid: boolean
          reason: string
          private?: boolean
          defaultBranch?: string
          message?: string
        }
      } catch {
        return { repo, valid: false, reason: 'error', message: 'Network error' }
      }
    }
  }
}
