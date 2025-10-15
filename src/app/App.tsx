import React, { useEffect, useRef, useState } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks, SESSION_ID } from '../hooks/useTasks'
import { useDragAndDrop } from '../hooks/useDragAndDrop'
import { useTaskSort } from '../hooks/useTaskSort'
import { BoardButton } from '../components/BoardButton'
import { TagFilterButton } from '../components/TagFilterButton'
import { TaskLayout } from '../components/TaskLayout'
import { Modal } from '../components/Modal'
import { ContextMenu } from '../components/ContextMenu'
import { getTopTags, getAllTags } from '../domain/utils/tags'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import { createApi } from '../api/client'
import type { ThemeName } from './types'

// UI Configuration
const MAX_BOARDS = 5 // Maximum number of boards to display in the board list

// Theme configuration
const THEMES: Array<{ name: ThemeName; emoji: string; label: string }> = [
  { name: 'light', emoji: '☀️', label: 'Light theme' },
  { name: 'dark', emoji: '🌙', label: 'Dark theme' },
  { name: 'strawberry', emoji: '🍓', label: 'Strawberry theme' },
  { name: 'ocean', emoji: '🌊', label: 'Ocean theme' },
  { name: 'cyberpunk', emoji: '🤖', label: 'Cyberpunk theme' },
  { name: 'coffee', emoji: '☕', label: 'Coffee theme' },
  { name: 'lavender', emoji: '🪻', label: 'Lavender theme' },
]

const getThemeEmoji = (themeName: ThemeName): string => 
  THEMES.find(t => t.name === themeName)?.emoji || '🌙'

