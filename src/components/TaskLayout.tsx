/**
 * TaskLayout component - renders the dynamic grid layout with tag columns
 */

import React from 'react'
import type { Task } from '../domain/types'
import type { SortDirection } from '../hooks/useTaskSort'
import { TaskItem } from './TaskItem'
import { getLayoutConfig } from '../utils/layout'
import { getTasksByTag, getRemainingTasks } from '../domain/utils/tags'

interface TaskLayoutProps {
  tasks: Task[]
  topTags: string[]
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
  onAddTag: (taskId: string) => void
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragEnd?: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent, targetTag: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetTag: string) => void
  toggleSort: (sectionKey: string) => void
  sortTasksByAge: (tasks: Task[], direction: SortDirection) => Task[]
  getSortIcon: (direction: SortDirection) => string
  getSortTitle: (direction: SortDirection) => string
  clearTasksByTag: (tag: string) => void
  clearRemainingTasks: (tasks: Task[]) => void
  onDeletePersistedTag?: (tag: string) => void
}

export function TaskLayout({
  tasks,
  topTags,
  filters,
  sortDirections,
  dragOverTag,
  pendingOperations,
  onComplete,
  onDelete,
  onAddTag,
  onDragStart,
  onDragEnd,
  selectedIds,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  toggleSort,
  sortTasksByAge,
  getSortIcon,
  getSortTitle,
  clearTasksByTag,
  clearRemainingTasks
  , onDeletePersistedTag
}: TaskLayoutProps) {
  // Helper function to render a tag column with header and tasks
  const renderTagColumn = (tag: string, tagTasks: Task[]) => (
    <div 
      key={tag} 
      className={`task-app__tag-column ${dragOverTag === tag ? 'task-app__tag-column--drag-over' : ''}`}
      onDragOver={(e) => onDragOver(e, tag)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, tag)}
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
        {sortTasksByAge(tagTasks, sortDirections[tag] || 'desc').map(task => (
          <TaskItem
            key={task.id}
            task={task}
            isDraggable={true}
            pendingOperations={pendingOperations}
            onComplete={onComplete}
            onDelete={onDelete}
            onAddTag={onAddTag}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            selected={selectedIds ? selectedIds.has(task.id) : false}
          />
        ))}
      </ul>
    </div>
  )

  // Helper function to get filtered tasks for a tag
  const getFilteredTagTasks = (tag: string, maxItems: number) => {
    let tagTasks = getTasksByTag(tasks, tag)
    if (hasActiveFilters) {
      tagTasks = tagTasks.filter(t => {
        const taskTags = t.tag?.split(' ') || []
        return filters!.some(f => taskTags.includes(f))
      })
    }
    return tagTasks.slice(0, maxItems)
  }

  const tagCount = topTags.length

  // Apply multi-select filters to all tasks
  const hasActiveFilters = Array.isArray(filters) && filters.length > 0
  const filteredTasks = tasks.filter(t => {
    if (!hasActiveFilters) return true
    const taskTags = t.tag?.split(' ') || []
    // If any selected filter is present on the task, include it
    return filters!.some(f => taskTags.includes(f))
  })

  // Multiple tags: dynamic layout
  const layoutConfig = getLayoutConfig(tagCount)

  // Decide which top tags are visible. When a filter is active, only show
  // columns that have tasks matching the selected filters. This allows the
  // layout to collapse to a single column when filters reduce visible tags.
  const visibleTopTags = hasActiveFilters
    ? topTags.filter(tag => {
        const tagTasks = getTasksByTag(tasks, tag)
        return tagTasks.some(t => {
          const taskTags = t.tag?.split(' ') || []
          return filters!.some(f => taskTags.includes(f))
        })
      })
    : topTags.slice(0, layoutConfig.useTags)

  // No tags: simple list (use visibleTopTags length so filters can collapse layout)
  if (visibleTopTags.length === 0) {
    return (
      <ul className="task-app__list">
        {filteredTasks.map(task => (
          <TaskItem
            key={task.id}
            task={task}
            pendingOperations={pendingOperations}
            onComplete={onComplete}
            onDelete={onDelete}
            onAddTag={onAddTag}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            selected={selectedIds ? selectedIds.has(task.id) : false}
          />
        ))}
      </ul>
    )
  }
  const remainingTasks = getRemainingTasks(tasks, topTags, filters).filter(t => {
    if (!hasActiveFilters) return true
    const taskTags = t.tag?.split(' ') || []
    return filters!.some(f => taskTags.includes(f))
  })

  // Recalculate layout based on visible columns
  const visibleLayoutConfig = getLayoutConfig(visibleTopTags.length)

  return (
    <div className="task-app__dynamic-layout">
      {visibleLayoutConfig.rows.length > 0 && (
        <>
          {visibleLayoutConfig.rows.map((row, rowIndex) => (
            <div key={rowIndex} className={`task-app__tag-grid task-app__tag-grid--${row.columns}col`}>
              {row.tagIndices.map(tagIndex => {
                const tag = visibleTopTags[tagIndex]
                return tag ? renderTagColumn(tag, getFilteredTagTasks(tag, visibleLayoutConfig.maxPerColumn)) : null
              })}
            </div>
          ))}
        </>
      )}
      
      {remainingTasks.length > 0 && (
        <div
          className={`task-app__remaining ${dragOverTag === 'other' ? 'task-app__tag-column--drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(e as unknown as React.DragEvent, 'other') }}
          onDragLeave={(e) => onDragLeave(e as unknown as React.DragEvent)}
          onDrop={(e) => onDrop(e as unknown as React.DragEvent, 'other')}
        >
          <div className="task-app__tag-header-row">
            <h3 className="task-app__remaining-header">Other Tasks</h3>
            <button 
              className="task-app__sort-btn task-app__sort-btn--active"
              onClick={() => toggleSort('other')}
              title={getSortTitle(sortDirections['other'] || 'desc')}
            >
              {getSortIcon(sortDirections['other'] || 'desc')}
            </button>
          </div>
          <ul className="task-app__list">
            {sortTasksByAge(remainingTasks, sortDirections['other'] || 'desc').map(task => (
              <TaskItem
                key={task.id}
                task={task}
                pendingOperations={pendingOperations}
                onComplete={onComplete}
                onDelete={onDelete}
                onAddTag={onAddTag}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                selected={selectedIds ? selectedIds.has(task.id) : false}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
