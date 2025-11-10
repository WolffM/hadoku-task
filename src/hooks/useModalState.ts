/**
 * useModalState hook
 * Centralized state management for all modal dialogs in the app
 */

import { useState } from 'react'

export interface PendingTaskOperation {
  type: 'move-to-board' | 'apply-tag'
  taskIds: string[]
}

export interface UseModalStateReturn {
  // Clear Tag Confirmation
  confirmClearTag: { tag: string; count: number } | null
  setConfirmClearTag: (value: { tag: string; count: number } | null) => void

  // Create Board Dialog
  showNewBoardDialog: boolean
  setShowNewBoardDialog: (show: boolean) => void

  // Create Tag Dialog
  showNewTagDialog: boolean
  setShowNewTagDialog: (show: boolean) => void

  // Settings Modal
  showSettingsModal: boolean
  setShowSettingsModal: (show: boolean) => void

  // Edit Tag Modal
  editTagModal: { taskId: string; currentTag: string | null } | null
  setEditTagModal: (value: { taskId: string; currentTag: string | null } | null) => void
  editTagInput: string
  setEditTagInput: (value: string) => void

  // Board Context Menu
  boardContextMenu: { boardId: string; x: number; y: number } | null
  setBoardContextMenu: (value: { boardId: string; x: number; y: number } | null) => void

  // Tag Context Menu
  tagContextMenu: { tag: string; x: number; y: number } | null
  setTagContextMenu: (value: { tag: string; x: number; y: number } | null) => void

  // Shared Modal State
  inputValue: string
  setInputValue: (value: string) => void
  validationError: string | null
  setValidationError: (error: string | null) => void
  pendingTaskOperation: PendingTaskOperation | null
  setPendingTaskOperation: (op: PendingTaskOperation | null) => void
}

/**
 * Hook to manage state for all modal dialogs
 * Centralizes modal visibility, input values, and validation errors
 */
export function useModalState(): UseModalStateReturn {
  // Clear Tag Confirmation
  const [confirmClearTag, setConfirmClearTag] = useState<{ tag: string; count: number } | null>(
    null
  )

  // Create Board Dialog
  const [showNewBoardDialog, setShowNewBoardDialog] = useState(false)

  // Create Tag Dialog
  const [showNewTagDialog, setShowNewTagDialog] = useState(false)

  // Settings Modal
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // Edit Tag Modal
  const [editTagModal, setEditTagModal] = useState<{
    taskId: string
    currentTag: string | null
  } | null>(null)
  const [editTagInput, setEditTagInput] = useState('')

  // Context Menus
  const [boardContextMenu, setBoardContextMenu] = useState<{
    boardId: string
    x: number
    y: number
  } | null>(null)
  const [tagContextMenu, setTagContextMenu] = useState<{
    tag: string
    x: number
    y: number
  } | null>(null)

  // Shared Modal State
  const [inputValue, setInputValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [pendingTaskOperation, setPendingTaskOperation] = useState<PendingTaskOperation | null>(
    null
  )

  return {
    confirmClearTag,
    setConfirmClearTag,
    showNewBoardDialog,
    setShowNewBoardDialog,
    showNewTagDialog,
    setShowNewTagDialog,
    showSettingsModal,
    setShowSettingsModal,
    editTagModal,
    setEditTagModal,
    editTagInput,
    setEditTagInput,
    boardContextMenu,
    setBoardContextMenu,
    tagContextMenu,
    setTagContextMenu,
    inputValue,
    setInputValue,
    validationError,
    setValidationError,
    pendingTaskOperation,
    setPendingTaskOperation
  }
}
