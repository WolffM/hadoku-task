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
  filter?: string
  sortDirections: { [key: string]: SortDirection }
  dragOverTag: string | null
  pendingOperations: Set<string>
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  onAddTag: (taskId: string) => void
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragOver: (e: React.DragEvent, targetTag: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetTag: string) => void
  toggleSort: (sectionKey: string) => void
  sortTasksByAge: (tasks: Task[], direction: SortDirection) => Task[]
  getSortIcon: (direction: SortDirection) => string
  getSortTitle: (direction: SortDirection) => string
  clearTasksByTag: (tag: string) => void
  clearRemainingTasks: (tasks: Task[]) => void
}

export function TaskLayout({
  tasks,
  topTags,
  filter,
  sortDirections,
  dragOverTag,
  pendingOperations,
  onComplete,
  onDelete,
  onAddTag,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  toggleSort,
  sortTasksByAge,
  getSortIcon,
  getSortTitle,
  clearTasksByTag,
  clearRemainingTasks
}: TaskLayoutProps) {
  const tagCount = topTags.length

  // Apply filter to all tasks
  const filteredTasks = tasks.filter(t => {
    if (!filter) return true // Show all when no filter
    return t.tag?.split(' ').includes(filter) || false
  })

  // No tags or 1 tag: simple list
  if (tagCount <= 1) {
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
          />
        ))}
      </ul>
    )
  }

  // Multiple tags: dynamic layout
  const layoutConfig = getLayoutConfig(tagCount)
  const remainingTasks = getRemainingTasks(tasks, topTags, filter).filter(t => {
    if (!filter) return true
    return t.tag?.split(' ').includes(filter) || false
  })

  // Filter out empty tag columns when a filter is active
  const visibleTopTags = topTags.slice(0, layoutConfig.useTags).filter(tag => {
    if (!filter) return true // Show all columns when no filter
    
    // Only show columns that have tasks matching the filter
    let tagTasks = getTasksByTag(tasks, tag)
    return tagTasks.some(t => t.tag?.split(' ').includes(filter))
  })

  // Recalculate layout based on visible columns
  const visibleLayoutConfig = getLayoutConfig(visibleTopTags.length)

  return (
    <div className="task-app__dynamic-layout">
      {visibleTopTags.length > 0 && (
        <div className={`task-app__tag-grid task-app__tag-grid--${visibleLayoutConfig.columns}col`}>
          {visibleTopTags.map(tag => {
            // Allow duplicate tasks across columns for better visibility
            let tagTasks = getTasksByTag(tasks, tag)
            if (filter) {
              tagTasks = tagTasks.filter(t => t.tag?.split(' ').includes(filter) || false)
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
                      isDraggable={false}
                      pendingOperations={pendingOperations}
                      onComplete={onComplete}
                      onDelete={onDelete}
                      onAddTag={onAddTag}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      
      {remainingTasks.length > 0 && (
        <div className="task-app__remaining">
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
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
