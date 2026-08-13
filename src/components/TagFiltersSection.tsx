/**
 * TagFiltersSection component
 * Displays tag filter pills and add tag button
 */

import React, { useState } from 'react'
import { TagFilterButton } from './TagFilterButton'
import { ShareIcon } from './ShareIcon'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'
import type { PendingTaskOperation } from '../hooks/useModalState'
import type { SyncState } from '../hooks/useTasks'
import { Icon } from '@wolffm/themes'

/** Ties the calendar button to its off-screen "N scheduled" description. */
const SCHEDULED_COUNT_ID = 'task-app-scheduled-count'

export interface TagFiltersSectionProps {
  tags: string[]
  selectedFilters: Set<string>
  dragOverFilter: string | null
  userType: string
  onToggleFilter: (tag: string) => void
  onTagContextMenu: (tag: string, x: number, y: number) => void
  onDragOver: (e: React.DragEvent, filter: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, filterTag: string) => Promise<void>
  onCreateTagClick: () => void
  onPendingOperation: (op: PendingTaskOperation | null) => void
  onRefresh: () => Promise<void>
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void
  /** Open the share dialog for the current board. Absent ⇒ not shareable. */
  onShareBoard?: () => void
  /** Whether the current board can be shared (owned, signed-in). */
  canShareBoard?: boolean
  /** The active view — tag pills only show in board view. */
  currentView: 'board' | 'calendar'
  /** Toggle between board and calendar (the calendar button in this row). */
  onToggleCalendar: () => void
  /**
   * Tasks scheduled today or later. Badged onto the calendar button in board
   * view, which otherwise gives no sign that the board holds scheduled work it
   * isn't showing.
   */
  upcomingScheduledCount?: number
  /** Whether the board on screen is server truth — drives the stale pill. */
  syncState?: SyncState
}

export function TagFiltersSection({
  tags,
  selectedFilters,
  dragOverFilter,
  userType,
  onToggleFilter,
  onTagContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
  onCreateTagClick,
  onPendingOperation,
  onRefresh,
  onShowToast,
  onShareBoard,
  canShareBoard,
  currentView,
  onToggleCalendar,
  upcomingScheduledCount = 0,
  syncState = 'synced'
}: TagFiltersSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  // Only worth advertising from the board — the calendar already shows them.
  const showScheduledCount = currentView === 'board' && upcomingScheduledCount > 0

  const handleSyncClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isSyncing) return

    logger.info('[TagFiltersSection] Manual refresh triggered')
    setIsSyncing(true)

    const button = e.currentTarget
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Sync timeout')), 5000)
    })

    try {
      await Promise.race([onRefresh(), timeoutPromise])
      logger.info('[TagFiltersSection] Sync completed successfully')
      onShowToast?.('Refresh successful', 'success')
    } catch (error) {
      logger.error('[TagFiltersSection] Sync failed', { error: formatError(error) })
      onShowToast?.('Refresh failed', 'error')
    } finally {
      setIsSyncing(false)
      button?.blur()
    }
  }

  const handleAddTagDrop = (e: React.DragEvent) => {
    e.preventDefault()
    onDragLeave(e)

    const ids = getTaskIdsFromDragEvent(e.dataTransfer)
    if (ids.length > 0) {
      onPendingOperation({ type: 'apply-tag', taskIds: ids })
      onCreateTagClick()
    }
  }

  return (
    <div className="task-app__filters">
      {currentView === 'board' && (
        <>
          {tags.map(tag => (
            <TagFilterButton
              key={tag}
              tag={tag}
              isActive={selectedFilters.has(tag)}
              isDragOver={dragOverFilter === tag}
              onToggle={onToggleFilter}
              onContextMenu={onTagContextMenu}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
          <button
            className={`pill-btn task-app__filter-add ${dragOverFilter === 'add-tag' ? 'task-app__filter-drag-over' : ''}`}
            onClick={onCreateTagClick}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              onDragOver(e, 'add-tag')
            }}
            onDragLeave={onDragLeave}
            onDrop={handleAddTagDrop}
            aria-label="Add tag"
          >
            ＋
          </button>
        </>
      )}

      {/* Stale pill: the ONLY on-screen sign that a background refresh failed.
          Doubles as the retry — the thing a person wants the moment they see it. */}
      {syncState === 'stale' && (
        <button
          className="pill-btn task-app__filter-stale"
          onClick={handleSyncClick}
          disabled={isSyncing}
          // Not "offline": a 500 reached the server just fine. All we can honestly
          // claim is that the refresh didn't land.
          title="The last refresh didn't land, so this may be out of date. Click to retry."
        >
          <Icon name="warning" /> Not synced
        </button>
      )}

      <button
        className={`sync-btn task-app__filter-calendar ${currentView === 'calendar' ? 'is-active' : ''}`}
        onClick={onToggleCalendar}
        title={
          currentView === 'calendar'
            ? 'Back to board'
            : upcomingScheduledCount > 0
              ? `Calendar view — ${upcomingScheduledCount} scheduled`
              : 'Calendar view'
        }
        // The accessible NAME stays fixed. The count rides in a description
        // instead (announced after the name, and referenced from outside the
        // button) so it doesn't rename the control every time a task is
        // scheduled — the name is what tests and assistive tech address it by.
        aria-label={currentView === 'calendar' ? 'Back to board' : 'Calendar view'}
        aria-describedby={showScheduledCount ? SCHEDULED_COUNT_ID : undefined}
        aria-pressed={currentView === 'calendar'}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        {showScheduledCount && (
          <span className="task-app__filter-calendar-badge" aria-hidden="true">
            {upcomingScheduledCount > 9 ? '9+' : upcomingScheduledCount}
          </span>
        )}
      </button>
      {showScheduledCount && (
        <span id={SCHEDULED_COUNT_ID} className="task-app__sr-only">
          {upcomingScheduledCount} scheduled
        </span>
      )}

      {userType !== 'public' && (
        <button
          className={`sync-btn task-app__filter-sync ${isSyncing ? 'spinning' : ''}`}
          onClick={handleSyncClick}
          disabled={isSyncing}
          title="Sync from server"
          aria-label="Sync from server"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      )}

      {userType !== 'public' && canShareBoard && onShareBoard && (
        <button
          className="sync-btn task-app__filter-share"
          onClick={onShareBoard}
          title="Share this board"
          aria-label="Share this board"
        >
          <ShareIcon />
        </button>
      )}
    </div>
  )
}
