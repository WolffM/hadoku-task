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
  const [theme, setTheme] = useState<'light' | 'dark' | 'strawberry' | 'ocean' | 'forest' | 'cyberpunk' | 'coffee' | 'lavender'>('light')
  const [showThemePicker, setShowThemePicker] = useState(false)
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

  // Close theme picker when clicking outside
  useEffect(() => {
    if (!showThemePicker) return
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.theme-picker')) {
        setShowThemePicker(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showThemePicker])

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

  // Get top tags for layout, including any persisted tags on the current board so empty-but-known tags remain available
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const persistedTags: string[] = (currentBoard as any)?.tags || []
  // For layout we only want tags derived from tasks so the layout collapses when empty
  const topTags = getTopTags(tasks, 6)

  return (
      <div className="task-app" 
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
      <div className="task-app__header-container">
        <h1 className="task-app__header">Tasks</h1>
        <div className="theme-picker">
          <button 
            className="theme-toggle-btn" 
            onClick={() => setShowThemePicker(!showThemePicker)}
            aria-label="Choose theme"
            title="Choose theme"
          >
            {theme === 'light' ? '☼' : 
             theme === 'dark' ? '☽' : 
             theme === 'strawberry' ? '❖' :
             theme === 'ocean' ? '≈' :
             theme === 'forest' ? '❦' :
             theme === 'cyberpunk' ? '◆' :
             theme === 'coffee' ? '◉' :
             '✿'}
          </button>
          {showThemePicker && (
            <div className="theme-picker__dropdown">
              <button 
                className={`theme-picker__option ${theme === 'light' ? 'active' : ''}`}
                onClick={() => { setTheme('light'); setShowThemePicker(false); }}
                title="Light theme"
              >
                ☼
              </button>
              <button 
                className={`theme-picker__option ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => { setTheme('dark'); setShowThemePicker(false); }}
                title="Dark theme"
              >
                ☽
              </button>
              <button 
                className={`theme-picker__option ${theme === 'strawberry' ? 'active' : ''}`}
                onClick={() => { setTheme('strawberry'); setShowThemePicker(false); }}
                title="Strawberry theme"
              >
                ❖
              </button>
              <button 
                className={`theme-picker__option ${theme === 'ocean' ? 'active' : ''}`}
                onClick={() => { setTheme('ocean'); setShowThemePicker(false); }}
                title="Ocean theme"
              >
                ≈
              </button>
              <button 
                className={`theme-picker__option ${theme === 'forest' ? 'active' : ''}`}
                onClick={() => { setTheme('forest'); setShowThemePicker(false); }}
                title="Forest theme"
              >
                ❦
              </button>
              <button 
                className={`theme-picker__option ${theme === 'cyberpunk' ? 'active' : ''}`}
                onClick={() => { setTheme('cyberpunk'); setShowThemePicker(false); }}
                title="Cyberpunk theme"
              >
                ◆
              </button>
              <button 
                className={`theme-picker__option ${theme === 'coffee' ? 'active' : ''}`}
                onClick={() => { setTheme('coffee'); setShowThemePicker(false); }}
                title="Coffee theme"
              >
                ◉
              </button>
              <button 
                className={`theme-picker__option ${theme === 'lavender' ? 'active' : ''}`}
                onClick={() => { setTheme('lavender'); setShowThemePicker(false); }}
                title="Lavender theme"
              >
                ✿
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
              className="board-add-btn" 
              onClick={() => {
                setInputValue('')
                setShowNewBoardDialog(true)
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
          className="task-app__filter-add" 
          onClick={() => {
            setInputValue('')
            setShowNewTagDialog(true)
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
            <input
              type="text"
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Board name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  const name = inputValue.trim()
                  setShowNewBoardDialog(false)
                  createBoard(name).catch(err => {
                    console.error('[App] Failed to create board:', err)
                  })
                }
                if (e.key === 'Escape') {
                  setShowNewBoardDialog(false)
                }
              }}
            />
            <div className="modal-actions">
              <button 
                className="modal-button"
                onClick={() => setShowNewBoardDialog(false)}
              >
                Cancel
              </button>
              <button 
                className="modal-button modal-button--primary"
                onClick={async () => {
                  if (!inputValue.trim()) return
                  const name = inputValue.trim()
                  setShowNewBoardDialog(false)
                  try {
                    await createBoard(name)
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
            <input
              type="text"
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Tag name (without #)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  const normalized = inputValue.trim().replace(/\s+/g, '-')
                  setShowNewTagDialog(false)
                  createTagOnBoard(normalized).catch(err => {
                    console.error('[App] Failed to create tag:', err)
                  })
                }
                if (e.key === 'Escape') {
                  setShowNewTagDialog(false)
                }
              }}
            />
            <div className="modal-actions">
              <button 
                className="modal-button"
                onClick={() => setShowNewTagDialog(false)}
              >
                Cancel
              </button>
              <button 
                className="modal-button modal-button--primary"
                onClick={async () => {
                  if (!inputValue.trim()) return
                  const normalized = inputValue.trim().replace(/\s+/g, '-')
                  setShowNewTagDialog(false)
                  try {
                    await createTagOnBoard(normalized)
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
    </div>
  )
}
