/**
 * All modal components for the main app
 */

import React from 'react'
import type { Task, BoardsFile } from '../domain/types'
import { Toaster, type ToastState } from '@wolffm/task-ui-components'
import {
  ClearTagModal,
  CreateBoardModal,
  EditBoardsModal,
  ShareBoardModal,
  CreateTagModal,
  EditTagModal,
  BoardContextMenu,
  TagContextMenu
} from './modals'
import type { ShareApi } from './modals/shareApi'
import type { PendingTaskOperation } from '../hooks/useModalState'
import { TOPBAR_BOARD_SLOTS } from '../app/constants'

interface AppModalsProps {
  // Modal states
  confirmClearTag: { tag: string; count: number } | null
  showNewBoardDialog: boolean
  showEditBoardsDialog: boolean
  showNewTagDialog: boolean
  editTagModal: { taskId: string; currentTag: string | null } | null
  boardContextMenu: { boardId: string; x: number; y: number } | null
  tagContextMenu: { tag: string; x: number; y: number } | null

  // Input states
  inputValue: string
  validationError: string | null
  editTagInput: string
  pendingTaskOperation: PendingTaskOperation | null

  // Data
  tasks: Task[]
  boards: BoardsFile | null
  currentBoardId: string
  effectiveSessionId: string

  // Toasts
  toasts: ToastState[]

  // Handlers
  onCloseConfirmClearTag: () => void
  onConfirmDeleteTag: (tag: string) => Promise<void>

  onCloseNewBoardDialog: () => void
  onConfirmCreateBoard: (boardName: string) => Promise<void>
  onBoardInputChange: (value: string) => void
  validateBoardName: (name: string) => string | null

  onCloseEditBoards: () => void
  onRenameBoard: (boardId: string, name: string) => Promise<void>
  onSetPinnedBoards: (order: string[]) => Promise<void>
  shareApi: ShareApi
  onReloadBoards: () => Promise<void>
  showShareDialog: boolean
  onCloseShareDialog: () => void

  onCloseNewTagDialog: () => void
  onConfirmCreateTag: (tagName: string) => Promise<void>
  onTagInputChange: (value: string) => void

  onCloseEditTagModal: () => void
  onConfirmEditTag: () => Promise<void>
  onEditTagInputChange: (value: string) => void
  onToggleTagPill: (tag: string) => void

  onCloseBoardContextMenu: () => void
  onDeleteBoard: (boardId: string) => Promise<void>

  onCloseTagContextMenu: () => void

  onDismissToast: (id: number) => void
}

export function AppModals({
  confirmClearTag,
  showNewBoardDialog,
  showEditBoardsDialog,
  showNewTagDialog,
  editTagModal,
  boardContextMenu,
  tagContextMenu,
  inputValue,
  validationError,
  editTagInput,
  pendingTaskOperation,
  tasks,
  boards,
  currentBoardId,
  effectiveSessionId: _effectiveSessionId,
  toasts,
  onCloseConfirmClearTag,
  onConfirmDeleteTag,
  onCloseNewBoardDialog,
  onConfirmCreateBoard,
  onBoardInputChange,
  validateBoardName,
  onCloseEditBoards,
  onRenameBoard,
  onSetPinnedBoards,
  shareApi,
  onReloadBoards,
  showShareDialog,
  onCloseShareDialog,
  onCloseNewTagDialog,
  onConfirmCreateTag,
  onTagInputChange,
  onCloseEditTagModal,
  onConfirmEditTag,
  onEditTagInputChange,
  onToggleTagPill,
  onCloseBoardContextMenu,
  onDeleteBoard,
  onCloseTagContextMenu,
  onDismissToast
}: AppModalsProps) {
  return (
    <>
      <ClearTagModal
        tag={confirmClearTag?.tag || null}
        count={confirmClearTag?.count || 0}
        isOpen={!!confirmClearTag}
        onClose={onCloseConfirmClearTag}
        onConfirm={onConfirmDeleteTag}
      />

      <CreateBoardModal
        isOpen={showNewBoardDialog}
        inputValue={inputValue}
        validationError={validationError}
        pendingTaskOperation={pendingTaskOperation}
        onClose={onCloseNewBoardDialog}
        onConfirm={onConfirmCreateBoard}
        onInputChange={onBoardInputChange}
        validateBoardName={validateBoardName}
      />

      <EditBoardsModal
        isOpen={showEditBoardsDialog}
        boards={boards?.boards ?? []}
        currentBoardId={currentBoardId}
        slots={TOPBAR_BOARD_SLOTS}
        onClose={onCloseEditBoards}
        onCreate={onConfirmCreateBoard}
        onRename={onRenameBoard}
        onDelete={onDeleteBoard}
        onSetPinned={onSetPinnedBoards}
        shareApi={shareApi}
        onReloadBoards={onReloadBoards}
        validateBoardName={validateBoardName}
      />

      <ShareBoardModal
        isOpen={showShareDialog}
        board={(boards?.boards ?? []).find(b => b.id === currentBoardId) ?? null}
        shareApi={shareApi}
        onClose={onCloseShareDialog}
      />

      <CreateTagModal
        isOpen={showNewTagDialog}
        inputValue={inputValue}
        tasks={tasks}
        pendingTaskOperation={pendingTaskOperation}
        onClose={onCloseNewTagDialog}
        onConfirm={onConfirmCreateTag}
        onInputChange={onTagInputChange}
      />

      <EditTagModal
        isOpen={!!editTagModal}
        taskId={editTagModal?.taskId || null}
        currentTag={editTagModal?.currentTag || null}
        editTagInput={editTagInput}
        boards={boards}
        currentBoardId={currentBoardId}
        onClose={onCloseEditTagModal}
        onConfirm={onConfirmEditTag}
        onInputChange={onEditTagInputChange}
        onToggleTagPill={onToggleTagPill}
      />

      <BoardContextMenu
        isOpen={!!boardContextMenu}
        boardId={boardContextMenu?.boardId || null}
        x={boardContextMenu?.x || 0}
        y={boardContextMenu?.y || 0}
        boards={boards}
        onClose={onCloseBoardContextMenu}
        onDeleteBoard={onDeleteBoard}
      />

      <TagContextMenu
        isOpen={!!tagContextMenu}
        tag={tagContextMenu?.tag || null}
        x={tagContextMenu?.x || 0}
        y={tagContextMenu?.y || 0}
        onClose={onCloseTagContextMenu}
        onDeleteTag={onConfirmDeleteTag}
      />

      <Toaster toasts={toasts} onDismiss={onDismissToast} position="bottom-center" />
    </>
  )
}
