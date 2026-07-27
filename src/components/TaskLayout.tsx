/**
 * TaskLayout component - renders the dynamic grid layout with tag columns
 */

import React from 'react'
import type { Task } from '../domain/types'
import type { BoardTypeConfig } from '../domain/boardType'
import { STANDARD_BOARD } from '../domain/boardType'
import type { SortDirection } from '../hooks/useTaskSort'
import { TaskItem } from './TaskItem'
import { getLayoutConfig } from '../utils/layout'
import { splitTags, getTasksByTag, getRemainingTasks } from '../domain/utils/tags'

interface TaskLayoutProps {
  /** What gets RENDERED: Active plus anything completed inside its 24h window. */
  tasks: Task[]
  /**
   * What gets COUNTED. Lane emptiness is a statement about live work — a lane
   * holding nothing but struck-through tasks is done, and on an automation board
   * (hideEmptyLanes) it should collapse rather than sit there looking occupied
   * for a day.
   */
  activeTasks: Task[]
  topTags: string[]
  boardType?: BoardTypeConfig
  isMobile?: boolean
  filters?: string[]
  selectedIds?: Set<string>
  // selection handlers (marquee)
  onSelectionStart?: (e: React.MouseEvent) => void
  onSelectionMove?: (e: React.MouseEvent) => void
  onSelectionEnd?: (e: React.MouseEvent) => void
  sortDirections: { [key: string]: SortDirection }
  dragOverTag: string | null
  pendingOperations: Set<string>
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  onSetNotes?: (taskId: string, notes: string) => Promise<void>
  /** Rename a task from its title, edited inline on the card. */
  onRenameTask?: (taskId: string, title: string) => Promise<void>
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragEnd?: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent, targetTag: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetTag: string) => void
  toggleSort: (sectionKey: string) => void
  sortTasksByAge: (tasks: Task[], direction: SortDirection) => Task[]
  getSortIcon: (direction: SortDirection) => string
  getSortTitle: (direction: SortDirection) => string
  deleteTag: (tag: string) => void
  onDeletePersistedTag?: (tag: string) => void
  showNotesButton?: boolean
  showCompleteButton?: boolean
  showDeleteButton?: boolean
  showTagButton?: boolean
}

