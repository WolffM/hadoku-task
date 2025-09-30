import React, { useEffect, useRef, useState } from 'react'
import { api } from './lib/api'
import type { Task, TasksFile } from './lib/types'
import type { TaskAppProps } from './entry'

export default function App(props: TaskAppProps = {}) {
  const { basename = '/task', apiUrl, environment } = props;
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void reload()
    inputRef.current?.focus()
    try {
      const bc = new BroadcastChannel('tasks')
      bc.onmessage = (e) => {
        if (e.data?.type === 'tasks-updated') reload()
      }
      return () => bc.close()
    } catch {}
  }, [])

  async function reload() {
    const tf: TasksFile = await api.getTasks()
    setTasks(tf.tasks || [])
  }

  async function addTask(title: string) {
    title = title.trim()
    if (!title) return
    await api.createTask({ title })
    await reload()
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  return (
    <div className="wrap" style={{maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, Segoe UI, Arial'}}>
      <h1 style={{fontSize: 24, marginBottom: 12}}>Tasks</h1>
      <div className="bar" style={{display: 'flex', gap: 8, marginBottom: 12}}>
        <input
          ref={inputRef}
          style={{flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 16}}
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
        <button onClick={() => inputRef.current?.focus()} style={{padding: '10px 12px'}}>Focus</button>
      </div>
      <div className="filters" style={{display: 'flex', gap: 8, marginBottom: 12}}>
        <button onClick={()=>setFilter(undefined)} className={!filter?'on':''}>All</button>
        {Array.from(new Set(tasks.map(t=>t.tag).filter(Boolean) as string[])).map(tag =>
          <button key={tag} onClick={()=>setFilter(tag)} className={filter===tag?'on':''}>#{tag}</button>
        )}
      </div>
      <ul className="list" style={{listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8}}>
        {tasks
          .filter(t => !filter || !t.tag || filter===t.tag)
          .map(task => (
            <li key={task.id} style={{padding: '12px', border: '1px solid #eee', borderRadius: 8}}>
              <div style={{fontWeight: 500}}>{task.title}</div>
              {task.tag && <div style={{fontSize: 12, color: '#666', marginTop: 4}}>#{task.tag}</div>}
            </li>
          ))}
      </ul>
    </div>
  )
}
