/**
 * Hook for handling all task-related operations in the app
 */

import type { Task, BoardsFile } from '../domain/types'
import type { PendingTaskOperation } from './useModalState'
import { splitTags, formatError } from '../domain/utils/tags'
import { validateBoardName as validateBoardNameUtil } from '../utils/validation'
import { logger } from '@wolffm/task-ui-components'

interface UseTaskHandlersProps {
  tasks: Task[]
  boards: BoardsFile | null
  inputRef: React.RefObject<HTMLInputElement>
  addTask: (input: string) => Promise<boolean | undefined>
  deleteTag: (tag: string) => Promise<void>
  updateTaskTags: (taskId: string, updates: { tag: string }) => Promise<void>
  bulkUpdateTaskTags: (updates: Array<{ taskId: string; tag: string }>) => Promise<void>
  createTagOnBoard: (tag: string) => Promise<void>
  createBoard: (name: string) => Promise<void>
  moveTasksToBoard: (boardId: string, taskIds: string[]) => Promise<void>
  clearSelection: () => void
  setEditTagModal: (modal: { taskId: string; currentTag: string | null } | null) => void
  setEditTagInput: (input: string) => void
  editTagModal: { taskId: string; currentTag: string | null } | null
  editTagInput: string
  confirmClearTag: { tag: string; count: number } | null
  setConfirmClearTag: (modal: { tag: string; count: number } | null) => void
  pendingTaskOperation: PendingTaskOperation | null
  setPendingTaskOperation: (operation: PendingTaskOperation | null) => void
  setShowNewTagDialog: (show: boolean) => void
  setInputValue: (value: string) => void
  setShowNewBoardDialog: (show: boolean) => void
  setValidationError: (error: string | null) => void
}

export function useTaskHandlers({
  tasks,
  boards,
  inputRef,
  addTask,
  deleteTag: _deleteTag,
  updateTaskTags,
  bulkUpdateTaskTags,
  createTagOnBoard,
  createBoard,
  moveTasksToBoard,
  clearSelection,
  setEditTagModal,
  setEditTagInput,
  editTagModal,
  editTagInput,
  setConfirmClearTag,
  pendingTaskOperation,
  setPendingTaskOperation,
  setShowNewTagDialog,
  setInputValue,
  setShowNewBoardDialog,
  setValidationError
}: UseTaskHandlersProps) {
  const handleAddTask = async (input: string) => {
    const success = await addTask(input)
    if (success && inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  const handleDeleteTag = (tag: string) => {
    const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tag))
    setConfirmClearTag({ tag, count: tagTasks.length })
  }

  const handleCreateTag = async (tagName: string) => {
    const normalized = tagName.trim().replace(/\s+/g, '-')
    try {
      await createTagOnBoard(normalized)

      // Check if we have pending task IDs to tag
      if (pendingTaskOperation?.type === 'apply-tag' && pendingTaskOperation.taskIds.length > 0) {
        const updates = pendingTaskOperation.taskIds.map(taskId => {
          const task = tasks.find(t => t.id === taskId)
          const existingTags = splitTags(task?.tag)
          const newTags = [...new Set([...existingTags, normalized])]
          return { taskId, tag: newTags.join(' ') }
        })

        await bulkUpdateTaskTags(updates)
        clearSelection()
      }

      setPendingTaskOperation(null)
      setShowNewTagDialog(false)
      setInputValue('')
    } catch (err) {
      logger.error('[App] Failed to create tag', {
        error: formatError(err)
      })
      throw err
    }
  }

  const handleEditTag = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setEditTagModal({ taskId, currentTag: task.tag || null })
      setEditTagInput('')
    }
  }

  const handleUpdateTag = async () => {
    if (!editTagModal) return

    const { taskId, currentTag } = editTagModal
    const currentTags = splitTags(currentTag)
    const newTagsFromInput = editTagInput.trim()
      ? editTagInput
          .trim()
          .replace(/\s+/g, '-')
          .split('#')
          .filter(Boolean)
          .map(t => t.trim())
      : []

    // Create new tags on the board first
    for (const newTag of newTagsFromInput) {
      await createTagOnBoard(newTag)
    }

    const allTags = [...new Set([...currentTags, ...newTagsFromInput])].sort()
    const finalTag = allTags.join(' ')

    await updateTaskTags(taskId, { tag: finalTag })

    setEditTagModal(null)
    setEditTagInput('')
  }

  const toggleTagPill = (tag: string) => {
    if (!editTagModal) return

    const { taskId, currentTag } = editTagModal
    const currentTags = splitTags(currentTag)
    const tagExists = currentTags.includes(tag)

    if (tagExists) {
      const newTags = currentTags
        .filter(t => t !== tag)
        .sort()
        .join(' ')
      setEditTagModal({ taskId, currentTag: newTags })
    } else {
      const newTags = [...currentTags, tag].sort().join(' ')
      setEditTagModal({ taskId, currentTag: newTags })
    }
  }

  const validateBoardName = (name: string): string | null => {
    return validateBoardNameUtil(name, boards?.boards || [])
  }

  const handleCreateBoard = async (boardName: string) => {
    const name = boardName.trim()
    const error = validateBoardName(name)
    if (error) {
      setValidationError(error)
      return
    }

    try {
      await createBoard(name)

      // Check if we have pending task IDs to move
      if (
        pendingTaskOperation?.type === 'move-to-board' &&
        pendingTaskOperation.taskIds.length > 0
      ) {
        await moveTasksToBoard(name, pendingTaskOperation.taskIds)
        clearSelection()
      }

      setPendingTaskOperation(null)
      setValidationError(null)
      setShowNewBoardDialog(false)
      setInputValue('')
    } catch (err) {
      logger.error('[App] Failed to create board', {
        error: formatError(err)
      })
      setValidationError((err as Error).message || 'Failed to create board')
    }
  }

  return {
    handleAddTask,
    handleDeleteTag,
    handleCreateTag,
    handleEditTag,
    handleUpdateTag,
    toggleTagPill,
    validateBoardName,
    handleCreateBoard
  }
}
