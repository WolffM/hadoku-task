/**
 *
 * Main App component
 *
 */

import React, { useEffect, useRef, useState } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks } from '../hooks/useTasks'
import { useDragAndDrop } from '../hooks/useDragAndDrop'
import { useTaskSort } from '../hooks/useTaskSort'
import { usePreferences } from '../hooks/usePreferences'
import { useTheme } from '../hooks/useTheme'
import { hasAdvanced } from '@wolffm/themes'
import { useClickOutside } from '../hooks/useClickOutside'
import { useModalState } from '../hooks/useModalState'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator'
import { isMobileApp } from '../utils/platform'
import { useTaskHandlers } from '../hooks/useTaskHandlers'
import { useSessionInitialization } from '../hooks/useSessionInitialization'
import { useToast, Toaster } from '@wolffm/task-ui-components'
import { logger } from '@wolffm/logger/client'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { AppHeader, ConnectedThemePicker } from '@wolffm/task-ui-components'
import { TaskPreferencesSection } from '../components/TaskPreferencesSection'
import { getThemeIcon } from './themeConfig'
import type { ThemeName } from './types'
import { BoardsSection } from '../components/BoardsSection'
import { ViewSwitcher, type ViewType } from '../components/ViewSwitcher'
import { TagFiltersSection } from '../components/TagFiltersSection'
import { TaskLayout } from '../components/TaskLayout'
// Eager import: lazy() pointed at a dynamic chunk that broke when index.js
// got cached in WebViews across deploys (chunk hashes change every build).
// The component is ~8 kB; not worth the deployment fragility.
import { CalendarDayView } from '../components/calendar/CalendarDayView'
import { MarqueeOverlay } from '../components/MarqueeOverlay'
import { AppModals } from '../components/AppModals'
import { getTopTags, getAllTags, formatError } from '../domain/utils/tags'
import { getRandomPlaceholder } from '../utils/placeholders'
import { saveTaskPreferences } from '../prefs/taskPrefs'
import type { UserPreferences } from '../domain/types'
import { MARQUEE_CLICK_GRACE_PERIOD } from './constants'

