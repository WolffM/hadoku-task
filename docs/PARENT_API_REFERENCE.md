# @wolffm/task - Parent API Reference

**Quick reference for integrating task handlers into parent worker**

Version: 3.0.25+ | Last Updated: October 15, 2025

**⚠️ Breaking Change in v3.0.25:**
- Tag deletion endpoint changed from `DELETE /task/api/tags` to `POST /task/api/tags/delete`
- Body now required: `{ boardId: string, tag: string }`

---

## Import

```typescript
import { TaskHandlers, type TaskStorage, type AuthContext } from '@wolffm/task/api'
```

---

## Handler Signatures

All handlers follow: `TaskHandlers.handlerName(storage, auth, ...params)`

### **Boards**

```typescript
// Get all boards with populated tasks/stats
getBoards(storage, auth: AuthContext & { userId?: string })
→ Promise<BoardsFile>

// Create new board
createBoard(storage, auth, { id: string, name: string })
→ Promise<{ ok: boolean, board: Board }>

// Delete board
deleteBoard(storage, auth, boardId: string)
→ Promise<{ ok: boolean, message: string }>
```

### **Tasks**

```typescript
// Create task (supports id/createdAt for moves)
createTask(storage, auth, { title, tag?, id?, createdAt? }, boardId = 'main')
→ Promise<{ ok: boolean, id: string }>

// Update task
updateTask(storage, auth, taskId, { title?, tag? }, boardId = 'main')
→ Promise<{ ok: boolean, message: string }>

// Complete task (removes from active, records in stats)
completeTask(storage, auth, taskId, boardId = 'main')
→ Promise<{ ok: boolean, message: string }>

// Delete task
deleteTask(storage, auth, taskId, boardId = 'main')
→ Promise<{ ok: boolean, message: string }>
```

### **Tags**

```typescript
// Add persisted tag to board
createTag(storage, auth, { boardId, tag })
→ Promise<{ ok: boolean, message: string }>

// Remove tag from board
deleteTag(storage, auth, { boardId, tag })
→ Promise<{ ok: boolean, message: string }>
```

### **Batch Operations**

```typescript
// Update tags on multiple tasks
batchUpdateTags(storage, auth, { boardId, updates: [{ taskId, tag }] })
→ Promise<{ ok: boolean, message: string, updated: number }>

// Move tasks between boards (preserves IDs)
batchMoveTasks(storage, auth, { sourceBoardId, targetBoardId, taskIds: string[] })
→ Promise<{ ok: boolean, message: string, moved: number }>

// Clear tag from tasks and remove from board
batchClearTag(storage, auth, { boardId, tag, taskIds: string[] })
→ Promise<{ ok: boolean, message: string, cleared: number }>

// NOTE: This operation removes the tag from all specified tasks,
// then deletes the tag from the board's persisted tags list.
```

### **Preferences**

```typescript
// Get user preferences
getPreferences(storage, auth)
→ Promise<UserPreferences>

// Save user preferences
savePreferences(storage, auth, prefs: Partial<UserPreferences>)
→ Promise<{ ok: boolean }>
```

**Note:** Theme is NOT stored in preferences - it's per-device in sessionStorage.

### **User Management**

```typescript
// Validate key
validateKey(storage, auth, { key: string })
→ Promise<{ valid: boolean }>

// Update user ID for current session
setUserId(storage, auth, { newUserId: string })
→ Promise<{ ok: boolean, message: string }>
```

**Purpose:** These endpoints manage the relationship between keys, sessionIds, and userIds:
- `validateKey`: Checks if a key is valid and can be mapped to sessionId + userId
- `setUserId`: Updates which userId is mapped to the current sessionId (backend-only operation)

**Note:** userId is primarily for display and validation. If the user sees their userId in the app, their key loaded correctly and is mapped to both a sessionId and userId.

---

## Storage Interface

```typescript
interface TaskStorage {
  // Board operations
  getBoards(userType: string, userId?: string): Promise<BoardsFile>
  saveBoards(userType: string, boards: BoardsFile, userId?: string): Promise<void>
  
  // Board data cleanup
  deleteBoardData(userType: string, userId: string, boardId: string): Promise<void>
  
  // Task operations (board-scoped)
  getTasks(userType: string, userId?: string, boardId?: string): Promise<TasksFile>
  saveTasks(userType: string, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>
  
  // Stats operations (board-scoped)
  getStats(userType: string, userId?: string, boardId?: string): Promise<StatsFile>
  saveStats(userType: string, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>
}
```

---

## AuthContext

```typescript
interface AuthContext {
  userType: 'public' | 'friend' | 'admin' | 'registered'
  userId?: string  // Optional user ID for multi-user scenarios
}
```

