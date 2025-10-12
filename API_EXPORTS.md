# API Exports Documentation

## What's exported from `@wolffm/task/api`

### 1. `TaskHandlers` - Framework-agnostic business logic

**Purpose:** Pure functions that handle all task operations. No framework dependencies.

**Exports:**
```typescript
import { TaskHandlers } from '@wolffm/task/api'

// Available functions:
TaskHandlers.getTasks(storage, auth)           // Get all tasks for user
TaskHandlers.createTask(storage, auth, input)  // Create new task
TaskHandlers.updateTask(storage, auth, id, input) // Update existing task
TaskHandlers.completeTask(storage, auth, id)   // Mark task as complete
TaskHandlers.deleteTask(storage, auth, id)     // Delete task
TaskHandlers.clearTasks(storage, auth)         // Clear all tasks (public only)
TaskHandlers.getStats(storage, auth)           // Get stats
```

**Implementation:** `src/server/handlers.ts`

---

### 2. `TaskStorage` - Storage interface

**Purpose:** Interface that defines how data is stored/retrieved. Parent implements this for their environment.

**Definition:**
```typescript
import type { TaskStorage } from '@wolffm/task/api'

interface TaskStorage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Parent implements it:**
```typescript
// Example: Cloudflare KV implementation
const storage: TaskStorage = {
  async getTasks(userType) {
    const data = await env.KV.get(`tasks:${userType}`)
    return JSON.parse(data || '{"version":1,"tasks":[],"updatedAt":"..."}')
  },
  async saveTasks(userType, tasks) {
    await env.KV.put(`tasks:${userType}`, JSON.stringify(tasks))
  },
  // ... same for getStats/saveStats
}
```

**Implementation:** `src/server/storage.ts` (exports the interface)

---

### 3. `AuthContext` - Authentication context type

**Purpose:** Defines the authentication/authorization context passed to handlers.

**Definition:**
```typescript
import type { AuthContext } from '@wolffm/task/api'

interface AuthContext {
  userType: 'public' | 'friend' | 'admin'
}
```

**Usage:**
```typescript
const auth: AuthContext = { userType: 'friend' }
await TaskHandlers.createTask(storage, auth, { title: 'New task' })
```

**Implementation:** `src/server/types.ts`

---

### 4. Data Types - Task structure types

**Purpose:** TypeScript types for data structures.

**Exports:**
```typescript
import type { 
  Task,           // Individual task
  TasksFile,      // tasks.json structure
  StatsFile,      // stats.json structure
  UserType,       // 'public' | 'friend' | 'admin'
  CreateTaskInput,  // Input for creating task
  UpdateTaskInput,  // Input for updating task
  ULID            // Task ID type
} from '@wolffm/task/api'
```

**Task structure:**
```typescript
interface Task {
  id: ULID
  title: string
  tag: string | null
  state: 'Active' | 'Completed'
  createdAt: string  // ISO timestamp
  updatedAt?: string
  closedAt?: string
}
```

**Implementation:** `src/server/types.ts`

---

### 5. `TaskUtils` - Utility functions

**Purpose:** Helper functions for working with tasks.

**Exports:**
```typescript
import { TaskUtils } from '@wolffm/task/api'

TaskUtils.now()              // Get current ISO timestamp
TaskUtils.generateULID()     // Generate unique task ID (not actually exported yet)
```

**Implementation:** `src/server/utils.ts`

---

## How Parent Uses These Exports

### Cloudflare Worker with Hono + KV Example:

```typescript
import { Hono } from 'hono'
import { TaskHandlers, TaskStorage, AuthContext } from '@wolffm/task/api'

const app = new Hono<{ Bindings: { TASK_KV: KVNamespace } }>()

// Implement storage for Cloudflare Workers KV
function createStorage(env): TaskStorage {
  return {
    async getTasks(userType) {
      const data = await env.TASK_KV.get(`tasks:${userType}`)
      return JSON.parse(data || '{"version":1,"tasks":[],"updatedAt":"..."}')
    },
    async saveTasks(userType, tasks) {
      await env.TASK_KV.put(`tasks:${userType}`, JSON.stringify(tasks))
    },
    async getStats(userType) {
      const data = await env.TASK_KV.get(`stats:${userType}`)
      return JSON.parse(data || '{"version":2,"counters":{...},"timeline":[],"tasks":{},"updatedAt":"..."}')
    },
    async saveStats(userType, stats) {
      await env.TASK_KV.put(`stats:${userType}`, JSON.stringify(stats))
    }
  }
}

// Create routes using handlers
app.get('/task/api', async (c) => {
  const storage = createStorage(c.env)
  const userType = c.req.query('userType') || 'public'
  const auth: AuthContext = { userType }
  
  const result = await TaskHandlers.getTasks(storage, auth)
  return c.json(result)
})

app.post('/task/api', async (c) => {
  const storage = createStorage(c.env)
  const userType = c.req.header('X-User-Type') || 'public'
  const auth: AuthContext = { userType }
  const input = await c.req.json()
  
  const result = await TaskHandlers.createTask(storage, auth, input)
  return c.json(result)
})

// ... more routes

export default app
```

---

## Verification Checklist

Let me verify each export actually exists:

### ✅ TaskHandlers
- [ ] getTasks
- [ ] createTask  
- [ ] updateTask
- [ ] completeTask
- [ ] deleteTask
- [ ] clearTasks
- [ ] getStats

### ✅ TaskStorage (interface)
- [ ] getTasks method
- [ ] saveTasks method
- [ ] getStats method
- [ ] saveStats method

### ✅ Types
- [ ] AuthContext
- [ ] Task
- [ ] TasksFile
- [ ] StatsFile
- [ ] UserType
- [ ] CreateTaskInput
- [ ] UpdateTaskInput
- [ ] ULID

### ✅ TaskUtils
- [ ] now()

---

## What's NOT Exported (and shouldn't be)

- `createTaskRouter` - Express-specific adapter (optional convenience, not part of Universal Adapter)
- `GitHubStorage` - Parent implements storage themselves
- `SyncQueue` - Internal implementation detail
- `writeFileSync` - Internal filesystem operations
- Express routes - Framework-specific

---

## Key Design Principles

1. **Framework Agnostic** - Handlers have no framework dependencies
2. **Storage Abstraction** - Parent chooses storage (KV, DB, filesystem)
3. **Pure Functions** - Handlers are testable, predictable
4. **Type Safety** - Full TypeScript support
5. **Flexibility** - Works with Hono, Express, or any framework
