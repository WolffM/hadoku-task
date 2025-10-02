import React, { useEffect, useRef, useState } from 'react'
import { createApi } from './lib/api'
import type { Task, TasksFile } from './lib/types'
import type { TaskAppProps } from './entry'

export default function App(props: TaskAppProps = {}) {
  const { basename = '/task', apiUrl, environment, userType = 'public' } = props;
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const canModify = userType === 'admin' || userType === 'friend'
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
    setTasks(tf.tasks || [])
  }

  async function addTask(title: string) {
    title = title.trim()
    if (!title) return
    if (!canModify) {
      alert('Only admin and friend users can create tasks')
      return
    }
    try {
      await api.createTask({ title })
      await reload()
      if (inputRef.current) {
        inputRef.current.value = ''
        inputRef.current.focus()
      }
    } catch (error) {
      alert((error as Error).message || 'Failed to create task')
    }
  }

  return (
    <div className="task-app">
      <h1 className="task-app__header">Tasks</h1>
      <div className="task-app__controls">
        <input
          ref={inputRef}
          className="task-app__input"
          placeholder={canModify ? "Type a task and press Enter…" : `Read-only view (${userType} access)`}
          disabled={!canModify}
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
        <button onClick={() => inputRef.current?.focus()}>Focus</button>
      </div>
      <div className="task-app__filters">
        <button onClick={()=>setFilter(undefined)} className={!filter?'on':''}>All!</button>
        {Array.from(new Set(tasks.map(t=>t.tag).filter(Boolean) as string[])).map(tag =>
          <button key={tag} onClick={()=>setFilter(tag)} className={filter===tag?'on':''}>#{tag}</button>
        )}
      </div>
      <ul className="task-app__list">
        {tasks
          .filter(t => !filter || !t.tag || filter===t.tag)
          .map(task => (
            <li key={task.id} className="task-app__item">
              <div className="task-app__item-title">{task.title}</div>
              {task.tag && <div className="task-app__item-tag">#{task.tag}</div>}
            </li>
          ))}
      </ul>
    </div>
  )
}