**Note:** Use `userType: 'registered'` for localStorage operations to bypass server-only auth checks.

---

## Type Definitions

```typescript
interface BoardsFile {
  version: 1
  updatedAt: string  // ISO 8601
  boards: Board[]
}

interface Board {
  id: string
  name: string
  tasks: Task[]
  tags?: string[]
  stats?: StatsFile
}

interface Task {
  id: string  // ULID
  title: string
  tag?: string  // Space-separated tags
  state: 'Active' | 'Deleted' | 'Completed'
  createdAt: string  // ISO 8601
  updatedAt?: string
  closedAt?: string
}

interface TasksFile {
  version: 1
  updatedAt: string
  tasks: Task[]
}

interface StatsFile {
  version: 2
  updatedAt: string
  counters: {
    created: number
    completed: number
    edited: number
    deleted: number
  }
  timeline: Array<{ t: string, event: string, id?: string }>
  tasks: Record<string, StatsTaskRecord>
}
```

---

## Worker Integration Example

```typescript
import { TaskHandlers, type TaskStorage } from '@wolffm/task/api'

// Implement storage for Cloudflare Workers KV
const storage: TaskStorage = {
  async getBoards(userType, userId) {
    const key = `${userType}-${userId || 'default'}-boards`
    const data = await env.KV.get(key, 'json')
    return data || { version: 1, updatedAt: new Date().toISOString(), boards: [] }
  },
  
  async saveBoards(userType, boards, userId) {
    const key = `${userType}-${userId || 'default'}-boards`
    await env.KV.put(key, JSON.stringify(boards))
  },
  
  // ... implement other methods
}

// Use in request handler
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const userType = request.headers.get('X-User-Type') || 'public'
    const userId = request.headers.get('X-User-Id')
    const auth = { userType, userId }
    
    if (url.pathname === '/api/boards' && request.method === 'GET') {
      const boards = await TaskHandlers.getBoards(storage, auth)
      return Response.json(boards)
    }
    
    if (url.pathname === '/api' && request.method === 'POST') {
      const body = await request.json()
      const result = await TaskHandlers.createTask(storage, auth, body, body.boardId)
      return Response.json(result)
    }
    
    // Complete task - IMPORTANT: Extract boardId from body!
    if (url.pathname.match(/^\/api\/([^\/]+)\/complete$/) && request.method === 'POST') {
      const taskId = url.pathname.split('/')[2]
      const body = await request.json()
      const result = await TaskHandlers.completeTask(storage, auth, taskId, body.boardId)
      return Response.json(result)
    }
    
    // Delete task - IMPORTANT: Extract boardId from body!
    if (url.pathname.match(/^\/api\/([^\/]+)$/) && request.method === 'DELETE') {
      const taskId = url.pathname.split('/')[2]
      const body = await request.json()
      const result = await TaskHandlers.deleteTask(storage, auth, taskId, body.boardId)
      return Response.json(result)
    }
    
    // Create tag
    if (url.pathname === '/api/tags' && request.method === 'POST') {
      const body = await request.json()
      const result = await TaskHandlers.createTag(storage, auth, body)
      return Response.json(result)
    }
    
    // Delete tag (Breaking Change v3.0.25+)
    if (url.pathname === '/api/tags/delete' && request.method === 'POST') {
      const body = await request.json()
      const result = await TaskHandlers.deleteTag(storage, auth, body)
      return Response.json(result)
    }
    
    // ... other routes
  }
}
```

---

## API Endpoint Mapping

When implementing HTTP routes in your worker, map to these paths:

### Tag Operations
```typescript
// Create tag
POST /task/api/tags → TaskHandlers.createTag(storage, auth, body)

// Delete tag (Breaking Change v3.0.25+)
POST /task/api/tags/delete → TaskHandlers.deleteTag(storage, auth, body)
// Body: { boardId: string, tag: string }
```

**Breaking Change:** The delete tag endpoint changed from `DELETE /task/api/tags` to `POST /task/api/tags/delete` in v3.0.25 to align with parent API routing conventions.

---

## Notes

- **IDs**: Tasks use ULID format (sortable by creation time)
- **Timestamps**: ISO 8601 strings
- **Tags**: Space-separated strings (e.g., `"urgent work"`)
- **Main Board**: Created automatically, cannot be deleted
- **Board Scoping**: All task operations require boardId parameter
- **Batch Operations**: Use for multi-task updates to avoid race conditions
- **Task Moves**: Use `batchMoveTasks` to preserve task IDs across boards

---

## Error Handling

Handlers throw errors for validation failures:
- `"Task not found"`
- `"Board not found"`
- `"Cannot delete main board"`
- `"Forbidden: Only public users can..."`

Catch and return appropriate HTTP status codes in your worker.

---

**Package:** `@wolffm/task`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
