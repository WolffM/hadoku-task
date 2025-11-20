# Type Exports Reference

Complete TypeScript type definitions exported by `@wolffm/task` for parent applications.

## Installation

```bash
npm install @wolffm/task
```

## Import Paths

```typescript
// API/Backend types and handlers
import { TaskHandlers, TaskStorage, Task, Board, UserPreferences } from '@wolffm/task/api'

// Frontend component
import { mount, TaskAppProps } from '@wolffm/task/frontend'
```

---

## Core Entity Types

### Task

The main task entity with all properties.

```typescript
interface Task {
  id: ULID // Unique identifier (ULID format)
  title: string // Task title/description
  tag?: string | null // Space-separated tags (#work #urgent)
  state: 'Active' | 'Deleted' | 'Completed' // Task state
  createdAt: string // ISO 8601 timestamp
  updatedAt?: string | null // ISO 8601 timestamp
  closedAt?: string | null // ISO 8601 timestamp (when completed/deleted)
}
```

**Example:**

```typescript
const task: Task = {
  id: '01HQABCDEF1234567890ABCDEF',
  title: 'Fix bug in login flow',
  tag: 'urgent backend',
  state: 'Active',
  createdAt: '2025-11-10T19:00:00.000Z',
  updatedAt: '2025-11-10T20:30:00.000Z',
  closedAt: null
}
```

---

### TasksFile

Storage format for a collection of tasks.

```typescript
interface TasksFile {
  version: 1
  updatedAt: string // ISO 8601 timestamp
  tasks: Task[]
}
```

---

### Board

Represents a task board (like "Work", "Personal", etc.).

```typescript
interface Board {
  id: string // Board identifier (e.g., "main", "work")
  name: string // Display name
  tasks: Task[] // Tasks in this board
  tags: string[] // Persistent list of known tags
  stats?: StatsFile // Optional statistics
}
```

**Example:**

```typescript
const board: Board = {
  id: "work",
  name: "Work Tasks",
  tasks: [...],
  tags: ["urgent", "backend", "frontend"],
  stats: {...}
}
```

---

### BoardsFile

Storage format for multiple boards.

```typescript
interface BoardsFile {
  version: 1
  updatedAt: string // ISO 8601 timestamp
  boards: Board[]
}
```

---

### StatsFile

Statistics and analytics for tasks.

```typescript
interface StatsFile {
  version: 2
  updatedAt: string
  counters: {
    created: number // Total tasks created
    completed: number // Total tasks completed
    edited: number // Total edits
    deleted: number // Total tasks deleted
  }
  timeline: Array<{
    t: string // ISO 8601 timestamp
    event: 'created' | 'completed' | 'edited' | 'deleted'
    id?: ULID // Task ID
  }>
  tasks: Record<ULID, StatsTaskRecord> // Historical snapshot of all tasks
}
```

---

### StatsTaskRecord

Historical record of a task (for statistics).

```typescript
interface StatsTaskRecord {
  id: ULID
  title: string
  tag?: string | null
  state: 'Active' | 'Deleted' | 'Completed'
  createdAt: string
  updatedAt?: string | null
  closedAt?: string | null
}
```

---

## User & Preferences Types

### UserPreferences

User preferences and settings (synced to server for non-public users).

```typescript
interface UserPreferences {
  version: 1
  updatedAt: string
  experimentalThemes?: boolean // Enable experimental themes
  alwaysVerticalLayout?: boolean // Force mobile layout on all devices
  userName?: string // User's display name

  // Device-specific settings (localStorage priority)
  theme?: string // Current theme
  showCompleteButton?: boolean // Show complete (✓) button
  showDeleteButton?: boolean // Show delete (×) button
  showTagButton?: boolean // Show tag button
}
```

**Storage Priority:**

```
localStorage > Server API > Default values
```

**Example:**

```typescript
const prefs: UserPreferences = {
  version: 1,
  updatedAt: '2025-11-10T19:00:00.000Z',
  experimentalThemes: false,
  alwaysVerticalLayout: false,
  userName: 'John Doe',
  theme: 'dark',
  showCompleteButton: true,
  showDeleteButton: true,
  showTagButton: false
}
```

---

### UserType

User type identifier (string-based for flexibility).

```typescript
type UserType = string
```

**Special Values:**

- `"public"` - localStorage-only, no server sync
- `"friend"` - Server sync enabled
- `"admin"` - Server sync enabled with admin privileges
- Custom values supported

---

## API Input Types

### CreateTaskInput

Input for creating a new task.

```typescript
interface CreateTaskInput {
  id?: string // Optional client-generated ID (ULID)
  title: string // Required task title
  tag?: string // Optional tags (space-separated)
  createdAt?: string // Optional original timestamp (for imports)
}
```

**Example:**

```typescript
const input: CreateTaskInput = {
  title: 'Review pull request',
  tag: 'code-review urgent'
}
```

---

### UpdateTaskInput

Input for updating an existing task.

```typescript
interface UpdateTaskInput {
  title?: string // New title (optional)
  tag?: string // New tags (optional, can be null to clear)
}
```

**Example:**

```typescript
const update: UpdateTaskInput = {
  title: 'Review and approve pull request',
  tag: 'code-review'
}
```

---

### AuthContext

Authentication context for API handlers.

```typescript
interface AuthContext {
  userType: UserType // User type identifier
  sessionId?: string // Session identifier
}
```

**Example:**

```typescript
const auth: AuthContext = {
  userType: 'friend',
  sessionId: 'session-abc123'
}
```

---

