import React, { useEffect, useRef, useState, useMemo } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks } from '../hooks/useTasks'
import { useDragAndDrop } from '../hooks/useDragAndDrop'
import { useTaskSort } from '../hooks/useTaskSort'
import { BoardButton } from '../components/BoardButton'
import { TagFilterButton } from '../components/TagFilterButton'
import { TaskLayout } from '../components/TaskLayout'
import { Modal } from '../components/Modal'
import { ContextMenu } from '../components/ContextMenu'
import { SettingsIcon } from '../components/ThemeIcons'
import { getTopTags, getAllTags } from '../domain/utils/tags'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import { createApi } from '../api/client'
import { getRandomPlaceholder } from '../utils/placeholders'
import { useIsMobile } from '../hooks/useIsMobile'
import type { ThemeName, UserPreferences } from './types'
import { getThemeFamilies, getThemeIcon } from './themeConfig'

// UI Configuration
const MAX_BOARDS = 5 // Maximum number of boards to display in the board list

export default function App(props: TaskAppProps = {}) {
  const { userType = 'public', userId = 'public', sessionId } = props;
  const isMobileDevice = useIsMobile()
  const [placeholder] = useState(() => getRandomPlaceholder())
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
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [preferences, setPreferences] = useState<UserPreferences>({
    version: 1,
    updatedAt: new Date().toISOString(),
    experimentalThemes: false,
    alwaysVerticalLayout: false,
    // Device-specific defaults
    theme: 'light',
    showCompleteButton: true,
    showDeleteButton: true,
    showTagButton: false
  })
  
  // Convenience getters for device-specific preferences
  const theme = (preferences.theme || 'light') as ThemeName
  const showCompleteButton = preferences.showCompleteButton ?? true
  const showDeleteButton = preferences.showDeleteButton ?? true
  const showTagButton = preferences.showTagButton ?? false
  
  // Convenience setters for device-specific preferences
  const setTheme = (newTheme: ThemeName) => savePreferences({ theme: newTheme })
  const setShowCompleteButton = (show: boolean) => savePreferences({ showCompleteButton: show })
  const setShowDeleteButton = (show: boolean) => savePreferences({ showDeleteButton: show })
  const setShowTagButton = (show: boolean) => savePreferences({ showTagButton: show })
  
  const [newUserId, setNewUserId] = useState('')
  const [newKey, setNewKey] = useState('')
  const [keyValidationError, setKeyValidationError] = useState<string | null>(null)
  const [isChangingUserId, setIsChangingUserId] = useState(false)
  const [userIdError, setUserIdError] = useState<string | null>(null)
  const [isValidatingKey, setIsValidatingKey] = useState(false)
  const [boardContextMenu, setBoardContextMenu] = useState<{boardId: string, x: number, y: number} | null>(null)
  const [tagContextMenu, setTagContextMenu] = useState<{tag: string, x: number, y: number} | null>(null)
  const [editTagModal, setEditTagModal] = useState<{ taskId: string; currentTag: string | null } | null>(null)
  const [editTagInput, setEditTagInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const themePickerRef = useRef<HTMLDivElement>(null)

  // Apply vertical layout preference
  const isMobile = isMobileDevice || (preferences.alwaysVerticalLayout || false)

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
    deleteTag,
    
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

  // Compute theme families based on experimental preferences
  const THEME_FAMILIES = useMemo(() => 
    getThemeFamilies(preferences.experimentalThemes || false),
    [preferences.experimentalThemes]
  )

  // Load user preferences on mount (before anything else)
  useEffect(() => {
    const loadPreferences = async () => {
      console.log('[App] Loading preferences...', { userType, userId, sessionId })
      const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
      const prefs = await api.getPreferences()
      console.log('[App] Loaded preferences:', prefs)
      if (prefs) {
        setPreferences(prefs)
        console.log('[App] Applied preferences to state')
      }
      setPreferencesLoaded(true)
    }
    void loadPreferences()
  }, [userType, userId, sessionId])

  // Save user preferences when they change
  const savePreferences = async (updates: Partial<UserPreferences>) => {
    const newPrefs = { ...preferences, ...updates, updatedAt: new Date().toISOString() }
    setPreferences(newPrefs)
    const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
    await api.savePreferences(newPrefs)
  }

  // Handle userId change
  const handleUserIdChange = async () => {
    if (!newUserId.trim() || isChangingUserId) return
    
    setIsChangingUserId(true)
    setUserIdError(null)
    
    try {
      const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
      const result = await api.setUserId(newUserId.trim())
      
      if (result.ok) {
        // Success - store in sessionStorage for display
        sessionStorage.setItem('displayUserId', newUserId.trim())
        setUserIdError(null)
        setShowSettingsModal(false)
        setNewUserId('')
      } else {
        setUserIdError(result.message || 'Failed to update user ID')
      }
    } catch (err) {
      setUserIdError('Failed to update user ID')
    } finally {
      setIsChangingUserId(false)
    }
  }

  // Handle key validation and change
  const handleKeyChange = async () => {
    if (!newKey.trim() || isValidatingKey) return
    
    setIsValidatingKey(true)
    setKeyValidationError(null)
    
    try {
      // Use the API client to validate the key
      const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
      const isValid = await api.validateKey(newKey.trim())
      
      if (isValid) {
        // Valid key - reload page with new key parameter
        const url = new URL(window.location.href)
        url.searchParams.set('key', newKey.trim())
        window.location.href = url.toString()
      } else {
        setKeyValidationError('Invalid key')
        setIsValidatingKey(false)
      }
    } catch (err) {
      setKeyValidationError('Failed to validate key')
      setIsValidatingKey(false)
    }
  }

  // Migration: Move theme and button settings from sessionStorage to localStorage (one-time)
  useEffect(() => {
    const migrateFromSessionStorage = () => {
      try {
        const sessionTheme = sessionStorage.getItem('theme')
        const sessionComplete = sessionStorage.getItem('showCompleteButton')
        const sessionDelete = sessionStorage.getItem('showDeleteButton')
        const sessionTag = sessionStorage.getItem('showTagButton')
        
        const migrations: Partial<UserPreferences> = {}
        
        if (sessionTheme && !preferences.theme) {
          migrations.theme = sessionTheme
        }
        if (sessionComplete !== null && preferences.showCompleteButton === undefined) {
          migrations.showCompleteButton = sessionComplete === 'true'
        }
        if (sessionDelete !== null && preferences.showDeleteButton === undefined) {
          migrations.showDeleteButton = sessionDelete === 'true'
        }
        if (sessionTag !== null && preferences.showTagButton === undefined) {
          migrations.showTagButton = sessionTag === 'true'
        }
        
        if (Object.keys(migrations).length > 0) {
          console.log('[App] Migrating settings from sessionStorage to localStorage:', migrations)
          const newPrefs = { ...preferences, ...migrations, updatedAt: new Date().toISOString() }
          setPreferences(newPrefs)
          
          // Clean up old sessionStorage values
          sessionStorage.removeItem('theme')
          sessionStorage.removeItem('showCompleteButton')
          sessionStorage.removeItem('showDeleteButton')
          sessionStorage.removeItem('showTagButton')
        }
      } catch (error) {
        console.warn('[App] Failed to migrate settings:', error)
      }
    }
    
    migrateFromSessionStorage()
  }, [preferences.theme, preferences.showCompleteButton, preferences.showDeleteButton, preferences.showTagButton])

  // Close theme picker when clicking outside
  useEffect(() => {
    if (!showThemePicker) return

    const handleClickOutside = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setShowThemePicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showThemePicker])

  // Auto-switch theme variant when Dark Reader / system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleColorSchemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const prefersDark = e.matches
      
      // Extract theme family and current mode
      const themeFamily = theme.replace(/-light$|-dark$/, '') as string
      const currentMode = theme.endsWith('-dark') ? 'dark' : theme.endsWith('-light') ? 'light' : null
      
      // Only auto-switch if we have a themed family (not base light/dark)
      if (currentMode && themeFamily !== 'light' && themeFamily !== 'dark') {
        const targetMode = prefersDark ? 'dark' : 'light'
        
        if (currentMode !== targetMode) {
          const newTheme = `${themeFamily}-${targetMode}` as ThemeName
          console.log(`[Theme] Auto-switching from ${theme} to ${newTheme} (Dark Reader/system preference)`)
          setTheme(newTheme)
        }
      }
    }
    
    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleColorSchemeChange)
    } else {
      mediaQuery.addListener(handleColorSchemeChange)
    }
    
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleColorSchemeChange)
      } else {
        mediaQuery.removeListener(handleColorSchemeChange)
      }
    }
  }, [theme])

  // Clear tag filters when switching boards
  useEffect(() => {
    setSelectedFilters(new Set())
  }, [currentBoardId])

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

  // Wrapper for deleteTag that shows confirmation dialog
  function handleDeleteTag(tag: string) {
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

  // Handle edit tag modal open
  function handleEditTag(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setEditTagModal({ taskId, currentTag: task.tag || null })
      setEditTagInput('') // Input is only for NEW tags, not existing ones
    }
  }

  // Handle tag update from edit modal
  async function handleUpdateTag() {
    if (!editTagModal) return
    
    const { taskId, currentTag } = editTagModal
    
    // Get current tags from the task
    const currentTags = currentTag?.split(' ').filter(Boolean) || []
    
    // Get new tags from input (normalize like handleCreateTag does)
    const newTagsFromInput = editTagInput.trim()
      ? editTagInput.trim().replace(/\s+/g, '-').split('#').filter(Boolean).map(t => t.trim())
      : []
    
    // Create new tags on the board first (so they appear in pills next time)
    for (const newTag of newTagsFromInput) {
      await createTagOnBoard(newTag)
    }
    
    // Combine current tags with new tags from input, sort alphabetically
    const allTags = [...new Set([...currentTags, ...newTagsFromInput])].sort()
    const finalTag = allTags.join(' ')
    
    // Update task with combined tags
    await updateTaskTags(taskId, { tag: finalTag })
    
    // Close modal
    setEditTagModal(null)
    setEditTagInput('')
  }

  // Toggle tag pill in edit modal
  function toggleTagPill(tag: string) {
    if (!editTagModal) return
    
    const { taskId, currentTag } = editTagModal
    const currentTags = currentTag?.split(' ').filter(Boolean) || []
    const tagExists = currentTags.includes(tag)
    
    if (tagExists) {
      // Remove tag, keep sorted
      const newTags = currentTags.filter(t => t !== tag).sort().join(' ')
      setEditTagModal({ taskId, currentTag: newTags })
    } else {
      // Add tag, keep sorted
      const newTags = [...currentTags, tag].sort().join(' ')
      setEditTagModal({ taskId, currentTag: newTags })
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
  // On mobile, show only top 3 tags; on desktop, show top 6
  const topTags = getTopTags(tasks, isMobile ? 3 : 6)

  // Determine if current theme is dark variant
  const isDarkTheme = theme.endsWith('-dark') || theme === 'dark'

  // Don't render until preferences are loaded to avoid theme flash
  if (!preferencesLoaded) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="task-app-container"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
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
        <h1 
          className="task-app__header" 
          onClick={() => setShowSettingsModal(true)}
          style={{ cursor: 'pointer' }}
          title="Settings"
        >
          Tasks{userType !== 'public' ? ` - ${userId || 'user'}` : ''}
        </h1>
        <div className="theme-picker" ref={themePickerRef}>
          <button 
            className="theme-toggle-btn" 
            onClick={() => setShowThemePicker(!showThemePicker)}
            aria-label="Choose theme"
            title="Choose theme"
          >
            {getThemeIcon(theme, preferences.experimentalThemes || false)}
          </button>
          {showThemePicker && (
            <div className="theme-picker__dropdown">
              <div className="theme-picker__pills">
                {THEME_FAMILIES.map((family, idx) => (
                  <div key={idx} className="theme-pill">
                    {/* Light variant button */}
                    <button
                      className={`theme-pill__btn theme-pill__btn--light ${theme === family.lightTheme ? 'active' : ''}`}
                      onClick={() => setTheme(family.lightTheme)}
                      title={family.lightLabel}
                      aria-label={family.lightLabel}
                    >
                      <div className="theme-pill__icon">
                        {family.lightIcon}
                      </div>
                    </button>
                    
                    {/* Dark variant button */}
                    <button
                      className={`theme-pill__btn theme-pill__btn--dark ${theme === family.darkTheme ? 'active' : ''}`}
                      onClick={() => setTheme(family.darkTheme)}
                      title={family.darkLabel}
                      aria-label={family.darkLabel}
                    >
                      <div className="theme-pill__icon">
                        {family.darkIcon}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
              {/* Settings button - separate column on the right */}
              <button
                className="theme-picker__settings-icon"
                onClick={() => {
                  setShowSettingsModal(true)
                  setShowThemePicker(false)
                }}
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon />
              </button>
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
              className={`sync-btn ${isSyncing ? 'spinning' : ''}`}
              onClick={async (e) => {
                if (isSyncing) return
                console.log('[App] Manual refresh triggered')
                setIsSyncing(true)
                
                // Store button reference before async operation
                const button = e.currentTarget as HTMLButtonElement
                
                // Create a timeout promise (5 seconds)
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('Sync timeout')), 5000)
                })
                
                try {
                  // Race between initialLoad and timeout
                  await Promise.race([initialLoad(), timeoutPromise])
                  console.log('[App] Sync completed successfully')
                } catch (error) {
                  console.error('[App] Sync failed:', error)
                  // Error is handled, just log it
                } finally {
                  setIsSyncing(false)
                  // Remove focus after sync completes (check if button still exists)
                  if (button) {
                    button.blur()
                  }
                }
              }}
              disabled={isSyncing}
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
        onAddTag={addTagToTask}
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

      <Modal
        isOpen={!!confirmClearTag}
        title={`Clear Tag #${confirmClearTag?.tag}?`}
        onClose={() => setConfirmClearTag(null)}
        onConfirm={async () => {
          if (!confirmClearTag) return
          const tag = confirmClearTag.tag
          setConfirmClearTag(null)
          await deleteTag(tag)
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

      {/* Settings Modal */}
      <Modal
        isOpen={showSettingsModal}
        title="Settings"
        onClose={() => setShowSettingsModal(false)}
        onConfirm={() => setShowSettingsModal(false)}
        confirmLabel="Close"
        cancelLabel="Close"
      >
        {/* User Management Section */}
        <div className="settings-section">
          <h4 className="settings-section-title">User Management</h4>
          
          <div className="settings-field">
            <label className="settings-field-label">Current User ID</label>
            <div className="settings-field-input-group">
              <input
                type="text"
                className="settings-text-input"
                value={newUserId || userId}
                onChange={(e) => setNewUserId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newUserId && newUserId !== userId && userType !== 'public' && !isChangingUserId) {
                    handleUserIdChange()
                  }
                }}
                placeholder={userType === 'public' ? 'public' : userId}
                disabled={userType === 'public' || isChangingUserId}
              />
              {newUserId && newUserId !== userId && userType !== 'public' && (
                <button 
                  className="settings-field-button"
                  onClick={handleUserIdChange}
                  disabled={isChangingUserId}
                >
                  {isChangingUserId ? (
                    <span className="spinner"></span>
                  ) : (
                    '↵'
                  )}
                </button>
              )}
            </div>
            {userIdError && (
              <div className="settings-error-message">{userIdError}</div>
            )}
          </div>

          <div className="settings-field">
            <label className="settings-field-label">Enter New Key</label>
            <div className="settings-field-input-group">
              <input
                type="password"
                name="key"
                autoComplete="key"
                className="settings-text-input"
                value={newKey}
                onChange={(e) => {
                  setNewKey(e.target.value)
                  setKeyValidationError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKey && !isValidatingKey) {
                    handleKeyChange()
                  }
                }}
                placeholder="Enter authentication key"
                disabled={isValidatingKey}
              />
              {newKey && (
                <button 
                  className="settings-field-button"
                  onClick={handleKeyChange}
                  disabled={isValidatingKey}
                >
                  {isValidatingKey ? (
                    <span className="spinner"></span>
                  ) : (
                    '↵'
                  )}
                </button>
              )}
            </div>
            {keyValidationError && (
              <span className="settings-error">{keyValidationError}</span>
            )}
          </div>
        </div>

        {/* Preferences Section */}
        <div className="settings-section">
          <h4 className="settings-section-title">Preferences</h4>
          
          <label className="settings-option">
            <input
              type="checkbox"
              checked={preferences.experimentalThemes || false}
              onChange={(e) => {
                savePreferences({ experimentalThemes: e.target.checked })
              }}
            />
            <span className="settings-label">
              <strong>Experimental Themes</strong>
              <span className="settings-description">Enable access to experimental theme options</span>
            </span>
          </label>

          <label className="settings-option">
            <input
              type="checkbox"
              checked={preferences.alwaysVerticalLayout || false}
              onChange={(e) => {
                savePreferences({ alwaysVerticalLayout: e.target.checked })
              }}
            />
            <span className="settings-label">
              <strong>Always Use Vertical Layout</strong>
              <span className="settings-description">Use mobile-style vertical task layout on all devices</span>
            </span>
          </label>

          <label className="settings-option">
            <input
              type="checkbox"
              checked={!showCompleteButton}
              onChange={(e) => {
                savePreferences({ showCompleteButton: !e.target.checked })
              }}
            />
            <span className="settings-label">
              <strong>Disable Complete Button</strong>
              <span className="settings-description">Hide the checkmark (✓) button on task items</span>
            </span>
          </label>

          <label className="settings-option">
            <input
              type="checkbox"
              checked={!showDeleteButton}
              onChange={(e) => {
                savePreferences({ showDeleteButton: !e.target.checked })
              }}
            />
            <span className="settings-label">
              <strong>Disable Delete Button</strong>
              <span className="settings-description">Hide the delete (×) button on task items</span>
            </span>
          </label>

          <label className="settings-option">
            <input
              type="checkbox"
              checked={showTagButton}
              onChange={(e) => {
                savePreferences({ showTagButton: e.target.checked })
              }}
            />
            <span className="settings-label">
              <strong>Enable Tag Button</strong>
              <span className="settings-description">Show tag button on task items</span>
            </span>
          </label>
        </div>
      </Modal>

      {/* Edit Tag Modal */}
      <Modal
        isOpen={!!editTagModal}
        title="Edit Tags"
        onClose={() => {
          setEditTagModal(null)
          setEditTagInput('')
        }}
        onConfirm={handleUpdateTag}
        confirmLabel="Save"
        cancelLabel="Cancel"
      >
        <div className="edit-tag-modal">
          {/* Show existing board tags as clickable pills */}
          {boards?.boards?.find(b => b.id === currentBoardId)?.tags && boards.boards.find(b => b.id === currentBoardId)!.tags!.length > 0 && (
            <div className="edit-tag-pills">
              <label className="edit-tag-label">Select Tags</label>
              <div className="edit-tag-pills-container">
                {[...boards.boards.find(b => b.id === currentBoardId)!.tags!].sort().map(tag => {
                  const currentTags = editTagModal?.currentTag?.split(' ').filter(Boolean) || []
                  const isActive = currentTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      className={`edit-tag-pill ${isActive ? 'active' : ''}`}
                      onClick={() => toggleTagPill(tag)}
                      type="button"
                    >
                      #{tag}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="edit-tag-field">
            <label className="edit-tag-label">Add New Tag</label>
            <input
              type="text"
              className="edit-tag-input"
              value={editTagInput}
              onChange={(e) => {
                // Just store raw input, normalization happens on save
                setEditTagInput(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleUpdateTag()
                }
              }}
              placeholder="Enter a tag"
              autoFocus
            />
            <div className="edit-tag-hint">
              <div>"one tag" → #one-tag</div>
              <div>"#two #tags" → #two #tags</div>
            </div>
          </div>
        </div>
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
                console.log('[App] Calling deleteTag for tag:', tagContextMenu.tag)
                await deleteTag(tagContextMenu.tag)
                console.log('[App] deleteTag completed successfully')
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