export function TaskLayout({
  tasks,
  activeTasks,
  topTags,
  boardType = STANDARD_BOARD,
  isMobile = false,
  filters,
  sortDirections,
  dragOverTag,
  pendingOperations,
  onComplete,
  onDelete,
  onEditTag,
  onSetNotes,
  onRenameTask,
  onDragStart,
  onDragEnd,
  selectedIds,
  onSelectionStart: _onSelectionStart,
  onSelectionMove: _onSelectionMove,
  onSelectionEnd: _onSelectionEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  toggleSort,
  sortTasksByAge,
  getSortIcon,
  getSortTitle,
  deleteTag: _deleteTag,
  onDeletePersistedTag: _onDeletePersistedTag,
  showNotesButton = true,
  showCompleteButton = true,
  showDeleteButton = true,
  showTagButton = false
}: TaskLayoutProps) {
  // Is a task drag in flight? Tracked here rather than in the drag hook because
  // only the layout needs it: hidden empty lanes must reappear during a drag so
  // they stay droppable. Wrapping the handlers we already thread to TaskItem
  // keeps this self-contained.
  const [isDragging, setIsDragging] = React.useState(false)
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setIsDragging(true)
    onDragStart(e, taskId)
  }
  const handleDragEnd = (e: React.DragEvent) => {
    setIsDragging(false)
    onDragEnd?.(e)
  }

  // Helper to render TaskItems with consistent props
  const renderTaskItems = (taskList: Task[], direction: SortDirection) =>
    sortTasksByAge(taskList, direction).map(task => (
      <TaskItem
        key={task.id}
        task={task}
        isDraggable={true}
        pendingOperations={pendingOperations}
        onComplete={onComplete}
        onDelete={onDelete}
        onEditTag={onEditTag}
        onSetNotes={onSetNotes}
        onRenameTask={onRenameTask}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        selected={selectedIds?.has(task.id) ?? false}
        showNotesButton={showNotesButton}
        showCompleteButton={showCompleteButton}
        showDeleteButton={showDeleteButton}
        showTagButton={showTagButton}
      />
    ))

  // Helper function to render a tag column with header and tasks
  const renderTagColumn = (tag: string, tagTasks: Task[]) => (
    <div
      key={tag}
      className={`task-app__tag-column ${dragOverTag === tag ? 'task-app__tag-column--drag-over' : ''}`}
      onDragOver={e => onDragOver(e, tag)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, tag)}
    >
      <div className="task-app__tag-header-row">
        <h3 className="task-app__tag-header">#{tag}</h3>
        <button
          className="task-app__sort-btn task-app__sort-btn--active"
          onClick={() => toggleSort(tag)}
          title={getSortTitle(sortDirections[tag] || 'desc')}
        >
          {getSortIcon(sortDirections[tag] || 'desc')}
        </button>
      </div>
      <ul className="task-app__list task-app__list--column">
        {renderTaskItems(tagTasks, sortDirections[tag] || 'desc')}
      </ul>
    </div>
  )

  // Helper function to get filtered tasks for a tag
  const getFilteredTagTasks = (tag: string, maxItems: number) => {
    let tagTasks = getTasksByTag(tasks, tag)
    if (hasActiveFilters && filters) {
      tagTasks = tagTasks.filter(t => {
        const taskTags = splitTags(t.tag)
        return filters.some(f => taskTags.includes(f))
      })
    }
    return tagTasks.slice(0, maxItems)
  }

  const tagCount = topTags.length

  // Apply multi-select filters to all tasks
  const hasActiveFilters = Array.isArray(filters) && filters.length > 0
  const filteredTasks = tasks.filter(t => {
    if (!hasActiveFilters || !filters) return true
    const taskTags = splitTags(t.tag)
    // If any selected filter is present on the task, include it
    return filters.some(f => taskTags.includes(f))
  })

  // Multiple tags: dynamic layout. A board whose laneLimit is null for this
  // viewport (automation) declares its lanes explicitly, so the grid must render
  // ALL of them — capping at the top 6 dropped lanes 7+ off the board and made
  // the tasks in them unreachable (they're not "remaining" either, so they
  // surfaced nowhere until you filtered by that lane).
  const laneCap = isMobile ? boardType.laneLimit.mobile : boardType.laneLimit.desktop
  const layoutConfig = getLayoutConfig(tagCount, isMobile, laneCap === null)

  // Decide which top tags are visible. When a filter is active, only show
  // columns that have tasks matching the selected filters. This allows the
  // layout to collapse to a single column when filters reduce visible tags.
  const laneCandidates = topTags.slice(0, layoutConfig.useTags)
  const visibleTopTags =
    hasActiveFilters && filters
      ? topTags.filter(tag => {
          const tagTasks = getTasksByTag(tasks, tag)
          return tagTasks.some(t => {
            const taskTags = splitTags(t.tag)
            return filters.some(f => taskTags.includes(f))
          })
        })
      : // Drop empty lanes where the board asks for it (automation declares its
        // whole lane vocabulary, so most lanes sit empty and the board becomes a
        // wall of empty columns). Not while a drag is in flight: an empty lane is
        // still a drop target, and on an automation board dragging is how a task
        // advances — hiding `approved` while it's empty would make it unreachable.
        boardType.hideEmptyLanes && !isDragging
        ? laneCandidates.filter(tag => getTasksByTag(activeTasks, tag).length > 0)
        : laneCandidates

  // No tags: simple list (use visibleTopTags length so filters can collapse layout)
  if (visibleTopTags.length === 0) {
    return <ul className="task-app__list">{renderTaskItems(filteredTasks, 'desc')}</ul>
  }
  // Compute "remaining" against the tags actually RENDERED, not every candidate
  // tag. A task whose tag has a column is shown there; a task whose tag was
  // dropped from the layout would otherwise be excluded here too and vanish from
  // the board entirely. Identical for standard boards (topTags is already capped
  // to the lane limit upstream, so the two lists match) — this is the safety net
  // that keeps a truncated layout from silently swallowing tasks.
  const remainingTasks = getRemainingTasks(tasks, visibleTopTags, filters).filter(t => {
    if (!hasActiveFilters || !filters) return true
    const taskTags = splitTags(t.tag)
    return filters.some(f => taskTags.includes(f))
  })

  // Recalculate layout based on visible columns
  const visibleLayoutConfig = getLayoutConfig(visibleTopTags.length, isMobile)

  // The untagged section — "Other Tasks" at the bottom for standard boards, the
  // "Inbox" at the top for the two-track flow (§5.3). Same markup, so its drag/
  // sort key stays 'other'; only the heading and placement differ by board type.
  const untaggedBlock =
    remainingTasks.length > 0 ? (
      <div
        className={`task-app__remaining ${dragOverTag === 'other' ? 'task-app__tag-column--drag-over' : ''}`}
        onDragOver={e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDragOver(e as unknown as React.DragEvent, 'other')
        }}
        onDragLeave={e => onDragLeave(e as unknown as React.DragEvent)}
        onDrop={e => onDrop(e as unknown as React.DragEvent, 'other')}
      >
        <div className="task-app__tag-header-row">
          <h3 className="task-app__remaining-header">{boardType.untaggedLabel}</h3>
          <button
            className="task-app__sort-btn task-app__sort-btn--active"
            onClick={() => toggleSort('other')}
            title={getSortTitle(sortDirections['other'] || 'desc')}
          >
            {getSortIcon(sortDirections['other'] || 'desc')}
          </button>
        </div>
        <ul className="task-app__list">
          {renderTaskItems(remainingTasks, sortDirections['other'] || 'desc')}
        </ul>
      </div>
    ) : null

  // Two-track vertical flow (automation boards, §5.3): Inbox full-width on top,
  // then the lanes in DECLARED order flowing through a responsive grid — two
  // columns on desktop, one stack on mobile — uncapped per lane. The YOURS|AGENT
  // split by editableBy lands in T6 with the lane model.
  if (boardType.layout === 'two-track-flow') {
    const perSection = boardType.maxPerSection ?? Infinity
    return (
      <div className="task-app__two-track">
        {boardType.untaggedPosition === 'top' && untaggedBlock}
        {visibleTopTags.length > 0 && (
          <div
            className={`task-app__two-track-lanes ${isMobile ? 'task-app__two-track-lanes--stack' : ''}`}
          >
            {visibleTopTags.map(tag => renderTagColumn(tag, getFilteredTagTasks(tag, perSection)))}
          </div>
        )}
        {boardType.untaggedPosition === 'bottom' && untaggedBlock}
      </div>
    )
  }

  // Standard board — the adaptive grid, unchanged. untaggedPosition is 'bottom',
  // so the untagged block renders after the grid exactly as it always has.
  return (
    <div className="task-app__dynamic-layout">
      {boardType.untaggedPosition === 'top' && untaggedBlock}
      {visibleLayoutConfig.rows.length > 0 && (
        <>
          {visibleLayoutConfig.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={`task-app__tag-grid task-app__tag-grid--${row.columns}col`}
            >
              {row.tagIndices.map(tagIndex => {
                const tag = visibleTopTags[tagIndex]
                return tag
                  ? renderTagColumn(tag, getFilteredTagTasks(tag, visibleLayoutConfig.maxPerColumn))
                  : null
              })}
            </div>
          ))}
        </>
      )}
      {boardType.untaggedPosition === 'bottom' && untaggedBlock}
    </div>
  )
}