export default function App(props: TaskAppProps = {}) {
  const { userType = 'public', userId = 'public', sessionId } = props;
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set())
  const [confirmClearTag, setConfirmClearTag] = useState<{tag: string, count: number} | null>(null)
  const [showNewBoardDialog, setShowNewBoardDialog] = useState(false)
  const [showNewTagDialog, setShowNewTagDialog] = useState(false)
  const [pendingTaskOperation, setPendingTaskOperation] = useState<{
    type: 'move-to-board' | 'apply-tag'
    taskIds: string[]
  } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeName>('light')
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [boardContextMenu, setBoardContextMenu] = useState<{boardId: string, x: number, y: number} | null>(null)
  const [tagContextMenu, setTagContextMenu] = useState<{tag: string, x: number, y: number} | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Task operations hook
  const {
    tasks,
    pendingOperations,
    initialLoad,
    reload,
    addTask,
    completeTask,
    deleteTask,
    addTagToTask,
    updateTaskTags,
    bulkUpdateTaskTags,
    clearTasksByTag,
    clearRemainingTasks
    ,
    // board API
    boards,
    currentBoardId,
    createBoard,
    deleteBoard,
    switchBoard
    , moveTasksToBoard
  , createTagOnBoard, deleteTagOnBoard
  } = useTasks({ userType, userId, sessionId })

  // Drag and drop hook
  const dragAndDrop = useDragAndDrop({ 
    tasks, 
    onTaskUpdate: updateTaskTags,
    onBulkUpdate: bulkUpdateTaskTags
  })

  // Sort hook
  const sortHook = useTaskSort()

  // Load user preferences (theme) on mount
  useEffect(() => {
    const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
    void api.getPreferences().then(prefs => {
      setTheme(prefs.theme)
    })
  }, [userType, userId, sessionId])

  // Save theme preference when it changes
  useEffect(() => {
    const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
    void api.savePreferences({ theme })
  }, [theme, userType, userId, sessionId])

  // Initialize and reload when user context changes
  useEffect(() => {
    console.log('[App] User context changed, initializing...', { userType, userId })
    void initialLoad()
    inputRef.current?.focus()
  }, [userType, userId])

  // Apply theme to container element (scoped, not document-wide)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-theme', theme)
    }
  }, [theme])

  // Close theme picker and context menus when clicking outside
  useEffect(() => {
    if (!showThemePicker && !boardContextMenu && !tagContextMenu) return
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.theme-picker')) {
        setShowThemePicker(false)
      }
      if (!target.closest('.board-context-menu')) {
        setBoardContextMenu(null)
      }
      if (!target.closest('.tag-context-menu')) {
        setTagContextMenu(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showThemePicker, boardContextMenu, tagContextMenu])

  // Handle task input
  async function handleAddTask(input: string) {
    const success = await addTask(input)
    if (success && inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  // Wrapper for clearTasksByTag that shows confirmation dialog
  function handleClearTasksByTag(tag: string) {
    const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tag))
    setConfirmClearTag({ tag, count: tagTasks.length })
  }

  // Handle tag creation and optionally apply to pending tasks
  async function handleCreateTag(tagName: string) {
    const normalized = tagName.trim().replace(/\s+/g, '-')
    try {
      await createTagOnBoard(normalized)
      
      // Check if we have pending task IDs to tag (from drag-and-drop)
      if (pendingTaskOperation?.type === 'apply-tag' && pendingTaskOperation.taskIds.length > 0) {
        // Build updates array - add the new tag to existing tags for each task
        const updates = pendingTaskOperation.taskIds.map(taskId => {
          const task = tasks.find(t => t.id === taskId)
          const existingTags = task?.tag?.split(' ').filter(Boolean) || []
          const newTags = [...new Set([...existingTags, normalized])]
          return { taskId, tag: newTags.join(' ') }
        })
        
        // Apply the tag to all the dragged tasks
        await bulkUpdateTaskTags(updates)
        // Clear selection after tagging
        dragAndDrop.clearSelection()
      }
      
      // Clear the pending operation
      setPendingTaskOperation(null)
    } catch (err) {
      console.error('[App] Failed to create tag:', err)
      throw err
    }
  }

  // Validate board name for duplicates
  function validateBoardName(name: string): string | null {
    const trimmed = name.trim()
    if (!trimmed) return 'Board name cannot be empty'
    
    const existingNames = boards?.boards?.map(b => b.id.toLowerCase()) || []
    if (existingNames.includes(trimmed.toLowerCase())) {
      return `Board "${trimmed}" already exists`
    }
    
    return null // Valid
  }

  // Handle board creation and optionally move pending tasks
  async function handleCreateBoard(boardName: string) {
    const name = boardName.trim()
    
    // Validate before attempting to create
    const error = validateBoardName(name)
    if (error) {
      setValidationError(error)
      return
    }
    
    try {
      // Always create the board first
      await createBoard(name)
      
      // Check if we have pending task IDs to move (from drag-and-drop)
      if (pendingTaskOperation?.type === 'move-to-board' && pendingTaskOperation.taskIds.length > 0) {
        // Move all the dragged tasks to the new board
        // Note: at this point we're already on the new board (createBoard switched us)
        // but it's empty. moveTasksToBoard will move tasks and reload.
        await moveTasksToBoard(name, pendingTaskOperation.taskIds)
        
        // Clear selection after moving
        dragAndDrop.clearSelection()
      }
      
      // Clear the pending operation
      setPendingTaskOperation(null)
      setValidationError(null)
    } catch (err) {
      console.error('[App] Failed to create board:', err)
      setValidationError((err as Error).message || 'Failed to create board')
    }
  }

  // Get top tags for layout, including any persisted tags on the current board so empty-but-known tags remain available
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const persistedTags: string[] = currentBoard?.tags || []
  // For layout we only want tags derived from tasks so the layout collapses when empty
  const topTags = getTopTags(tasks, 6)

  return (
    <div
      ref={containerRef}
      className="task-app-container"
      onMouseDown={dragAndDrop.selectionStartHandler}
      onMouseMove={dragAndDrop.selectionMoveHandler}
      onMouseUp={dragAndDrop.selectionEndHandler}
      onMouseLeave={dragAndDrop.selectionEndHandler}
      onClick={(e) => {
        // Clear selection when clicking outside of task items
        try {
          const tgt = e.target as HTMLElement
          if (!tgt.closest || !tgt.closest('.task-app__item')) {
            // If a marquee just ended very recently, don't immediately clear selection
            if (dragAndDrop.selectionJustEndedAt && Date.now() - dragAndDrop.selectionJustEndedAt < 300) {
              return
            }
            dragAndDrop.clearSelection()
          }
        } catch {}
      }}
    >
      <div className="task-app">
      <div className="task-app__header-container">
        <h1 className="task-app__header">Tasks</h1>
        <div className="theme-picker">
          <button 
            className="theme-toggle-btn" 
            onClick={() => setShowThemePicker(!showThemePicker)}
            aria-label="Choose theme"
            title="Choose theme"
          >
            {getThemeEmoji(theme)}
          </button>
          {showThemePicker && (
            <div className="theme-picker__dropdown">
              {THEMES.map(({ name, emoji, label }) => (
                <button
                  key={name}
                  className={`theme-picker__option ${theme === name ? 'active' : ''}`}
                  onClick={() => { setTheme(name); setShowThemePicker(false); }}
                  title={label}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="task-app__boards">
        {/* Render up to MAX_BOARDS board buttons, highlight active */}
        <div className="task-app__board-list">
          {(boards && boards.boards ? boards.boards.slice(0, MAX_BOARDS) : [{ id: 'main', name: 'main', tasks: [], tags: [] }]).map(b => (
            <BoardButton
              key={b.id}
              board={b}
              isActive={currentBoardId === b.id}
              isDragOver={dragAndDrop.dragOverFilter === `board:${b.id}`}
              onSwitch={switchBoard}
              onContextMenu={(boardId, x, y) => setBoardContextMenu({ boardId, x, y })}
              onDragOverFilter={dragAndDrop.setDragOverFilter}
              onMoveTasksToBoard={moveTasksToBoard}
              onClearSelection={dragAndDrop.clearSelection}
            />
          ))}
        </div>

        <div className="task-app__board-actions">
          {/* Only show + if we have fewer than MAX_BOARDS boards */}
          {(!boards || (boards.boards && boards.boards.length < MAX_BOARDS)) && (
            <button 
              className={`board-add-btn ${dragAndDrop.dragOverFilter === 'add-board' ? 'board-btn--drag-over' : ''}`}
              onClick={() => {
                setInputValue('')
                setValidationError(null)
                setShowNewBoardDialog(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                dragAndDrop.setDragOverFilter('add-board')
              }}
              onDragLeave={(e) => {
                dragAndDrop.setDragOverFilter(null)
              }}
              onDrop={async (e) => {
                e.preventDefault()
                dragAndDrop.setDragOverFilter(null)
                
                const ids = getTaskIdsFromDragEvent(e.dataTransfer)
                if (ids.length > 0) {
                  // Open dialog and store the task IDs to move after creation
                  setInputValue('')
                  setPendingTaskOperation({ type: 'move-to-board', taskIds: ids })
                  setShowNewBoardDialog(true)
                }
              }}
              aria-label="Create board"
            >＋</button>
          )}
          
          {userType !== 'public' && (
            <button
              className="sync-btn"
              onClick={async (e) => {
                console.log('[App] Manual refresh triggered')
                await initialLoad()
                // Remove focus after sync completes
                ;(e.currentTarget as HTMLButtonElement).blur()
              }}
              title="Sync from server"
              aria-label="Sync from server"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="task-app__controls">
        <input
          ref={inputRef}
          className="task-app__input"
          placeholder="Type a task and press Enter…"
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
      <div className="task-app__filters">
        {(() => {
          const derived = getAllTags(tasks)
          // Persisted tags should appear in the filters even if there are no matching tasks
          const all = Array.from(new Set([...persistedTags, ...derived]))
          return all.map(tag => (
            <TagFilterButton
              key={tag}
              tag={tag}
              isActive={selectedFilters.has(tag)}
              isDragOver={dragAndDrop.dragOverFilter === tag}
              onToggle={(tag) => {
                setSelectedFilters(prev => {
                  const copy = new Set(prev)
                  if (copy.has(tag)) copy.delete(tag)
                  else copy.add(tag)
                  return copy
                })
              }}
              onContextMenu={(tag, x, y) => setTagContextMenu({ tag, x, y })}
              onDragOver={dragAndDrop.onFilterDragOver}
              onDragLeave={dragAndDrop.onFilterDragLeave}
              onDrop={dragAndDrop.onFilterDrop}
            />
          ))
        })()}
        <button 
          className={`task-app__filter-add ${dragAndDrop.dragOverFilter === 'add-tag' ? 'task-app__filter-drag-over' : ''}`}
          onClick={() => {
            setInputValue('')
            setShowNewTagDialog(true)
          }} 
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            dragAndDrop.onFilterDragOver(e, 'add-tag')
          }}
          onDragLeave={dragAndDrop.onFilterDragLeave}
          onDrop={async (e) => {
            e.preventDefault()
            dragAndDrop.onFilterDragLeave(e)
            
            const ids = getTaskIdsFromDragEvent(e.dataTransfer)
            if (ids.length > 0) {
              // Open dialog and store the task IDs to tag after creation
              setInputValue('')
              setPendingTaskOperation({ type: 'apply-tag', taskIds: ids })
              setShowNewTagDialog(true)
            }
          }}
          aria-label="Add tag"
        >＋</button>
      </div>
      <TaskLayout
        tasks={tasks}
        topTags={topTags}
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
        onAddTag={addTagToTask}
        onDragStart={dragAndDrop.onDragStart}
  onDragEnd={dragAndDrop.onDragEnd}
        onDragOver={dragAndDrop.onDragOver}
        onDragLeave={dragAndDrop.onDragLeave}
        onDrop={dragAndDrop.onDrop}
        toggleSort={sortHook.toggleSort}
        sortTasksByAge={sortHook.sortTasksByAge}
        getSortIcon={sortHook.getSortIcon}
        getSortTitle={sortHook.getSortTitle}
        clearTasksByTag={handleClearTasksByTag}
        clearRemainingTasks={clearRemainingTasks}
        onDeletePersistedTag={deleteTagOnBoard}
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

      <Modal
        isOpen={!!confirmClearTag}
        title={`Clear Tag #${confirmClearTag?.tag}?`}
        onClose={() => setConfirmClearTag(null)}
        onConfirm={async () => {
          if (!confirmClearTag) return
          const tag = confirmClearTag.tag
          setConfirmClearTag(null)
          await clearTasksByTag(tag)
        }}
        confirmLabel="Clear Tag"
        confirmDanger={true}
      >
        {confirmClearTag && (
          <p>
            This will remove <strong>#{confirmClearTag.tag}</strong> from{' '}
            <strong>{confirmClearTag.count} task(s)</strong> and delete the tag from the board.
          </p>
        )}
      </Modal>

      <Modal
        isOpen={showNewBoardDialog}
        title="Create New Board"
        onClose={() => {
          setShowNewBoardDialog(false)
          setPendingTaskOperation(null)
          setValidationError(null)
        }}
        onConfirm={async () => {
          if (!inputValue.trim()) return
          
          // Validate before closing modal
          const error = validateBoardName(inputValue)
          if (error) {
            setValidationError(error)
            return // Don't close modal if validation fails
          }
          
          setShowNewBoardDialog(false)
          await handleCreateBoard(inputValue)
        }}
        inputValue={inputValue}
        onInputChange={(value) => {
          setInputValue(value)
          setValidationError(null) // Clear error on input change
        }}
        inputPlaceholder="Board name"
        confirmLabel="Create"
        confirmDisabled={!inputValue.trim() || validateBoardName(inputValue) !== null}
      >
        {pendingTaskOperation?.type === 'move-to-board' && pendingTaskOperation.taskIds.length > 0 && (
          <p className="modal-hint">
            {pendingTaskOperation.taskIds.length} task{pendingTaskOperation.taskIds.length > 1 ? 's' : ''} will be moved to this board
          </p>
        )}
        {validationError && (
          <p className="modal-error" style={{ color: 'var(--error-color, #d32f2f)', marginTop: '0.5rem' }}>
            {validationError}
          </p>
        )}
      </Modal>

      <Modal
        isOpen={showNewTagDialog}
        title="Create New Tag"
        onClose={() => {
          setShowNewTagDialog(false)
          setPendingTaskOperation(null)
        }}
        onConfirm={async () => {
          if (!inputValue.trim()) return
          setShowNewTagDialog(false)
          try {
            await handleCreateTag(inputValue)
          } catch (err) {
            console.error('[App] Failed to create tag:', err)
          }
        }}
        inputValue={inputValue}
        onInputChange={setInputValue}
        inputPlaceholder="Enter new tag name"
        confirmLabel="Create"
        confirmDisabled={!inputValue.trim()}
      >
        {pendingTaskOperation?.type === 'apply-tag' && pendingTaskOperation.taskIds.length > 0 && (
          <p className="modal-hint">
            This tag will be applied to {pendingTaskOperation.taskIds.length} task{pendingTaskOperation.taskIds.length > 1 ? 's' : ''}
          </p>
        )}
        
        {getAllTags(tasks).length > 0 && (
          <div className="modal-section">
            <label className="modal-label">Existing tags:</label>
            <div className="modal-tags-list">
              {getAllTags(tasks).map(tag => (
                <span key={tag} className="modal-tag-chip">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <ContextMenu
        isOpen={!!boardContextMenu}
        x={boardContextMenu?.x || 0}
        y={boardContextMenu?.y || 0}
        items={[
          {
            label: '🗑️ Delete Board',
            isDanger: true,
            onClick: async () => {
              if (!boardContextMenu) return
              const boardName = boards?.boards?.find(b => b.id === boardContextMenu.boardId)?.name || boardContextMenu.boardId
              if (confirm(`Delete board "${boardName}"? All tasks on this board will be permanently deleted.`)) {
                try {
                  await deleteBoard(boardContextMenu.boardId)
                  setBoardContextMenu(null)
                } catch (err) {
                  console.error('[App] Failed to delete board:', err)
                  alert((err as Error).message || 'Failed to delete board')
                }
              }
            }
          }
        ]}
      />

      <ContextMenu
        isOpen={!!tagContextMenu}
        x={tagContextMenu?.x || 0}
        y={tagContextMenu?.y || 0}
        className="tag-context-menu"
        items={[
          {
            label: '🗑️ Delete Tag',
            isDanger: true,
            onClick: async () => {
              console.log('[App] Delete Tag clicked!', { tagContextMenu })
              if (!tagContextMenu) {
                console.error('[App] No tagContextMenu when Delete Tag clicked!')
                return
              }
              try {
                console.log('[App] Calling clearTasksByTag for tag:', tagContextMenu.tag)
                await clearTasksByTag(tagContextMenu.tag)
                console.log('[App] clearTasksByTag completed successfully')
                setTagContextMenu(null)
              } catch (err) {
                console.error('[App] Failed to delete tag:', err)
                alert((err as Error).message || 'Failed to delete tag')
              }
            }
          }
        ]}
      />
      </div>
    </div>
  )
}
