/**
 * Main App component
 * Refactored to use extracted hooks and components for better maintainability
 */

import React, { useEffect, useRef, useState } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks } from '../hooks/useTasks'
import { useDragAndDrop } from '../hooks/useDragAndDrop'
import { useTaskSort } from '../hooks/useTaskSort'
import { usePreferences } from '../hooks/usePreferences'
import { useTheme } from '../hooks/useTheme'
import { useClickOutside } from '../hooks/useClickOutside'
import { useModalState } from '../hooks/useModalState'
import { useIsMobile } from '../hooks/useIsMobile'
import { performSessionHandshake, clearOldSessionStorage, getStoredSessionId } from '../api/session'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { AppHeader } from '../components/AppHeader'
import { BoardsSection } from '../components/BoardsSection'
import { TagFiltersSection } from '../components/TagFiltersSection'
import { TaskLayout } from '../components/TaskLayout'
import {
  ClearTagModal,
  CreateBoardModal,
  CreateTagModal,
  SettingsModal,
  EditTagModal,
  BoardContextMenu,
  TagContextMenu
} from '../components/modals'
import { getTopTags, getAllTags } from '../domain/utils/tags'
import { getRandomPlaceholder } from '../utils/placeholders'
import { validateBoardName as validateBoardNameUtil } from '../utils/validation'
import { createApi } from '../api/client'
import { MARQUEE_CLICK_GRACE_PERIOD } from './constants'

