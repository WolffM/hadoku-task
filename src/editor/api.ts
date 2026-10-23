/**
 * The editor's two calls. On hadoku.me the edge resolves the session cookie to
 * the caller's tier; on the local dev stack the shim pins every request to
 * `friend`, so the dev harness asks for `service` explicitly (X-Dev-Tier,
 * which only worker/test/dev-server.ts reads).
 */
import type { TokenEdits } from '@wolffm/themes/contract'

export interface ThemeSource {
  commit: string
  css: string
  versions: Record<string, string>
}

export interface TokenChange {
  theme: string
  token: string
  from: string
  to: string
}

export type SaveResult =
  | {
      kind: 'committed'
      commit: string
      url: string
      versions: Record<string, string>
      changes: TokenChange[]
    }
  | { kind: 'unchanged' }
  | {
      kind: 'conflict'
      message: string
      conflicts: { theme: string; token: string; yours: string; theirs: string }[]
    }
  | { kind: 'contract'; message: string; problems: string[] }
  | { kind: 'error'; message: string }

export interface EditorApi {
  source(): Promise<ThemeSource>
  save(baseCommit: string, edits: TokenEdits, note?: string): Promise<SaveResult>
}

export function createEditorApi(devTier?: string): EditorApi {
  const headers: Record<string, string> = devTier ? { 'X-Dev-Tier': devTier } : {}

  async function errorMessage(res: Response) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  }

  return {
    async source() {
      const res = await fetch('/task/api/themes/source', { headers, credentials: 'include' })
      if (!res.ok) throw new Error(await errorMessage(res))
      return (await res.json()) as ThemeSource
    },

    async save(baseCommit, edits, note) {
      let res: Response
      try {
        res = await fetch('/task/api/themes/save', {
          method: 'POST',
          credentials: 'include',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseCommit, edits, ...(note ? { note } : {}) })
        })
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const message = (body.error as string | undefined) ?? `HTTP ${res.status}`
      if (res.status === 200) {
        return body.committed
          ? {
              kind: 'committed',
              commit: body.commit as string,
              url: body.url as string,
              versions: body.versions as Record<string, string>,
              changes: body.changes as TokenChange[]
            }
          : { kind: 'unchanged' }
      }
      if (res.status === 409) {
        return {
          kind: 'conflict',
          message,
          conflicts: body.conflicts as Extract<SaveResult, { kind: 'conflict' }>['conflicts']
        }
      }
      if (res.status === 422) {
        return { kind: 'contract', message, problems: body.problems as string[] }
      }
      return { kind: 'error', message }
    }
  }
}
