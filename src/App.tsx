import React, { useEffect, useRef, useState } from 'react'
import type { TaskAppProps } from './entry'
import { useTasks } from './hooks/useTasks'
import { useDragAndDrop } from './hooks/useDragAndDrop'
import { useTaskSort } from './hooks/useTaskSort'
import { TaskLayout } from './components/TaskLayout'
import { getTopTags, getAllTags } from './lib/tagUtils'

export default function App(props: TaskAppProps = {}) {
  const { basename = '/task', apiUrl, environment, userType = 'public' } = props;
  const [filter, setFilter] = useState<string | undefined>(undefined)
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
    clearTasksByTag,
    clearRemainingTasks
  } = useTasks({ userType, isPublic })

  // Drag and drop hook
  const dragAndDrop = useDragAndDrop({ 
    tasks, 
    onTaskUpdate: updateTaskTags 
  })

  // Sort hook
  const sortHook = useTaskSort()

  // Initialize and setup broadcast channel
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

  // Handle task input
  async function handleAddTask(input: string) {
    const success = await addTask(input)
    if (success && inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  // Get top tags for layout
  const topTags = getTopTags(tasks)

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
              handleAddTask((e.target as HTMLInputElement).value)
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
        <button onClick={() => setFilter(undefined)} className={!filter ? 'on' : ''}>All!</button>
        {getAllTags(tasks).map(tag =>
          <button 
            key={tag} 
            onClick={() => setFilter(tag)} 
            className={`${filter === tag ? 'on' : ''} ${dragAndDrop.dragOverFilter === tag ? 'task-app__filter-drag-over' : ''}`}
            onDragOver={(e) => dragAndDrop.onFilterDragOver(e, tag)}
            onDragLeave={dragAndDrop.onFilterDragLeave}
            onDrop={(e) => dragAndDrop.onFilterDrop(e, tag)}
          >
            #{tag}
          </button>
        )}
      </div>
      <TaskLayout
        tasks={tasks}
        topTags={topTags}
        filter={filter}
        sortDirections={sortHook.sortDirections}
        dragOverTag={dragAndDrop.dragOverTag}
        pendingOperations={pendingOperations}
        onComplete={completeTask}
        onDelete={deleteTask}
        onAddTag={addTagToTask}
        onDragStart={dragAndDrop.onDragStart}
        onDragOver={dragAndDrop.onDragOver}
        onDragLeave={dragAndDrop.onDragLeave}
        onDrop={dragAndDrop.onDrop}
        toggleSort={sortHook.toggleSort}
        sortTasksByAge={sortHook.sortTasksByAge}
        getSortIcon={sortHook.getSortIcon}
        getSortTitle={sortHook.getSortTitle}
        clearTasksByTag={clearTasksByTag}
        clearRemainingTasks={clearRemainingTasks}
      />
    </div>
  )
}