export default function App(props: TaskAppProps = {}) {
  const { userType = 'public', sessionId: propsSessionId = 'public' } = props

  // Refs
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Detect system color scheme preference for initial loading
  const [systemPrefersDark] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  // Basic state
  const isMobileDevice = useIsMobile()
  const [placeholder] = useState(() => getRandomPlaceholder())
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set())
  const [sessionInitialized, setSessionInitialized] = useState(false)
  
  // Initialize effectiveSessionId immediately for public users to prevent storage churn
  const [effectiveSessionId, setEffectiveSessionId] = useState(() => {
    // For public users, use stored sessionId immediately if available
    if (userType === 'public') {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('currentSessionId') : null
      return stored || propsSessionId
    }
    return propsSessionId
  })

  // Hooks for preferences and theme - skip initial load, we'll handle it in session handshake
  const { preferences, savePreferences, preferencesLoaded, isDarkTheme, setPreferences } = usePreferences(userType, effectiveSessionId, true)
  const { theme, showThemePicker, setShowThemePicker, THEME_FAMILIES, setTheme } = useTheme(preferences, savePreferences, containerRef)

  // Compute mobile layout  
  const isMobile = isMobileDevice || (preferences.alwaysVerticalLayout || false)

  // Convenience getters for preferences
  const showCompleteButton = preferences.showCompleteButton ?? true
  const showDeleteButton = preferences.showDeleteButton ?? true
  const showTagButton = preferences.showTagButton ?? false

  // Task operations hook
  const {
    tasks,
    pendingOperations,
    initialLoad,
    addTask,
    completeTask,
    deleteTask,
    updateTaskTags,
    bulkUpdateTaskTags,
    deleteTag,
    boards,
    currentBoardId,
    createBoard,
    deleteBoard,
    switchBoard,
    moveTasksToBoard,
    createTagOnBoard,
    deleteTagOnBoard
  } = useTasks({ userType, sessionId: effectiveSessionId })

  // Drag and drop hook
  const dragAndDrop = useDragAndDrop({ 
    tasks, 
    onTaskUpdate: updateTaskTags,
    onBulkUpdate: bulkUpdateTaskTags
  })

  // Sort hook
  const sortHook = useTaskSort()

  // Modal state hook
  const modals = useModalState()

  // Note: Theme picker now uses overlay approach like modals instead of useClickOutside
  useClickOutside(
    { current: null }, // Board context menu doesn't need a ref
    !!modals.boardContextMenu,
    () => modals.setBoardContextMenu(null),
    '.board-context-menu'
  )
  useClickOutside(
    { current: null }, // Tag context menu doesn't need a ref
    !!modals.tagContextMenu,
    () => modals.setTagContextMenu(null),
    '.tag-context-menu'
  )

  // Clear filters when switching boards
  useEffect(() => {
    setSelectedFilters(new Set())
  }, [currentBoardId])

  // Session handshake and initialization on mount
  useEffect(() => {
    async function initializeSession() {
      console.log('[App] Initializing session...', { userType, sessionId: propsSessionId })
      
      // Get old sessionId before handshake
      const oldSessionId = getStoredSessionId()
      
      // Perform handshake (for public users, this ensures stable sessionId in localStorage)
      const serverPreferences = await performSessionHandshake(propsSessionId, userType)
      
      // Determine the effective sessionId to use
      let finalSessionId = propsSessionId
      if (userType === 'public') {
        // Public users: use their stable localStorage sessionId
        finalSessionId = getStoredSessionId() || propsSessionId
        console.log('[App] Public user - using stable sessionId:', finalSessionId)
        
        // For public users, load preferences from localStorage now
        const api = createApi('public', finalSessionId)
        const localPrefs = await api.getPreferences()
        if (localPrefs) {
          setPreferences(localPrefs)
          console.log('[App] Loaded public user preferences from localStorage:', localPrefs)
        }
      } else {
        // Authenticated users: use the sessionId from props (from parent)
        finalSessionId = propsSessionId
        
        // Apply server preferences if available
        if (serverPreferences) {
          setPreferences(serverPreferences)
          console.log('[App] Applied preferences from handshake:', serverPreferences)
        }
        
        // Clear old session storage keys if sessionId changed
        if (oldSessionId && oldSessionId !== propsSessionId) {
          console.log('[App] SessionId changed, clearing old storage')
          clearOldSessionStorage(oldSessionId, userType)
        }
      }
      
      // Set the effective sessionId for all hooks to use (only if different)
      if (finalSessionId !== effectiveSessionId) {
        console.log('[App] Updating effectiveSessionId:', { from: effectiveSessionId, to: finalSessionId })
        setEffectiveSessionId(finalSessionId)
      }
      
      // Mark session as initialized
      setSessionInitialized(true)
      
      // Now load full data from API
      console.log('[App] Loading data from API...')
      await initialLoad()
    }
    
    void initializeSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, propsSessionId])

  // Handler functions
  const handleAddTask = async (input: string) => {
    const success = await addTask(input)
    if (success && inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  const handleDeleteTag = (tag: string) => {
    const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tag))
    modals.setConfirmClearTag({ tag, count: tagTasks.length })
  }

  const handleCreateTag = async (tagName: string) => {
    const normalized = tagName.trim().replace(/\s+/g, '-')
    try {
      await createTagOnBoard(normalized)
      
      // Check if we have pending task IDs to tag
      if (modals.pendingTaskOperation?.type === 'apply-tag' && modals.pendingTaskOperation.taskIds.length > 0) {
        const updates = modals.pendingTaskOperation.taskIds.map(taskId => {
          const task = tasks.find(t => t.id === taskId)
          const existingTags = task?.tag?.split(' ').filter(Boolean) || []
          const newTags = [...new Set([...existingTags, normalized])]
          return { taskId, tag: newTags.join(' ') }
        })
        
        await bulkUpdateTaskTags(updates)
        dragAndDrop.clearSelection()
      }
      
      modals.setPendingTaskOperation(null)
      modals.setShowNewTagDialog(false)
      modals.setInputValue('')
    } catch (err) {
      console.error('[App] Failed to create tag:', err)
      throw err
    }
  }

  const handleEditTag = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      modals.setEditTagModal({ taskId, currentTag: task.tag || null })
      modals.setEditTagInput('')
    }
  }

  const handleUpdateTag = async () => {
    if (!modals.editTagModal) return
    
    const { taskId, currentTag } = modals.editTagModal
    const currentTags = currentTag?.split(' ').filter(Boolean) || []
    const newTagsFromInput = modals.editTagInput.trim()
      ? modals.editTagInput.trim().replace(/\s+/g, '-').split('#').filter(Boolean).map(t => t.trim())
      : []
    
    // Create new tags on the board first
    for (const newTag of newTagsFromInput) {
      await createTagOnBoard(newTag)
    }
    
    const allTags = [...new Set([...currentTags, ...newTagsFromInput])].sort()
    const finalTag = allTags.join(' ')
    
    await updateTaskTags(taskId, { tag: finalTag })
    
    modals.setEditTagModal(null)
    modals.setEditTagInput('')
  }

  const toggleTagPill = (tag: string) => {
    if (!modals.editTagModal) return
    
    const { taskId, currentTag } = modals.editTagModal
    const currentTags = currentTag?.split(' ').filter(Boolean) || []
    const tagExists = currentTags.includes(tag)
    
    if (tagExists) {
      const newTags = currentTags.filter(t => t !== tag).sort().join(' ')
      modals.setEditTagModal({ taskId, currentTag: newTags })
    } else {
      const newTags = [...currentTags, tag].sort().join(' ')
      modals.setEditTagModal({ taskId, currentTag: newTags })
    }
  }

  const validateBoardName = (name: string): string | null => {
    return validateBoardNameUtil(name, boards?.boards || [])
  }

  const handleCreateBoard = async (boardName: string) => {
    const name = boardName.trim()
    const error = validateBoardName(name)
    if (error) {
      modals.setValidationError(error)
      return
    }
    
    try {
      await createBoard(name)
      
      // Check if we have pending task IDs to move
      if (modals.pendingTaskOperation?.type === 'move-to-board' && modals.pendingTaskOperation.taskIds.length > 0) {
        await moveTasksToBoard(name, modals.pendingTaskOperation.taskIds)
        dragAndDrop.clearSelection()
      }
      
      modals.setPendingTaskOperation(null)
      modals.setValidationError(null)
      modals.setShowNewBoardDialog(false)
      modals.setInputValue('')
    } catch (err) {
      console.error('[App] Failed to create board:', err)
      modals.setValidationError((err as Error).message || 'Failed to create board')
    }
  }

  // Computed values
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const persistedTags: string[] = currentBoard?.tags || []
  const allTags = Array.from(new Set([...persistedTags, ...getAllTags(tasks)]))
  const topTags = getTopTags(tasks, isMobile ? 3 : 6)

  // Show loading skeleton until session is initialized
  // Use system preference for theme during initial load, then switch to user preference
  if (!sessionInitialized || !preferencesLoaded) {
    return <LoadingSkeleton isDarkTheme={preferencesLoaded ? isDarkTheme : systemPrefersDark} />
  }

  return (
    <div
      ref={containerRef}
      className="task-app-container task-app-fade-in"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
      onMouseDown={dragAndDrop.selectionStartHandler}
      onMouseMove={dragAndDrop.selectionMoveHandler}
      onMouseUp={dragAndDrop.selectionEndHandler}
      onMouseLeave={dragAndDrop.selectionEndHandler}
      onClick={(e) => {
        try {
          const tgt = e.target as HTMLElement
          
          // Don't interfere with theme picker clicks
          if (tgt.closest && tgt.closest('.theme-picker')) {
            return
          }
          
          if (!tgt.closest || !tgt.closest('.task-app__item')) {
            if (dragAndDrop.selectionJustEndedAt && Date.now() - dragAndDrop.selectionJustEndedAt < MARQUEE_CLICK_GRACE_PERIOD) {
              return
            }
            dragAndDrop.clearSelection()
          }
        } catch {}
      }}
    >
      <div className="task-app">
        <AppHeader
          theme={theme}
          experimentalThemes={preferences.experimentalThemes || false}
          showThemePicker={showThemePicker}
          onThemePickerToggle={() => setShowThemePicker(!showThemePicker)}
          onThemeChange={setTheme}
          onSettingsClick={() => modals.setShowSettingsModal(true)}
          THEME_FAMILIES={THEME_FAMILIES}
        />

        <BoardsSection
          boards={boards}
          currentBoardId={currentBoardId}
          userType={userType}
          dragOverFilter={dragAndDrop.dragOverFilter}
          onBoardSwitch={switchBoard}
          onBoardContextMenu={(boardId, x, y) => modals.setBoardContextMenu({ boardId, x, y })}
          onDragOverFilter={dragAndDrop.setDragOverFilter}
          onMoveTasksToBoard={moveTasksToBoard}
          onClearSelection={dragAndDrop.clearSelection}
          onCreateBoardClick={() => {
            modals.setInputValue('')
            modals.setValidationError(null)
            modals.setShowNewBoardDialog(true)
          }}
          onPendingOperation={modals.setPendingTaskOperation}
          onInitialLoad={initialLoad}
        />

        <div className="task-app__controls">
          <input
            ref={inputRef}
            className="task-app__input"
            placeholder={placeholder}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAddTask((e.target as HTMLInputElement).value)
              }
              if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                inputRef.current?.focus()
              }
            }}
          />
        </div>

        <TagFiltersSection
          tags={allTags}
          selectedFilters={selectedFilters}
          dragOverFilter={dragAndDrop.dragOverFilter}
          onToggleFilter={(tag) => {
            setSelectedFilters(prev => {
              const copy = new Set(prev)
              if (copy.has(tag)) copy.delete(tag)
              else copy.add(tag)
              return copy
            })
          }}
          onTagContextMenu={(tag, x, y) => modals.setTagContextMenu({ tag, x, y })}
          onDragOver={dragAndDrop.onFilterDragOver}
          onDragLeave={dragAndDrop.onFilterDragLeave}
          onDrop={dragAndDrop.onFilterDrop}
          onCreateTagClick={() => {
            modals.setInputValue('')
            modals.setShowNewTagDialog(true)
          }}
          onPendingOperation={modals.setPendingTaskOperation}
        />

        <TaskLayout
          tasks={tasks}
          topTags={topTags}
          isMobile={isMobile}
          filters={Array.from(selectedFilters)}
          selectedIds={dragAndDrop.selectedIds}
          onSelectionStart={dragAndDrop.selectionStartHandler}
          onSelectionMove={dragAndDrop.selectionMoveHandler}
          onSelectionEnd={dragAndDrop.selectionEndHandler}
          sortDirections={sortHook.sortDirections}
          dragOverTag={dragAndDrop.dragOverTag}
          pendingOperations={pendingOperations}
          onComplete={completeTask}
          onDelete={deleteTask}
          onEditTag={handleEditTag}
          onDragStart={dragAndDrop.onDragStart}
          onDragEnd={dragAndDrop.onDragEnd}
          onDragOver={dragAndDrop.onDragOver}
          onDragLeave={dragAndDrop.onDragLeave}
          onDrop={dragAndDrop.onDrop}
          toggleSort={sortHook.toggleSort}
          sortTasksByAge={sortHook.sortTasksByAge}
          getSortIcon={sortHook.getSortIcon}
          getSortTitle={sortHook.getSortTitle}
          deleteTag={handleDeleteTag}
          onDeletePersistedTag={deleteTagOnBoard}
          showCompleteButton={showCompleteButton}
          showDeleteButton={showDeleteButton}
          showTagButton={showTagButton}
        />

        {dragAndDrop.isSelecting && dragAndDrop.marqueeRect && (
          <div
            className="marquee-overlay"
            style={{
              left: `${dragAndDrop.marqueeRect.x}px`,
              top: `${dragAndDrop.marqueeRect.y}px`,
              width: `${dragAndDrop.marqueeRect.w}px`,
              height: `${dragAndDrop.marqueeRect.h}px`
            }}
          />
        )}

        {/* Modals */}
        <ClearTagModal
          tag={modals.confirmClearTag?.tag || null}
          count={modals.confirmClearTag?.count || 0}
          isOpen={!!modals.confirmClearTag}
          onClose={() => modals.setConfirmClearTag(null)}
          onConfirm={deleteTag}
        />

        <CreateBoardModal
          isOpen={modals.showNewBoardDialog}
          inputValue={modals.inputValue}
          validationError={modals.validationError}
          pendingTaskOperation={modals.pendingTaskOperation}
          onClose={() => {
            modals.setShowNewBoardDialog(false)
            modals.setPendingTaskOperation(null)
            modals.setValidationError(null)
          }}
          onConfirm={handleCreateBoard}
          onInputChange={(value) => {
            modals.setInputValue(value)
            modals.setValidationError(null)
          }}
          validateBoardName={validateBoardName}
        />

        <CreateTagModal
          isOpen={modals.showNewTagDialog}
          inputValue={modals.inputValue}
          tasks={tasks}
          pendingTaskOperation={modals.pendingTaskOperation}
          onClose={() => {
            modals.setShowNewTagDialog(false)
            modals.setPendingTaskOperation(null)
          }}
          onConfirm={handleCreateTag}
          onInputChange={modals.setInputValue}
        />

        <SettingsModal
          isOpen={modals.showSettingsModal}
          preferences={preferences}
          showCompleteButton={showCompleteButton}
          showDeleteButton={showDeleteButton}
          showTagButton={showTagButton}
          onClose={() => modals.setShowSettingsModal(false)}
          onSavePreferences={savePreferences}
          onValidateKey={async (key) => {
            const api = createApi(userType as 'public' | 'friend' | 'admin', effectiveSessionId)
            return await api.validateKey(key)
          }}
        />

        <EditTagModal
          isOpen={!!modals.editTagModal}
          taskId={modals.editTagModal?.taskId || null}
          currentTag={modals.editTagModal?.currentTag || null}
          editTagInput={modals.editTagInput}
          boards={boards}
          currentBoardId={currentBoardId}
          onClose={() => {
            modals.setEditTagModal(null)
            modals.setEditTagInput('')
          }}
          onConfirm={handleUpdateTag}
          onInputChange={modals.setEditTagInput}
          onToggleTagPill={toggleTagPill}
        />

        <BoardContextMenu
          isOpen={!!modals.boardContextMenu}
          boardId={modals.boardContextMenu?.boardId || null}
          x={modals.boardContextMenu?.x || 0}
          y={modals.boardContextMenu?.y || 0}
          boards={boards}
          onClose={() => modals.setBoardContextMenu(null)}
          onDeleteBoard={deleteBoard}
        />

        <TagContextMenu
          isOpen={!!modals.tagContextMenu}
          tag={modals.tagContextMenu?.tag || null}
          x={modals.tagContextMenu?.x || 0}
          y={modals.tagContextMenu?.y || 0}
          onClose={() => modals.setTagContextMenu(null)}
          onDeleteTag={deleteTag}
        />
      </div>
    </div>
  )
}
