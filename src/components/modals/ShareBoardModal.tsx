/**
 * ShareBoardModal
 *
 * A lightweight dialog to share the CURRENT board, opened from the toolbar
 * (next to refresh). Reuses SharePanel — the same autocomplete + access +
 * grantee-management surface as the per-board share in Edit Boards.
 */
import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { Board } from '../../domain/types'
import { SharePanel } from './SharePanel'
import type { ShareApi } from './shareApi'

export interface ShareBoardModalProps {
  isOpen: boolean
  board: Board | null
  shareApi: ShareApi
  onClose: () => void
}

export function ShareBoardModal({ isOpen, board, shareApi, onClose }: ShareBoardModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      title={board ? `Share "${board.name}"` : 'Share board'}
      onClose={onClose}
      showConfirm={false}
      cancelLabel="Done"
      className="share-board-modal"
    >
      {board ? (
        <SharePanel board={board} shareApi={shareApi} />
      ) : (
        <p className="modal-hint">No board selected.</p>
      )}
    </Modal>
  )
}
