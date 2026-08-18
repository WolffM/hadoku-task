/**
 * The server-side board operations the modals take as an injected dependency,
 * plus the board reference they are all keyed by.
 *
 * These live apart from any one modal on purpose: EditBoardsModal, SharePanel,
 * AutomationPanel and ShareBoardModal all speak this interface, and keeping it
 * inside EditBoardsModal.tsx is what forced ShareBoardModal to import a panel
 * out of a different modal's file.
 */
import type { Board, AutomationPreset, PresetSourceStatus, PresetUpdate } from '../../domain/types'

export type ShareLevel = 'readonly' | 'contributor'

export interface ShareRow {
  granteeUserId: string
  name?: string | null
  tier?: string | null
  level: string
  createdAt: string
}

/** Server-only owner board operations (share + automation), injected from the client. */
export interface ShareApi {
  searchUsers: (q: string) => Promise<Array<{ name: string; tier?: string }>>
  listShares: (boardRef: string) => Promise<ShareRow[]>
  grantShare: (
    boardRef: string,
    input: { name?: string; userId?: string; level: ShareLevel }
  ) => Promise<{
    ok: boolean
    error?: string
    granted?: { name: string | null; tier: string | null; level: string }
  }>
  revokeShare: (boardRef: string, granteeUserId: string) => Promise<boolean>
  listAutomationPresets: () => Promise<{
    presets: AutomationPreset[]
    sources: PresetSourceStatus[]
  }>
  getPresetUpdate: (boardRef: string) => Promise<PresetUpdate | null>
  activateAutomation: (
    boardRef: string,
    payload: {
      lanes: unknown
      schemaId?: string | null
      schemaVersion?: number | null
      repo?: string | null
      dryRun?: boolean
      digest?: string
    }
  ) => Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }>
  deactivateAutomation: (boardRef: string) => Promise<{ ok: boolean; error?: string }>
  validateRepo: (repo: string) => Promise<{
    repo: string
    valid: boolean
    reason: string
    private?: boolean
    defaultBranch?: string
    message?: string
  }>
  setRepo: (boardRef: string, repo: string) => Promise<{ ok: boolean; repo?: string | null }>
}

/** A board's stable API reference for sharing: its handle, else its slug. */
export const boardRef = (b: Board): string => b.handle ?? b.id
