import React, { useEffect, useRef, useState } from 'react'
import { createApi } from './lib/api'
import type { Task, TasksFile } from './lib/types'
import type { TaskAppProps } from './entry'

export default function App(props: TaskAppProps = {}) {
  const { basename = '/task', apiUrl, environment, userType = 'public' } = props;
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<string | undefined>(undefined)
  const [dragOverTag, setDragOverTag] = useState<string | null>(null)
  const [dragOverFilter, setDragOverFilter] = useState<string | null>(null)
  const [sortDirections, setSortDirections] = useState<{ [key: string]: 'asc' | 'desc' | null }>({})
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const isPublic = userType === 'public'
  const api = createApi(userType)

  useEffect(() => {
    void initialLoad()
    inputRef.current?.focus()
    try {
      const bc = new BroadcastChannel('tasks')
      bc.onmessage = (e) => {
        if (e.data?.type === 'tasks-updated') reload()
      }
      return () => bc.close()
    } catch {}
  }, [userType])

  async function initialLoad() {
    if (isPublic) {
      // Public users: clear tasks on load, then load fresh data
      try {
        await api.clearPublicTasks()
      } catch (error) {
        console.warn('Failed to clear public tasks:', error)
      }
    }
    await reload()
  }

  async function reload() {
    const tf: TasksFile = await api.getTasks()
    // Only show Active tasks in the UI
    setTasks((tf.tasks || []).filter(t => t.state === 'Active'))
  }

  function broadcastTasksUpdated() {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type: 'tasks-updated' })
      bc.close()
    } catch (error) {
      console.warn('Failed to broadcast task update:', error)
    }
  }

  async function addTask(input: string) {
    input = input.trim()
    if (!input) return
    
    try {
      const parsed = parseTaskInput(input)
      await api.createTask(parsed)
      await reload()
      broadcastTasksUpdated()
      if (inputRef.current) {
        inputRef.current.value = ''
        inputRef.current.focus()
      }
    } catch (error) {
      alert((error as Error).message || 'Failed to create task')
    }
  }

  function parseTaskInput(input: string): { title: string; tag?: string } {
    // Handle quoted tasks with tags: "New task" #friend #soon
    const quotedMatch = input.match(/^["']([^"']+)["']\s*(.*)$/)
    if (quotedMatch) {
      const title = quotedMatch[1]
      const tagsText = quotedMatch[2]
      const tags = tagsText.match(/#\w+/g)?.map(tag => tag.slice(1)) || []
      return { title, tag: tags.join(' ') || undefined }
    }
    
    // Handle unquoted tasks with tags: New task #friend #soon
    const tagMatch = input.match(/^(.+?)\s+(#.+)$/)
    if (tagMatch) {
      const title = tagMatch[1]
      const tagsText = tagMatch[2]
      const tags = tagsText.match(/#\w+/g)?.map(tag => tag.slice(1)) || []
      return { title, tag: tags.join(' ') || undefined }
    }
    
    // Plain task without tags
    return { title: input }
  }

  function getTopTags(): string[] {
    const taskTags = tasks.flatMap(t => t.tag?.split(' ') || []).filter(Boolean)
    const tagCounts: { [tag: string]: number } = {}
    taskTags.forEach(tag => tagCounts[tag] = (tagCounts[tag] || 0) + 1)
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag)
  }

  function getTasksByTag(tag: string): Task[] {
    return tasks.filter(t => t.tag?.split(' ').includes(tag))
  }

  function getTasksByTagExclusive(tag: string, topTags: string[]): Task[] {
    return tasks.filter(t => {
      const taskTags = t.tag?.split(' ') || []
      if (!taskTags.includes(tag)) return false
      
      // Only show in the first matching top tag column
      const firstMatchingTag = topTags.find(topTag => taskTags.includes(topTag))
      return firstMatchingTag === tag
    })
  }

  function getRemainingTasks(excludeTags: string[]): Task[] {
    return tasks.filter(t => {
      if (!filter) {
        // No filter: exclude tasks that have any of the top tags
        const taskTags = t.tag?.split(' ') || []
        return !excludeTags.some(tag => taskTags.includes(tag))
      } else {
        // Filter active: only show filtered tasks that don't have top tags
        const taskTags = t.tag?.split(' ') || []
        return taskTags.includes(filter) && !excludeTags.some(tag => taskTags.includes(tag))
      }
    })
  }

  async function addTagToTask(taskId: string) {
    const newTag = prompt('Enter tag (without #):')
    if (!newTag) return
    
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(newTag)) return // Tag already exists
    
    const updatedTags = [...existingTags, newTag].join(' ')
    
    try {
      await api.patchTask(taskId, { tag: updatedTags })
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  async function completeTask(taskId: string) {
    const operationKey = `complete-${taskId}`
    
    // Prevent duplicate requests
    if (pendingOperations.has(operationKey)) {
      return
    }
    
    // Add to pending operations
    setPendingOperations(prev => new Set([...prev, operationKey]))
    
    try {
      await api.completeTask(taskId)
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      // Only show error if it's not a 404 (task already processed)
      if (!(error as any)?.message?.includes('404')) {
        alert((error as Error).message || 'Failed to complete task')
      }
    } finally {
      // Remove from pending operations
      setPendingOperations(prev => {
        const newSet = new Set(prev)
        newSet.delete(operationKey)
        return newSet
      })
    }
  }

  async function deleteSingleTask(taskId: string) {
    const operationKey = `delete-${taskId}`
    
    // Prevent duplicate requests
    if (pendingOperations.has(operationKey)) {
      return
    }
    
    // Add to pending operations
    setPendingOperations(prev => new Set([...prev, operationKey]))
    
    try {
      await api.deleteTask(taskId)
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      // Only show error if it's not a 404 (task already processed)
      if (!(error as any)?.message?.includes('404')) {
        alert((error as Error).message || 'Failed to delete task')
      }
    } finally {
      // Remove from pending operations
      setPendingOperations(prev => {
        const newSet = new Set(prev)
        newSet.delete(operationKey)
        return newSet
      })
    }
  }

  async function clearAllTasks() {
    if (!confirm(`Clear all tasks for ${userType} user?`)) return
    
    try {
      // Delete all tasks one by one
      for (const task of tasks) {
        await api.deleteTask(task.id)
      }
      await reload()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear tasks')
    }
  }

  async function clearTasksByTag(tag: string) {
    if (!confirm(`Clear all tasks with #${tag} tag?`)) return
    
    try {
      const tagTasks = getTasksByTag(tag)
      for (const task of tagTasks) {
        await api.deleteTask(task.id)
      }
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear tagged tasks')
    }
  }

  async function clearRemainingTasks(excludeTags: string[]) {
    if (!confirm('Clear all remaining tasks?')) return
    
    try {
      const remainingTasks = getRemainingTasks(excludeTags)
      for (const task of remainingTasks) {
        await api.deleteTask(task.id)
      }
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear remaining tasks')
    }
  }

  function formatAge(createdAt: string): string {
    const now = new Date()
    const created = new Date(createdAt)
    // Calculate diff using UTC to avoid timezone issues
    const diffMs = now.getTime() - created.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)
    
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    return `${diffDay}d ago`
  }

  function sortTasksByAge(tasks: Task[], direction: 'asc' | 'desc' | null): Task[] {
    if (!direction) return tasks
    
    return [...tasks].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      
      if (direction === 'asc') {
        return dateA - dateB // oldest first
      } else {
        return dateB - dateA // newest first
      }
    })
  }

  function toggleSort(sectionKey: string) {
    setSortDirections(prev => {
      const current = prev[sectionKey] || null
      let next: 'asc' | 'desc' | null
      
      if (current === null) next = 'desc' // newest first
      else if (current === 'desc') next = 'asc' // oldest first
      else next = null // no sort
      
      return { ...prev, [sectionKey]: next }
    })
  }

  function getSortIcon(direction: 'asc' | 'desc' | null): string {
    if (direction === 'asc') return '↑' // oldest first
    if (direction === 'desc') return '↓' // newest first
    return '↕' // no sort / default
  }

  function getSortTitle(direction: 'asc' | 'desc' | null): string {
    if (direction === 'asc') return 'Sorted by age (oldest first) - click to sort newest first'
    if (direction === 'desc') return 'Sorted by age (newest first) - click to disable sorting'
    return 'Click to sort by age (newest first)'
  }

  function onDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onDragOver(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverTag(targetTag)
  }

  function onDragLeave(e: React.DragEvent) {
    // Only clear if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTag(null)
    }
  }

  async function onDrop(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    setDragOverTag(null)
    
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(targetTag)) {
      console.log(`Task already has tag: ${targetTag}`)
      return // Tag already exists
    }
    
    const updatedTags = [...existingTags, targetTag].join(' ')
    console.log(`Adding tag "${targetTag}" to task "${task.title}". New tags: "${updatedTags}"`)
    
    try {
      const result = await api.patchTask(taskId, { tag: updatedTags })
      console.log('Patch result:', result)
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      console.error('Failed to add tag:', error)
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  function onFilterDragOver(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverFilter(filterTag)
  }

  function onFilterDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverFilter(null)
    }
  }

  async function onFilterDrop(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    setDragOverFilter(null)
    
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(filterTag)) {
      console.log(`Task already has tag: ${filterTag}`)
      return // Tag already exists
    }
    
    const updatedTags = [...existingTags, filterTag].join(' ')
    console.log(`Adding tag "${filterTag}" to task "${task.title}" via filter drop. New tags: "${updatedTags}"`)
    
    try {
      const result = await api.patchTask(taskId, { tag: updatedTags })
      console.log('Filter drop result:', result)
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      console.error('Failed to add tag via filter drop:', error)
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  function renderTaskItem(task: Task, isDraggable = true) {
    const isCompleting = pendingOperations.has(`complete-${task.id}`)
    const isDeleting = pendingOperations.has(`delete-${task.id}`)
    
    return (
      <li 
        key={task.id} 
        className="task-app__item"
        draggable={isDraggable}
        onDragStart={(e) => onDragStart(e, task.id)}
      >
        <div className="task-app__item-content">
          <div className="task-app__item-title-row">
            <div className="task-app__item-title">{task.title}</div>
            <div className="task-app__item-age">{formatAge(task.createdAt)}</div>
          </div>
          {task.tag && <div className="task-app__item-tag">
            {task.tag.split(' ').map(tag => `#${tag}`).join(' ')}
          </div>}
        </div>
        <div className="task-app__item-actions">
          <button 
            className="task-app__action-btn task-app__complete-btn"
            onClick={() => completeTask(task.id)}
            title="Complete task"
            disabled={isCompleting || isDeleting}
            style={{ opacity: isCompleting ? 0.3 : undefined }}
          >
            {isCompleting ? '⏳' : '✓'}
          </button>
          <button 
            className="task-app__action-btn task-app__delete-btn"
            onClick={() => deleteSingleTask(task.id)}
            title="Delete task"
            disabled={isCompleting || isDeleting}
            style={{ opacity: isDeleting ? 0.3 : undefined }}
          >
            {isDeleting ? '⏳' : '×'}
          </button>
          <button 
            className="task-app__action-btn task-app__tag-btn"
            onClick={() => addTagToTask(task.id)}
            title="Add tag"
            disabled={isCompleting || isDeleting}
          >
            🏷️
          </button>
        </div>
      </li>
    )
  }

  function renderTaskLayout() {
    const topTags = getTopTags()
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
          {filteredTasks.map(task => renderTaskItem(task))}
        </ul>
      )
    }

    // Multiple tags: dynamic layout
    const layoutConfig = getLayoutConfig(tagCount)
    const remainingTasks = getRemainingTasks(topTags).filter(t => {
      if (!filter) return true
      return t.tag?.split(' ').includes(filter) || false
    })

    // Filter out empty tag columns when a filter is active
    const visibleTopTags = topTags.slice(0, layoutConfig.useTags).filter(tag => {
      if (!filter) return true // Show all columns when no filter
      
      // Only show columns that have tasks matching the filter
      let tagTasks = getTasksByTag(tag)
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
              let tagTasks = getTasksByTag(tag)
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
                    {sortTasksByAge(tagTasks, sortDirections[tag]).map(task => renderTaskItem(task, false))}
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
                  onClick={() => clearRemainingTasks(topTags)}
                  title="Clear all remaining tasks"
                >
                  🗑️
                </button>
              </div>
            </div>
            <ul className="task-app__list">
              {sortTasksByAge(remainingTasks, sortDirections['other']).map(task => renderTaskItem(task))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  function getLayoutConfig(tagCount: number) {
    if (tagCount === 2) return { columns: 2, useTags: 2, maxPerColumn: Infinity }
    if (tagCount === 3) return { columns: 3, useTags: 3, maxPerColumn: Infinity }
    if (tagCount >= 4 && tagCount <= 5) return { columns: 2, useTags: 4, maxPerColumn: 10 }
    return { columns: 3, useTags: 6, maxPerColumn: 10 } // 6+ tags
  }

  return (
    <div className="task-app">
      <h1 className="task-app__header">Tasks</h1>
      <div className="task-app__controls">
        <input
          ref={inputRef}
          className="task-app__input"
          placeholder="Type a task and press Enter…"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              addTask((e.target as HTMLInputElement).value)
            }
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              inputRef.current?.focus()
            }
          }}
        />
        <button 
          className="task-app__info-btn" 
          title="Task syntax:
• New task → New task
• &quot;New task&quot; → New task
• &quot;New task&quot; #friend #soon → New task with tags"
        >
          ℹ️
        </button>
      </div>
      <div className="task-app__filters">
        <button onClick={()=>setFilter(undefined)} className={!filter?'on':''}>All!</button>
        {Array.from(new Set(tasks.flatMap(t => t.tag?.split(' ') || []).filter(Boolean))).map(tag =>
          <button 
            key={tag} 
            onClick={()=>setFilter(tag)} 
            className={`${filter===tag?'on':''} ${dragOverFilter === tag ? 'task-app__filter-drag-over' : ''}`}
            onDragOver={(e) => onFilterDragOver(e, tag)}
            onDragLeave={onFilterDragLeave}
            onDrop={(e) => onFilterDrop(e, tag)}
          >
            #{tag}
          </button>
        )}
      </div>
      {renderTaskLayout()}
    </div>
  )
}
