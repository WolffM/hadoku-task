/**
 * TagFiltersSection component
 * Displays tag filter pills and add tag button
 */

import React, { useState } from 'react'
import { TagFilterButton } from './TagFilterButton'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'
import type { PendingTaskOperation } from '../hooks/useModalState'

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
  canShareBoard
}: TagFiltersSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false)

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
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
        </button>
      )}
    </div>
  )
}
