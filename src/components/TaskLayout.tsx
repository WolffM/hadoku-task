/**
 * TaskLayout component - renders the dynamic grid layout with tag columns
 */

import React from 'react'
import type { Task } from '@hadoku/task/api/types'
import type { SortDirection } from '../hooks/useTaskSort'
import { TaskItem } from './TaskItem'
import { getLayoutConfig } from '../lib/layoutUtils'
import { getTasksByTag, getRemainingTasks } from '../lib/tagUtils'

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

  // No tags or 1 tag: simple list (use visibleTopTags length so filters can collapse layout)
  if (visibleTopTags.length <= 1) {
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
      {visibleTopTags.length > 0 && (
        // Special layout for exactly 5 visible tags: show 2 cols on the first row and 3 on the second
        visibleTopTags.length === 5 ? (
          <>
            <div className={`task-app__tag-grid task-app__tag-grid--2col`}>
              {visibleTopTags.slice(0, 2).map(tag => {
                let tagTasks = getTasksByTag(tasks, tag)
                if (hasActiveFilters) {
                  tagTasks = tagTasks.filter(t => {
                    const taskTags = t.tag?.split(' ') || []
                    return filters!.some(f => taskTags.includes(f))
                  })
                }
                tagTasks = tagTasks.slice(0, layoutConfig.maxPerColumn)

                return (
                  <div 
                    key={tag} 
                    className={`task-app__tag-column ${dragOverTag === tag ? 'task-app__tag-column--drag-over' : ''}`}
                    onDragOver={(e) => onDragOver(e, tag)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, tag)}
                  >
                    <div className="task-app__tag-header-row">
                      <h3 className="task-app__tag-header">#{tag}</h3>
                      <div className="task-app__header-actions">
                        <button 
                          className={`task-app__sort-btn ${sortDirections[tag] ? 'task-app__sort-btn--active' : ''}`}
                          onClick={() => toggleSort(tag)}
                          title={getSortTitle(sortDirections[tag])}
                        >
                          {getSortIcon(sortDirections[tag])}
                        </button>
                        <button 
                          className="task-app__clear-tag-btn"
                          onClick={() => clearTasksByTag(tag)}
                          title={`Remove #${tag} from all tasks`}
                        >
                          🧹
                        </button>
                        <button 
                          className="task-app__delete-tag-btn"
                          onClick={() => onDeletePersistedTag && onDeletePersistedTag(tag)}
                          title={`Delete #${tag} from board`}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <ul className="task-app__list task-app__list--column">
                      {sortTasksByAge(tagTasks, sortDirections[tag]).map(task => (
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
              })}
            </div>

            <div className={`task-app__tag-grid task-app__tag-grid--3col`}>
              {visibleTopTags.slice(2, 5).map(tag => {
                let tagTasks = getTasksByTag(tasks, tag)
                if (hasActiveFilters) {
                  tagTasks = tagTasks.filter(t => {
                    const taskTags = t.tag?.split(' ') || []
                    return filters!.some(f => taskTags.includes(f))
                  })
                }
                tagTasks = tagTasks.slice(0, layoutConfig.maxPerColumn)

                return (
                  <div 
                    key={tag} 
                    className={`task-app__tag-column ${dragOverTag === tag ? 'task-app__tag-column--drag-over' : ''}`}
                    onDragOver={(e) => onDragOver(e, tag)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, tag)}
                  >
                    <div className="task-app__tag-header-row">
                      <h3 className="task-app__tag-header">#{tag}</h3>
                      <div className="task-app__header-actions">
                        <button 
                          className={`task-app__sort-btn ${sortDirections[tag] ? 'task-app__sort-btn--active' : ''}`}
                          onClick={() => toggleSort(tag)}
                          title={getSortTitle(sortDirections[tag])}
                        >
                          {getSortIcon(sortDirections[tag])}
                        </button>
                        <button 
                          className="task-app__clear-tag-btn"
                          onClick={() => clearTasksByTag(tag)}
                          title={`Clear all #${tag} tasks`}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <ul className="task-app__list task-app__list--column">
                      {sortTasksByAge(tagTasks, sortDirections[tag]).map(task => (
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
              })}
            </div>
          </>
        ) : (
          <div className={`task-app__tag-grid task-app__tag-grid--${visibleLayoutConfig.columns}col`}>
          {visibleTopTags.map(tag => {
            // Allow duplicate tasks across columns for better visibility
            let tagTasks = getTasksByTag(tasks, tag)
            if (hasActiveFilters) {
              tagTasks = tagTasks.filter(t => {
                const taskTags = t.tag?.split(' ') || []
                return filters!.some(f => taskTags.includes(f))
              })
            }
            tagTasks = tagTasks.slice(0, layoutConfig.maxPerColumn)
            
            return (
              <div 
                key={tag} 
                className={`task-app__tag-column ${dragOverTag === tag ? 'task-app__tag-column--drag-over' : ''}`}
                onDragOver={(e) => onDragOver(e, tag)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, tag)}
              >
                <div className="task-app__tag-header-row">
                  <h3 className="task-app__tag-header">#{tag}</h3>
                  <div className="task-app__header-actions">
                    <button 
                      className={`task-app__sort-btn ${sortDirections[tag] ? 'task-app__sort-btn--active' : ''}`}
                      onClick={() => toggleSort(tag)}
                      title={getSortTitle(sortDirections[tag])}
                    >
                      {getSortIcon(sortDirections[tag])}
                    </button>
                    <button 
                      className="task-app__clear-tag-btn"
                      onClick={() => clearTasksByTag(tag)}
                      title={`Clear all #${tag} tasks`}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <ul className="task-app__list task-app__list--column">
                  {sortTasksByAge(tagTasks, sortDirections[tag]).map(task => (
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
          })}
        </div>
        )
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
            <div className="task-app__header-actions">
              <button 
                className={`task-app__sort-btn ${sortDirections['other'] ? 'task-app__sort-btn--active' : ''}`}
                onClick={() => toggleSort('other')}
                title={getSortTitle(sortDirections['other'])}
              >
                {getSortIcon(sortDirections['other'])}
              </button>
              <button 
                className="task-app__clear-tag-btn"
                onClick={() => clearRemainingTasks(remainingTasks)}
                title="Clear all remaining tasks"
              >
                🗑️
              </button>
            </div>
          </div>
          <ul className="task-app__list">
            {sortTasksByAge(remainingTasks, sortDirections['other']).map(task => (
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
