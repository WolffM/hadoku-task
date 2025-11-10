/**
 * All modal components for the main app
 */

import React from 'react'
import type { Task, BoardsFile, UserPreferences } from '../domain/types'
import { Toaster, type ToastState } from '@wolffm/task-ui-components'
import {
  ClearTagModal,
  CreateBoardModal,
  CreateTagModal,
  SettingsModal,
  EditTagModal,
  BoardContextMenu,
  TagContextMenu
} from './modals'
import type { PendingTaskOperation } from '../hooks/useModalState'

interface AppModalsProps {
  // Modal states
  confirmClearTag: { tag: string; count: number } | null
  showNewBoardDialog: boolean
  showNewTagDialog: boolean
  showSettingsModal: boolean
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
  preferences: UserPreferences
  showCompleteButton: boolean
  showDeleteButton: boolean
  showTagButton: boolean
  userType: string
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

  onCloseNewTagDialog: () => void
  onConfirmCreateTag: (tagName: string) => Promise<void>
  onTagInputChange: (value: string) => void

  onCloseSettingsModal: () => void
  onSavePreferences: (prefs: Partial<UserPreferences>) => Promise<void>
  onValidateKey: (key: string) => Promise<boolean>
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void

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
  showNewTagDialog,
  showSettingsModal,
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
  preferences,
  showCompleteButton,
  showDeleteButton,
  showTagButton,
  userType,
  userName,
  effectiveSessionId: _effectiveSessionId,
  toasts,
  onCloseConfirmClearTag,
  onConfirmDeleteTag,
  onCloseNewBoardDialog,
  onConfirmCreateBoard,
  onBoardInputChange,
  validateBoardName,
  onCloseNewTagDialog,
  onConfirmCreateTag,
  onTagInputChange,
  onCloseSettingsModal,
  onSavePreferences,
  onValidateKey,
  onUpdateUserName,
  onShowToast,
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

      <CreateTagModal
        isOpen={showNewTagDialog}
        inputValue={inputValue}
        tasks={tasks}
        pendingTaskOperation={pendingTaskOperation}
        onClose={onCloseNewTagDialog}
        onConfirm={onConfirmCreateTag}
        onInputChange={onTagInputChange}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        preferences={preferences}
        showCompleteButton={showCompleteButton}
        showDeleteButton={showDeleteButton}
        showTagButton={showTagButton}
        userType={userType}
        userName={userName}
        onClose={onCloseSettingsModal}
        onSavePreferences={onSavePreferences}
        onValidateKey={onValidateKey}
        onUpdateUserName={onUpdateUserName}
        onShowToast={onShowToast}
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