export default function App(props: TaskAppProps = {}) {
  const {
    userType = 'public',
    sessionId: propsSessionId = 'public',
    onKeyValidation: _onKeyValidation,
    theme: initialTheme
  } = props

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
  // Detect once at mount — UA doesn't change during a session
  const [isInMobileApp] = useState(() => isMobileApp())
  const [placeholder] = useState(() => getRandomPlaceholder())
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set())
  const [isLoaded, setIsLoaded] = useState(false)
  const [currentView, setCurrentView] = useState<ViewType>('board')
  const [calendarDate, setCalendarDate] = useState(() => new Date())

  // Initialize effectiveSessionId immediately for public users to prevent storage churn
  const [effectiveSessionId, setEffectiveSessionId] = useState(() => {
    // For public users, use stored sessionId immediately if available
    if (userType === 'public') {
      const stored =
        typeof window !== 'undefined' ? localStorage.getItem('hadoku_session_id') : null
      return stored || propsSessionId
    }
    return propsSessionId
  })

  // Hooks for preferences and theme - skip initial load, we'll handle it in session handshake
  const {
    preferences,
    savePreferences,
    preferencesLoaded,
    isDarkTheme,
    setPreferences,
    setPreferencesLoaded
  } = usePreferences(userType, effectiveSessionId, true)
  const { theme, THEME_FAMILIES, setTheme, isThemeReady, isInitialThemeLoad } = useTheme(
    preferences,
    savePreferences,
    containerRef,
    preferencesLoaded,
    initialTheme
  )

  // Compute mobile layout
  const isMobile = isMobileDevice || preferences.alwaysVerticalLayout || false

  // Convenience getters for preferences
  const showCompleteButton = preferences.showCompleteButton ?? true
  const showDeleteButton = preferences.showDeleteButton ?? true
  const showTagButton = preferences.showTagButton ?? false

  // Toast notifications hook (declared early so background sync can surface errors)
  const { toasts, showToast, dismissToast } = useToast()

  // Surface backgroundSync failures from the API client as user-visible toasts.
  // Why: optimistic writes hide network failures otherwise. Mobile users especially
  // see no signal when a complete/delete never reached the server.
  const reportSyncError = React.useCallback(
    (operation: string, reason: 'http-error' | 'network') => {
      const friendly =
        reason === 'network'
          ? `Server sync failed (${operation}) — check connection`
          : `Server rejected ${operation} — changes may not persist`
      showToast(friendly, 'error', 4000)
    },
    [showToast]
  )

  // Task operations hook
  const {
    tasks,
    pendingOperations,
    initialLoad,
    addTask,
    rescheduleTask,
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
  } = useTasks({ userType, sessionId: effectiveSessionId, onSyncError: reportSyncError })

  // Drag and drop hook
  const dragAndDrop = useDragAndDrop({
    tasks,
    onTaskUpdate: updateTaskTags,
    onBulkUpdate: bulkUpdateTaskTags,
    // Board-only interaction; disabling in calendar keeps text selectable/copyable.
    enabled: currentView === 'board'
  })

  // Sort hook
  const sortHook = useTaskSort()

  // Modal state hook
  const modals = useModalState()

  // Pull-to-refresh — only inside the mobile WebView; desktop pull is meaningless.
  // Reuses the same handler the in-app refresh button does (initialLoad → syncFromApi).
  const handlePullRefresh = React.useCallback(async () => {
    try {
      await initialLoad()
    } catch (err) {
      logger.error('[App] pull-to-refresh failed', { error: formatError(err) })
      showToast('Refresh failed', 'error')
    }
  }, [initialLoad, showToast])

  const pullState = usePullToRefresh({
    enabled: isInMobileApp && userType !== 'public',
    onRefresh: handlePullRefresh
  })

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

  // Session initialization (handshake, preferences loading, initial data fetch)
  useSessionInitialization({
    userType,
    propsSessionId,
    preferences,
    effectiveSessionId,
    setEffectiveSessionId,
    setPreferences,
    setPreferencesLoaded,
    initialLoad,
    setIsLoaded,
    showToast
  })

  // Task handlers hook
  const handlers = useTaskHandlers({
    tasks,
    boards,
    inputRef,
    addTask,
    deleteTag,
    updateTaskTags,
    bulkUpdateTaskTags,
    createTagOnBoard,
    createBoard,
    moveTasksToBoard,
    clearSelection: dragAndDrop.clearSelection,
    setEditTagModal: modals.setEditTagModal,
    setEditTagInput: modals.setEditTagInput,
    editTagModal: modals.editTagModal,
    editTagInput: modals.editTagInput,
    confirmClearTag: modals.confirmClearTag,
    setConfirmClearTag: modals.setConfirmClearTag,
    pendingTaskOperation: modals.pendingTaskOperation,
    setPendingTaskOperation: modals.setPendingTaskOperation,
    setShowNewTagDialog: modals.setShowNewTagDialog,
    setInputValue: modals.setInputValue,
    setShowNewBoardDialog: modals.setShowNewBoardDialog,
    setValidationError: modals.setValidationError
  })

  // Computed values
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const persistedTags: string[] = currentBoard?.tags || []
  const allTags = Array.from(new Set([...persistedTags, ...getAllTags(tasks)]))
  const topTags = getTopTags(tasks, isMobile ? 3 : 6)

  // Handle preference changes from settings modal
  const handleSavePreferences = async (prefs: Partial<UserPreferences>) => {
    logger.info('[App] Saving preferences', { keys: Object.keys(prefs) })

    // Update local state immediately for responsive UI
    setPreferences({ ...preferences, ...prefs, updatedAt: new Date().toISOString() })

    // Persist through the unified store: scope-split (device vs user) +
    // optimistic localStorage cache + debounced PUT to prefs-api.
    await saveTaskPreferences(prefs)

    logger.info('[App] Preferences saved successfully')
  }

  // Show loading skeleton only on initial load (not on theme changes)
  // Use system preference for theme during initial load, then switch to user preference
  if (!isLoaded || (isInitialThemeLoad && !isThemeReady) || !preferencesLoaded) {
    return (
      <>
        <LoadingSkeleton isDarkTheme={systemPrefersDark} />
        {/* Toaster must be rendered during loading to show session expiration messages */}
        <Toaster toasts={toasts} onDismiss={dismissToast} position="bottom-center" />
      </>
    )
  }

  return (
    <div
      ref={containerRef}
      className="task-app-container task-app-fade-in hdk-advanced-page"
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
      data-mobile-app={isInMobileApp ? 'true' : undefined}
      // Marquee box-selection is a board-only interaction; disable it in calendar view.
      onMouseDown={currentView === 'board' ? dragAndDrop.selectionStartHandler : undefined}
      onMouseMove={currentView === 'board' ? dragAndDrop.selectionMoveHandler : undefined}
      onMouseUp={currentView === 'board' ? dragAndDrop.selectionEndHandler : undefined}
      onMouseLeave={currentView === 'board' ? dragAndDrop.selectionEndHandler : undefined}
      onClick={e => {
        try {
          const tgt = e.target as HTMLElement

          // Don't interfere with theme picker clicks
          if (tgt.closest && tgt.closest('.theme-picker')) {
            return
          }

          if (!tgt.closest || !tgt.closest('.task-app__item')) {
            if (
              dragAndDrop.selectionJustEndedAt &&
              Date.now() - dragAndDrop.selectionJustEndedAt < MARQUEE_CLICK_GRACE_PERIOD
            ) {
              return
            }
            dragAndDrop.clearSelection()
          }
        } catch {
          /* Intentionally ignore errors */
        }
      }}
    >
      {isInMobileApp && (
        <PullToRefreshIndicator
          pullDistance={pullState.pullDistance}
          isRefreshing={pullState.isRefreshing}
          threshold={pullState.threshold}
        />
      )}
      <div className="task-app">
        <AppHeader
          title="Tasks"
          themePicker={
            <ConnectedThemePicker
              themeFamilies={THEME_FAMILIES}
              currentTheme={theme}
              onThemeChange={t => setTheme(t as ThemeName)}
              getThemeIcon={t =>
                getThemeIcon(t as ThemeName, preferences.experimentalThemes || false)
              }
              themeMode={preferences.themeMode ?? 'simple'}
              onThemeModeChange={mode => {
                void savePreferences({ themeMode: mode })
              }}
              hasAdvanced={hasAdvanced(theme)}
            />
          }
          settingsProps={{
            children: (
              <TaskPreferencesSection
                preferences={preferences}
                onSavePreferences={handleSavePreferences}
              />
            )
          }}
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
          onShowToast={showToast}
        />

        <ViewSwitcher currentView={currentView} onViewChange={setCurrentView} />

        {currentView === 'board' ? (
          <>
            <div className="task-app__controls">
              <input
                ref={inputRef}
                className="task-app__input"
                placeholder={placeholder}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handlers.handleAddTask((e.target as HTMLInputElement).value)
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
              onToggleFilter={tag => {
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
              onEditTag={handlers.handleEditTag}
              onDragStart={dragAndDrop.onDragStart}
              onDragEnd={dragAndDrop.onDragEnd}
              onDragOver={dragAndDrop.onDragOver}
              onDragLeave={dragAndDrop.onDragLeave}
              onDrop={dragAndDrop.onDrop}
              toggleSort={sortHook.toggleSort}
              sortTasksByAge={sortHook.sortTasksByAge}
              getSortIcon={sortHook.getSortIcon}
              getSortTitle={sortHook.getSortTitle}
              deleteTag={handlers.handleDeleteTag}
              onDeletePersistedTag={deleteTagOnBoard}
              showCompleteButton={showCompleteButton}
              showDeleteButton={showDeleteButton}
              showTagButton={showTagButton}
            />
          </>
        ) : (
          <CalendarDayView
            tasks={tasks}
            selectedDate={calendarDate}
            onDateChange={setCalendarDate}
            onCreateTask={(title, schedule) => void addTask(title, schedule)}
            onRescheduleTask={rescheduleTask}
            onDeleteTask={deleteTask}
            onEditTag={handlers.handleEditTag}
            pendingOperations={pendingOperations}
          />
        )}

        {currentView === 'board' && (
          <MarqueeOverlay rect={dragAndDrop.marqueeRect} isSelecting={dragAndDrop.isSelecting} />
        )}

        <AppModals
          confirmClearTag={modals.confirmClearTag}
          showNewBoardDialog={modals.showNewBoardDialog}
          showNewTagDialog={modals.showNewTagDialog}
          editTagModal={modals.editTagModal}
          boardContextMenu={modals.boardContextMenu}
          tagContextMenu={modals.tagContextMenu}
          inputValue={modals.inputValue}
          validationError={modals.validationError}
          editTagInput={modals.editTagInput}
          pendingTaskOperation={modals.pendingTaskOperation}
          tasks={tasks}
          boards={boards}
          currentBoardId={currentBoardId}
          effectiveSessionId={effectiveSessionId}
          toasts={toasts}
          onCloseConfirmClearTag={() => modals.setConfirmClearTag(null)}
          onConfirmDeleteTag={deleteTag}
          onCloseNewBoardDialog={() => {
            modals.setShowNewBoardDialog(false)
            modals.setPendingTaskOperation(null)
            modals.setValidationError(null)
          }}
          onConfirmCreateBoard={handlers.handleCreateBoard}
          onBoardInputChange={(value: string) => {
            modals.setInputValue(value)
            modals.setValidationError(null)
          }}
          validateBoardName={handlers.validateBoardName}
          onCloseNewTagDialog={() => {
            modals.setShowNewTagDialog(false)
            modals.setPendingTaskOperation(null)
          }}
          onConfirmCreateTag={handlers.handleCreateTag}
          onTagInputChange={modals.setInputValue}
          onCloseEditTagModal={() => {
            modals.setEditTagModal(null)
            modals.setEditTagInput('')
          }}
          onConfirmEditTag={handlers.handleUpdateTag}
          onEditTagInputChange={modals.setEditTagInput}
          onToggleTagPill={handlers.toggleTagPill}
          onCloseBoardContextMenu={() => modals.setBoardContextMenu(null)}
          onDeleteBoard={deleteBoard}
          onCloseTagContextMenu={() => modals.setTagContextMenu(null)}
          onDismissToast={dismissToast}
        />
      </div>
    </div>
  )
}
