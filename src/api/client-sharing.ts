/**
 * Board sharing (§7). Server-only — none of these have a localStorage fallback,
 * because a share is not something a client can decide on its own.
 */
import { adminHeaders, type ApiCtx } from './client-context'

export function shareMethods(ctx: ApiCtx) {
  const { userType, sessionId } = ctx
  return {
    // --- Board sharing (§7). These are server-only (no localStorage mirror). ---

    /** Autocomplete: live display names matching `q` (safe to expose). */
    async searchUsers(q: string): Promise<Array<{ name: string; tier?: string }>> {
      if (!q.trim()) return []
      try {
        const res = await fetch(`/task/api/users/search?q=${encodeURIComponent(q)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as { users?: Array<{ name: string; tier?: string }> }
        return data.users ?? []
      } catch {
        return []
      }
    },

    /** List a board's grantees (owner only), annotated with display name + tier. */
    async listShares(boardRef: string): Promise<
      Array<{
        granteeUserId: string
        name?: string | null
        tier?: string | null
        level: string
        createdAt: string
      }>
    > {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as {
          shares?: Array<{
            granteeUserId: string
            name?: string | null
            tier?: string | null
            level: string
            createdAt: string
          }>
        }
        return data.shares ?? []
      } catch {
        return []
      }
    },

    /** Grant (or update) a share by display name. Returns the echo or an error. */
    async grantShare(
      boardRef: string,
      input: { name?: string; userId?: string; level: 'readonly' | 'contributor' }
    ): Promise<{
      ok: boolean
      error?: string
      granted?: { name: string | null; tier: string | null; level: string }
    }> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify(input)
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          granted?: { name: string | null; tier: string | null; level: string }
        }
        if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` }
        return { ok: true, granted: data.granted }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Revoke a grantee's access (owner only). */
    async revokeShare(boardRef: string, granteeUserId: string): Promise<boolean> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/shares/${encodeURIComponent(granteeUserId)}`,
          { method: 'DELETE', headers: adminHeaders(userType, sessionId) }
        )
        return res.ok
      } catch {
        return false
      }
    }
  }
}
