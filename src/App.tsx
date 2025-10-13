import React, { useEffect, useRef, useState } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks, SESSION_ID } from './hooks/useTasks'
import { useDragAndDrop } from './hooks/useDragAndDrop'
import { useTaskSort } from './hooks/useTaskSort'
import { TaskLayout } from './components/TaskLayout'
import { getTopTags, getAllTags } from './lib/tagUtils'

export default function App(props: TaskAppProps = {}) {
  const { basename = '/task', apiUrl, environment, userType = 'public', userId = 'public' } = props;
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set())
  const [customTags, setCustomTags] = useState<string[]>([])
  const [confirmClearTag, setConfirmClearTag] = useState<{tag: string, count: number} | null>(null)
  const [showNewBoardDialog, setShowNewBoardDialog] = useState(false)
  const [showNewTagDialog, setShowNewTagDialog] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark' | 'strawberry' | 'ocean' | 'cyberpunk' | 'coffee' | 'lavender'>('light')
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [boardContextMenu, setBoardContextMenu] = useState<{boardId: string, x: number, y: number} | null>(null)
  const [tagContextMenu, setTagContextMenu] = useState<{tag: string, x: number, y: number} | null>(null)
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // "public" is special: localStorage-only, no server. All other types sync to server.
  const isPublic = userType === 'public'

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
  } = useTasks({ userType, userId })

  // Drag and drop hook
  const dragAndDrop = useDragAndDrop({ 
    tasks, 
    onTaskUpdate: updateTaskTags,
    onBulkUpdate: bulkUpdateTaskTags
  })

  // Sort hook
  const sortHook = useTaskSort()

  // Initialize
  useEffect(() => {
    void initialLoad()
    inputRef.current?.focus()
  }, [userType])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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
      const pendingIds = (window as any).__pendingTagTaskIds as string[] | undefined
      if (pendingIds && pendingIds.length > 0) {
        // Build updates array - add the new tag to existing tags for each task
        const updates = pendingIds.map(taskId => {
          const task = tasks.find(t => t.id === taskId)
          const existingTags = task?.tag?.split(' ').filter(Boolean) || []
          const newTags = [...new Set([...existingTags, normalized])]
          return { taskId, tag: newTags.join(' ') }
        })
        
        // Apply the tag to all the dragged tasks
        await bulkUpdateTaskTags(updates)
        // Clear selection after tagging
        dragAndDrop.clearSelection()
        // Clear the pending IDs
        delete (window as any).__pendingTagTaskIds
      }
    } catch (err) {
      console.error('[App] Failed to create tag:', err)
      throw err
    }
  }

  // Handle board creation and optionally move pending tasks
  async function handleCreateBoard(boardName: string) {
    const name = boardName.trim()
    try {
      // Check if we have pending task IDs to move (from drag-and-drop)
      const pendingIds = (window as any).__pendingBoardTaskIds as string[] | undefined
      
      // Always create the board first
      await createBoard(name)
      
      if (pendingIds && pendingIds.length > 0) {
        // Move all the dragged tasks to the new board
        // Note: at this point we're already on the new board (createBoard switched us)
        // but it's empty. moveTasksToBoard will move tasks and reload.
        await moveTasksToBoard(name, pendingIds)
        
        // Clear selection after moving
        dragAndDrop.clearSelection()
        
        // Clear the pending IDs
        delete (window as any).__pendingBoardTaskIds
      }
    } catch (err) {
      console.error('[App] Failed to create board:', err)
      throw err
    }
  }

  // Get top tags for layout, including any persisted tags on the current board so empty-but-known tags remain available
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const persistedTags: string[] = (currentBoard as any)?.tags || []
  // For layout we only want tags derived from tasks so the layout collapses when empty
  const topTags = getTopTags(tasks, 6)

  return (
    <div
      style={{ minHeight: '100vh', width: '100%' }}
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
            try {
              const justEnded = (dragAndDrop as any).selectionJustEndedAt as number | null
              if (justEnded && Date.now() - justEnded < 300) {
                return
              }
            } catch {}
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
            {theme === 'light' ? '☀️' : 
             theme === 'dark' ? '🌙' : 
             theme === 'strawberry' ? '🍓' :
             theme === 'ocean' ? '🌊' :
             theme === 'cyberpunk' ? '🤖' :
             theme === 'coffee' ? '☕' :
             '🪻'}
          </button>
          {showThemePicker && (
            <div className="theme-picker__dropdown">
              <button 
                className={`theme-picker__option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => { setTheme('light'); setShowThemePicker(false); }}
                title="Light theme"
              >
                ☀️
              </button>
              <button 
                className={`theme-picker__option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => { setTheme('dark'); setShowThemePicker(false); }}
                title="Dark theme"
              >
                🌙
              </button>
              <button 
                className={`theme-picker__option ${theme === 'strawberry' ? 'active' : ''}`}
                onClick={() => { setTheme('strawberry'); setShowThemePicker(false); }}
                title="Strawberry theme"
              >
                🍓
              </button>
              <button 
                className={`theme-picker__option ${theme === 'ocean' ? 'active' : ''}`}
                onClick={() => { setTheme('ocean'); setShowThemePicker(false); }}
                title="Ocean theme"
              >
                🌊
              </button>
              <button 
                className={`theme-picker__option ${theme === 'cyberpunk' ? 'active' : ''}`}
                onClick={() => { setTheme('cyberpunk'); setShowThemePicker(false); }}
                title="Cyberpunk theme"
              >
                🤖
              </button>
              <button 
                className={`theme-picker__option ${theme === 'coffee' ? 'active' : ''}`}
                onClick={() => { setTheme('coffee'); setShowThemePicker(false); }}
                title="Coffee theme"
              >
                ☕
              </button>
              <button 
                className={`theme-picker__option ${theme === 'lavender' ? 'active' : ''}`}
                onClick={() => { setTheme('lavender'); setShowThemePicker(false); }}
                title="Lavender theme"
              >
                🪻
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="task-app__boards">
        {/* Render up to 5 board buttons, highlight active */}
        <div className="task-app__board-list">
          {(boards && boards.boards ? boards.boards.slice(0, 5) : [{ id: 'main', name: 'main' }]).map(b => (
            <button
              key={b.id}
              className={`board-btn ${currentBoardId === b.id ? 'board-btn--active' : ''} ${dragAndDrop.dragOverFilter === `board:${b.id}` ? 'board-btn--drag-over' : ''}`}
              onClick={() => switchBoard(b.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (b.id === 'main') return // Don't allow deleting main board
                setBoardContextMenu({ boardId: b.id, x: e.clientX, y: e.clientY })
              }}
              onTouchStart={(e) => {
                if (b.id === 'main') return
                const timer = setTimeout(() => {
                  const touch = e.touches[0]
                  setBoardContextMenu({ boardId: b.id, x: touch.clientX, y: touch.clientY })
                }, 500) // 500ms long-press
                setLongPressTimer(timer)
              }}
              onTouchEnd={() => {
                if (longPressTimer) {
                  clearTimeout(longPressTimer)
                  setLongPressTimer(null)
                }
              }}
              onTouchMove={() => {
                if (longPressTimer) {
                  clearTimeout(longPressTimer)
                  setLongPressTimer(null)
                }
              }}
              aria-pressed={currentBoardId === b.id}
              onDragOver={(e) => {
                // Indicate this board can accept drops
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                // set a temporary state by using dragOverFilter semantic to indicate board hover
                try { (dragAndDrop as any).setDragOverFilter?.(`board:${b.id}`) } catch {}
              }}
              onDragLeave={(e) => {
                try { (dragAndDrop as any).setDragOverFilter?.(null) } catch {}
              }}
              onDrop={async (e) => {
                e.preventDefault()
                try { (dragAndDrop as any).setDragOverFilter?.(null) } catch {}
                // read our custom payload
                let ids: string[] = []
                try {
                  const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
                  if (raw) ids = JSON.parse(raw)
                } catch {}
                if (ids.length === 0) {
                  const t = e.dataTransfer.getData('text/plain')
                  if (t) ids = [t]
                }
                if (ids.length === 0) return
                try {
                  await moveTasksToBoard(b.id, ids)
                  try { dragAndDrop.clearSelection() } catch {}
                } catch (err) {
                  console.error('Failed moving tasks to board', err)
                  alert((err as Error).message || 'Failed to move tasks')
                }
              }}
            >
              {b.name}
            </button>
          ))}
        </div>

        <div className="task-app__board-actions">
          {/* Only show + if we have fewer than 5 boards */}
          {(!boards || (boards.boards && boards.boards.length < 5)) && (
            <button 
              className={`board-add-btn ${dragAndDrop.dragOverFilter === 'add-board' ? 'board-btn--drag-over' : ''}`}
              onClick={() => {
                setInputValue('')
                setShowNewBoardDialog(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                try { (dragAndDrop as any).setDragOverFilter?.('add-board') } catch {}
              }}
              onDragLeave={(e) => {
                try { (dragAndDrop as any).setDragOverFilter?.(null) } catch {}
              }}
              onDrop={async (e) => {
                e.preventDefault()
                try { (dragAndDrop as any).setDragOverFilter?.(null) } catch {}
                
                // Get task IDs from drag data
                let ids: string[] = []
                try {
                  const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
                  if (raw) ids = JSON.parse(raw)
                } catch {}
                if (ids.length === 0) {
                  const t = e.dataTransfer.getData('text/plain')
                  if (t) ids = [t]
                }
                
                if (ids.length > 0) {
                  // Open dialog and store the task IDs to move after creation
                  setInputValue('')
                  ;(window as any).__pendingBoardTaskIds = ids
                  setShowNewBoardDialog(true)
                }
              }}
              aria-label="Create board"
            >＋</button>
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
          const all = Array.from(new Set([...persistedTags, ...derived, ...customTags]))
          return all.map(tag => {
          const on = selectedFilters.has(tag)
          return (
            <button
              key={tag}
              onClick={() => {
                setSelectedFilters(prev => {
                  const copy = new Set(prev)
                  if (copy.has(tag)) copy.delete(tag)
                  else copy.add(tag)
                  return copy
                })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setTagContextMenu({ tag, x: e.clientX, y: e.clientY })
              }}
              onTouchStart={(e) => {
                const timer = setTimeout(() => {
                  const touch = e.touches[0]
                  setTagContextMenu({ tag, x: touch.clientX, y: touch.clientY })
                }, 500)
                setLongPressTimer(timer)
              }}
              onTouchEnd={() => {
                if (longPressTimer) {
                  clearTimeout(longPressTimer)
                  setLongPressTimer(null)
                }
              }}
              onTouchMove={() => {
                if (longPressTimer) {
                  clearTimeout(longPressTimer)
                  setLongPressTimer(null)
                }
              }}
              className={`${on ? 'on' : ''} ${dragAndDrop.dragOverFilter === tag ? 'task-app__filter-drag-over' : ''}`}
              onDragOver={(e) => dragAndDrop.onFilterDragOver(e, tag)}
              onDragLeave={dragAndDrop.onFilterDragLeave}
              onDrop={(e) => dragAndDrop.onFilterDrop(e, tag)}
            >
              #{tag}
            </button>
          )
          })
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
            
            // Get task IDs from drag data
            let ids: string[] = []
            try {
              const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
              if (raw) ids = JSON.parse(raw)
            } catch {}
            if (ids.length === 0) {
              const t = e.dataTransfer.getData('text/plain')
              if (t) ids = [t]
            }
            
            if (ids.length > 0) {
              // Open dialog and store the task IDs to tag after creation
              setInputValue('')
              ;(window as any).__pendingTagTaskIds = ids
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
        <div className="marquee-overlay" style={{ left: dragAndDrop.marqueeRect.x, top: dragAndDrop.marqueeRect.y, width: dragAndDrop.marqueeRect.w, height: dragAndDrop.marqueeRect.h }} />
      )}

      {confirmClearTag && (
        <div 
          className="modal-overlay"
          onClick={() => setConfirmClearTag(null)}
        >
          <div 
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Clear Tag #{confirmClearTag.tag}?</h3>
            <p>
              This will remove <strong>#{confirmClearTag.tag}</strong> from{' '}
              <strong>{confirmClearTag.count} task(s)</strong> and delete the tag from the board.
            </p>
            <div className="modal-actions">
              <button 
                className="modal-button"
                onClick={() => setConfirmClearTag(null)}
              >
                Cancel
              </button>
              <button 
                className="modal-button modal-button--danger"
                onClick={async () => {
                  const tag = confirmClearTag.tag
                  setConfirmClearTag(null)
                  await clearTasksByTag(tag)
                }}
              >
                Clear Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewBoardDialog && (
        <div 
          className="modal-overlay"
          onClick={() => setShowNewBoardDialog(false)}
        >
          <div 
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Create New Board</h3>
            
            {(() => {
              const pendingIds = (window as any).__pendingBoardTaskIds as string[] | undefined
              if (pendingIds && pendingIds.length > 0) {
                return (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 0 }}>
                    {pendingIds.length} task{pendingIds.length > 1 ? 's' : ''} will be moved to this board
                  </p>
                )
              }
              return null
            })()}
            
            <input
              type="text"
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Board name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  setShowNewBoardDialog(false)
                  handleCreateBoard(inputValue).catch(err => {
                    console.error('[App] Failed to create board:', err)
                  })
                }
                if (e.key === 'Escape') {
                  setShowNewBoardDialog(false)
                  // Clear pending task IDs if dialog is cancelled
                  delete (window as any).__pendingBoardTaskIds
                }
              }}
            />
            <div className="modal-actions">
              <button 
                className="modal-button"
                onClick={() => {
                  setShowNewBoardDialog(false)
                  // Clear pending task IDs if dialog is cancelled
                  delete (window as any).__pendingBoardTaskIds
                }}
              >
                Cancel
              </button>
              <button 
                className="modal-button modal-button--primary"
                onClick={async () => {
                  if (!inputValue.trim()) return
                  setShowNewBoardDialog(false)
                  try {
                    await handleCreateBoard(inputValue)
                  } catch (err) {
                    console.error('[App] Failed to create board:', err)
                  }
                }}
                disabled={!inputValue.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewTagDialog && (
        <div 
          className="modal-overlay"
          onClick={() => setShowNewTagDialog(false)}
        >
          <div 
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Create New Tag</h3>
            
            {(() => {
              const pendingIds = (window as any).__pendingTagTaskIds as string[] | undefined
              if (pendingIds && pendingIds.length > 0) {
                return (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 0 }}>
                    This tag will be applied to {pendingIds.length} task{pendingIds.length > 1 ? 's' : ''}
                  </p>
                )
              }
              return null
            })()}
            
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
            
            <input
              type="text"
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter new tag name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  setShowNewTagDialog(false)
                  handleCreateTag(inputValue).catch(err => {
                    console.error('[App] Failed to create tag:', err)
                  })
                }
                if (e.key === 'Escape') {
                  setShowNewTagDialog(false)
                  // Clear pending task IDs if dialog is cancelled
                  delete (window as any).__pendingTagTaskIds
                }
              }}
            />
            <div className="modal-actions">
              <button 
                className="modal-button"
                onClick={() => {
                  setShowNewTagDialog(false)
                  // Clear pending task IDs if dialog is cancelled
                  delete (window as any).__pendingTagTaskIds
                }}
              >
                Cancel
              </button>
              <button 
                className="modal-button modal-button--primary"
                onClick={async () => {
                  if (!inputValue.trim()) return
                  setShowNewTagDialog(false)
                  try {
                    await handleCreateTag(inputValue)
                  } catch (err) {
                    console.error('[App] Failed to create tag:', err)
                  }
                }}
                disabled={!inputValue.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board context menu */}
      {boardContextMenu && (
        <div 
          className="board-context-menu"
          style={{
            position: 'fixed',
            left: `${boardContextMenu.x}px`,
            top: `${boardContextMenu.y}px`,
          }}
        >
          <button
            className="context-menu-item context-menu-item--danger"
            onClick={async () => {
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
            }}
          >
            🗑️ Delete Board
          </button>
        </div>
      )}

      {/* Tag context menu */}
      {tagContextMenu && (
        <div 
          className="tag-context-menu"
          style={{
            position: 'fixed',
            left: `${tagContextMenu.x}px`,
            top: `${tagContextMenu.y}px`,
          }}
        >
          <button
            className="context-menu-item context-menu-item--danger"
            onClick={async () => {
              const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tagContextMenu.tag))
              if (confirm(`Delete tag "${tagContextMenu.tag}" and remove it from ${tagTasks.length} task(s)?`)) {
                try {
                  await clearTasksByTag(tagContextMenu.tag)
                  setTagContextMenu(null)
                } catch (err) {
                  console.error('[App] Failed to delete tag:', err)
                  alert((err as Error).message || 'Failed to delete tag')
                }
              }
            }}
          >
            🗑️ Delete Tag
          </button>
        </div>
      )}
      </div>
    </div>
  )
}