## Storage Interface

### TaskStorage

Storage interface that parent apps must implement.

```typescript
interface TaskStorage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementation Example:**

```typescript
import { TaskStorage, TasksFile, StatsFile } from '@wolffm/task/api'

// Cloudflare Workers KV implementation
const storage: TaskStorage = {
  getTasks: async userType => {
    const data = await env.TASK_KV.get(`tasks:${userType}`, 'json')
    return data || defaultTasksFile
  },
  saveTasks: async (userType, tasks) => {
    await env.TASK_KV.put(`tasks:${userType}`, JSON.stringify(tasks))
  },
  getStats: async userType => {
    const data = await env.TASK_KV.get(`stats:${userType}`, 'json')
    return data || defaultStatsFile
  },
  saveStats: async (userType, stats) => {
    await env.TASK_KV.put(`stats:${userType}`, JSON.stringify(stats))
  }
}
```

---

## Frontend Types

### TaskAppProps

Props for mounting the task app frontend.

```typescript
interface TaskAppProps {
  basename?: string // Base URL path
  userType?: 'public' | 'friend' | 'admin' // User type
  sessionId?: string // Session ID
}
```

**Usage Example:**

```typescript
import { mount, TaskAppProps } from '@wolffm/task/frontend'

const props: TaskAppProps = {
  userType: 'friend',
  sessionId: 'user-session-123',
}

const container = document.getElementById('task-app')
mount(container, props)
```

---

## Utility Types

### ULID

Universally Unique Lexicographically Sortable Identifier.

```typescript
type ULID = string
```

**Format:** 26 characters, case-insensitive  
**Example:** `01HQABCDEF1234567890ABCDEF`

---

## Handler Functions

### TaskHandlers

Namespace containing all task operation handlers.

```typescript
import { TaskHandlers, TaskStorage, AuthContext, CreateTaskInput } from '@wolffm/task/api'

// Create task
const task = await TaskHandlers.createTask(
  storage: TaskStorage,
  auth: AuthContext,
  input: CreateTaskInput
)

// Update task
const updated = await TaskHandlers.updateTask(
  storage: TaskStorage,
  auth: AuthContext,
  taskId: string,
  input: UpdateTaskInput
)

// Complete task
await TaskHandlers.completeTask(
  storage: TaskStorage,
  auth: AuthContext,
  taskId: string
)

// Delete task
await TaskHandlers.deleteTask(
  storage: TaskStorage,
  auth: AuthContext,
  taskId: string
)

// Get all tasks
const tasks = await TaskHandlers.getTasks(
  storage: TaskStorage,
  auth: AuthContext
)
```

**Available Handlers:**

- `createTask(storage, auth, input)` → `Task`
- `updateTask(storage, auth, taskId, input)` → `Task`
- `completeTask(storage, auth, taskId)` → `void`
- `deleteTask(storage, auth, taskId)` → `void`
- `getTasks(storage, auth)` → `TasksFile`
- `getStats(storage, auth)` → `StatsFile`
- Board operations, tag operations, batch operations (see API.md)

---

## Type Guards & Utilities

### TaskUtils

Utility functions for task operations.

```typescript
import { TaskUtils } from '@wolffm/task/api'

// Check if task has specific tag
TaskUtils.hasTag(task: Task, tag: string): boolean

// Extract tags from task
TaskUtils.getTags(task: Task): string[]

// Additional utilities available
```

---

## Testing Examples

### Type-Safe Tests

```typescript
import { describe, it, expect } from 'vitest'
import type { Task, CreateTaskInput, TaskStorage } from '@wolffm/task/api'
import { TaskHandlers } from '@wolffm/task/api'

describe('Task Operations', () => {
  it('should create task with correct types', async () => {
    const mockStorage: TaskStorage = {
      getTasks: async () => ({ version: 1, updatedAt: '', tasks: [] }),
      saveTasks: async () => {},
      getStats: async () => ({ version: 2, updatedAt: '', counters: {...}, timeline: [], tasks: {} }),
      saveStats: async () => {}
    }

    const input: CreateTaskInput = {
      title: 'Test task',
      tag: 'testing'
    }

    const task: Task = await TaskHandlers.createTask(
      mockStorage,
      { userType: 'public' },
      input
    )

    expect(task.title).toBe('Test task')
    expect(task.state).toBe('Active')
  })
})
```

---

## Related Documentation

- **[API.md](API.md)** - Complete API endpoint reference
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and patterns
- **[README.md](../README.md)** - Getting started guide

---

## Summary Table

| Type              | Category  | Exported From           | Purpose                         |
| ----------------- | --------- | ----------------------- | ------------------------------- |
| `Task`            | Entity    | `@wolffm/task/api`      | Main task data structure        |
| `Board`           | Entity    | `@wolffm/task/api`      | Board/workspace data            |
| `UserPreferences` | Config    | `@wolffm/task/api`      | User settings                   |
| `TaskStorage`     | Interface | `@wolffm/task/api`      | Storage implementation contract |
| `CreateTaskInput` | Input     | `@wolffm/task/api`      | Create task parameters          |
| `UpdateTaskInput` | Input     | `@wolffm/task/api`      | Update task parameters          |
| `AuthContext`     | Auth      | `@wolffm/task/api`      | Authentication context          |
| `TaskHandlers`    | Functions | `@wolffm/task/api`      | Business logic handlers         |
| `TaskAppProps`    | Frontend  | `@wolffm/task/frontend` | React component props           |

---

**Version:** 3.4.0  
**Last Updated:** November 10, 2025
