# @hadoku/task - Parent API Reference

**Quick reference for integrating task handlers into parent worker**

---

## Import

```typescript
import { TaskHandlers, type Storage, type AuthContext } from '@hadoku/task/api'
```

---

## Handler Functions

### **Boards**

```typescript
// GET /api/boards
getBoards(storage, auth)
→ BoardsFile // { version, updatedAt, boards: Board[] }

// GET /api/boards/:boardId/tasks
getBoardTasks(storage, auth, boardId)
→ Task[]

// GET /api/boards/:boardId/stats
getBoardStats(storage, auth, boardId)
→ StatsFile

// POST /api/boards
createBoard(storage, auth, { id, name })
→ { ok: boolean, board: Board }

// DELETE /api/boards/:boardId
deleteBoard(storage, auth, boardId)
→ { ok: boolean, message: string }
```

### **Tasks**

```typescript
// POST /api/boards/:boardId/tasks
createTask(storage, auth, { id?, title, tag? }, boardId = 'main')
→ { ok: boolean, id: ULID }

// PATCH /api/boards/:boardId/tasks/:taskId
updateTask(storage, auth, taskId, { title?, tag? }, boardId = 'main')
→ { ok: boolean, message: string }

// POST /api/boards/:boardId/tasks/:taskId/complete
completeTask(storage, auth, taskId, boardId = 'main')
→ { ok: boolean, message: string }

// DELETE /api/boards/:boardId/tasks/:taskId
deleteTask(storage, auth, taskId, boardId = 'main')
→ { ok: boolean, message: string }
```

### **Tags**

```typescript
// POST /api/boards/:boardId/tags
createTag(storage, auth, { boardId, tag })
→ { ok: boolean, message: string }

// DELETE /api/boards/:boardId/tags/:tag
deleteTag(storage, auth, { boardId, tag })
→ { ok: boolean, message: string }
```

---

## Storage Interface

```typescript
interface Storage {
  // Tasks
  getTasks(userType: string, userId?: string, boardId?: string): Promise<TasksFile>
  saveTasks(userType: string, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>
  
  // Stats
  getStats(userType: string, userId?: string, boardId?: string): Promise<StatsFile>
  saveStats(userType: string, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>
  
  // Boards
  getBoards(userType: string, userId?: string): Promise<BoardsFile>
  saveBoards(userType: string, boards: BoardsFile, userId?: string): Promise<void>
}
```

**File Paths:**
```
data/{userType}/{userId}/{boardId}/tasks.json  → TasksFile
data/{userType}/{userId}/{boardId}/stats.json  → StatsFile
data/{userType}/{userId}/boards.json           → BoardsFile
```

---

## Auth Context

```typescript
interface AuthContext {
  userType: string  // 'public' | 'friend' | 'admin' | custom
  userId?: string   // Data scoping identifier
}
```

**Auth Matrix:**

| Operation | Public | Friend | Admin |
|-----------|--------|--------|-------|
| Read (GET) | ✅ | ✅ | ✅ |
| Create | ❌ | ✅ | ✅ |
| Update | ❌ | ✅ | ✅ |
| Delete | ❌ | ✅ | ✅ |

_Note: Public users use in-memory storage (not persisted)_

---

## Data Types

```typescript
// Core
type ULID = string
type UserType = string

// Task
interface Task {
  id: ULID
  title: string
  tag?: string | null
  state: 'Active' | 'Completed' | 'Deleted'
  createdAt: string  // ISO 8601
  updatedAt?: string | null
  closedAt?: string | null
}

// Board
interface Board {
  id: string
  name: string
  tasks: Task[]
  tags: string[]
  stats?: StatsFile
}

// Files
interface TasksFile {
  version: 1
  updatedAt: string
  tasks: Task[]
}

interface BoardsFile {
  version: 1
  updatedAt: string
  boards: Board[]
}

interface StatsFile {
  version: 2
  updatedAt: string
  counters: { created: number, completed: number, edited: number, deleted: number }
  timeline: Array<{ t: string, event: string, id?: ULID }>
  tasks: Record<ULID, Task>
}
```

---

## Error Handling

**Handlers throw errors with descriptive messages:**

| Error Message | HTTP Status |
|---------------|-------------|
| `"Task not found"` | 404 |
| `"Board not found"` | 404 |
| `"Board {id} already exists"` | 409 |
| `"Cannot delete the main board"` | 400 |
| `"Title is required"` | 400 |
| Other | 500 |

---

## Example Route Implementation

```typescript
import { Hono } from 'hono'
import { TaskHandlers, type Storage, type AuthContext } from '@hadoku/task/api'

const app = new Hono()

// Middleware: Create auth context from session
app.use('/api/*', async (c, next) => {
  const sessionId = c.req.header('X-Session-Id')
  const key = await resolveSession(sessionId)
  const userType = getUserTypeFromKey(key)
  const userId = c.req.query('userId')
  
  c.set('auth', { userType, userId })
  await next()
})

// GET /api/boards
app.get('/api/boards', async (c) => {
  const auth = c.get('auth') as AuthContext
  const result = await TaskHandlers.getBoards(storage, auth)
  return c.json(result)
})

// POST /api/boards/:boardId/tasks
app.post('/api/boards/:boardId/tasks', async (c) => {
  const auth = c.get('auth') as AuthContext
  const boardId = c.req.param('boardId')
  const input = await c.req.json()
  
  try {
    const result = await TaskHandlers.createTask(storage, auth, input, boardId)
    return c.json(result, 201)
  } catch (err) {
    if (err.message.includes('already exists')) {
      return c.json({ error: err.message }, 409)
    }
    if (err.message.includes('not found')) {
      return c.json({ error: err.message }, 404)
    }
    return c.json({ error: err.message }, 400)
  }
})

// DELETE /api/boards/:boardId/tasks/:taskId
app.delete('/api/boards/:boardId/tasks/:taskId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const boardId = c.req.param('boardId')
  const taskId = c.req.param('taskId')
  
  try {
    const result = await TaskHandlers.deleteTask(storage, auth, taskId, boardId)
    return c.json(result)
  } catch (err) {
    if (err.message.includes('not found')) {
      return c.json({ error: err.message }, 404)
    }
    return c.json({ error: err.message }, 500)
  }
})
```

---

## Session Flow

1. **Client** → Sends `X-Session-Id` header
2. **Edge Router** → Resolves session → injects `X-User-Key`
3. **API Worker** → Validates key → creates `AuthContext`
4. **Handler** → Uses auth for permissions & data scoping

---

## Quick Notes

- **Default boardId:** `'main'` (used when not specified)
- **ULID Generation:** Client can provide `input.id`, server generates if missing
- **Public Users:** In-memory only (not persisted to storage)
- **Multi-Board:** All operations are board-scoped except board management
- **Stats Tracking:** Automatically updated on all task operations
- **Tag Persistence:** Tags remain on board even when no tasks have that tag

---

**Package:** `@hadoku/task@2.2.28`  
**Compliance:** 98% (storage interface is domain-specific)  
**Updated:** October 14, 2025
