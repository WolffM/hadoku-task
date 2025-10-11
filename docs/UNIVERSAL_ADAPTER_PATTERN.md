# Universal Adapter Pattern Implementation

## Summary

The `hadoku-task` repository has been successfully refactored to use the **Universal Adapter Pattern**. All business logic is now extracted into framework-agnostic handlers in the `api/` directory.

## What Changed

### New Directory Structure

```
hadoku-task/
├── src/
│   ├── (React frontend)
│   └── server/
│       ├── api/                  # NEW: Framework-agnostic business logic
│       │   ├── types.ts         # Core TypeScript types
│       │   ├── storage.ts       # Storage interface definition
│       │   ├── handlers.ts      # Pure business logic functions
│       │   ├── index.ts         # Main export file
│       │   ├── tsconfig.json    # TypeScript config for API
│       │   └── README.md        # API documentation
│       ├── storage-adapter.ts   # Storage implementation
│       ├── routes-adapter.ts    # Express routes
│       └── router.ts            # Main router
├── package.json                 # Updated with exports
└── ...
```

### Updated Files

**`package.json`**
- Changed name from `hadoku-task-app` to `@hadoku/task`
- Added exports configuration:
  ```json
  "exports": {
    ".": "./dist/index.js",                 // React frontend
    "./api": "./src/server/api/index.ts"   // Business logic handlers
  }
  ```

## API Structure

### Types (`api/types.ts`)

Defines all core types:
- `Task`: Task data structure
- `TasksFile`: Tasks file format
- `StatsFile`: Statistics file format
- `UserType`: 'public' | 'friend' | 'admin'
- `AuthContext`: Authentication context
- `CreateTaskInput`: Input for creating tasks
- `UpdateTaskInput`: Input for updating tasks

### Storage Interface (`api/storage.ts`)

Defines the contract for data persistence:
```typescript
interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

### Handlers (`api/handlers.ts`)

Pure functions for all operations:
- `getTasks(storage, auth)` - Get all active tasks
- `getStats(storage, auth)` - Get task statistics
- `createTask(storage, auth, input)` - Create a new task
- `updateTask(storage, auth, taskId, input)` - Update a task
- `completeTask(storage, auth, taskId)` - Complete a task
- `deleteTask(storage, auth, taskId)` - Delete a task
- `clearTasks(storage, auth)` - Clear all tasks (public only)

## Benefits

1. **Framework Independence**: Handlers work with Express, Hono, Cloudflare Workers, or any framework
2. **Easy Testing**: Pure functions are trivial to unit test
3. **Code Reusability**: Same handlers in development (Express) and production (CF Workers)
4. **Type Safety**: Full TypeScript support throughout
5. **Clean Architecture**: Business logic is completely decoupled from HTTP concerns

## Next Steps for Parent App

The parent `hadoku_site` repository now needs to:

1. **Create a Storage Implementation**
   - Development: File system storage adapter
   - Production: GitHub API storage adapter

2. **Create Framework Adapters**
   - Local development: Express adapter using file storage
   - Production: Hono/CF Workers adapter using GitHub storage

3. **Import and Use Handlers**
   ```typescript
   import { TaskHandlers, type TaskStorage } from '@hadoku/task/api'
   
   // Your storage implementation
   const storage: TaskStorage = { ... }
   
   // Use handlers in routes
   router.post('/task/api', async (req, res) => {
     const result = await TaskHandlers.createTask(
       storage,
       { userType: req.headers['x-user-type'] },
       req.body
     )
     res.json(result)
   })
   ```

## Example Adapter Pattern

### Express (Development)
```typescript
import { Router } from 'express'
import { TaskHandlers } from '@hadoku/task/api'
import { createFileSystemStorage } from './storage/filesystem'

const storage = createFileSystemStorage('./task/data')
const router = Router()

router.get('/api/task', async (req, res) => {
  const auth = { userType: req.query.userType || 'public' }
  try {
    const tasks = await TaskHandlers.getTasks(storage, auth)
    res.json(tasks)
  } catch (error) {
    res.status(403).json({ error: error.message })
  }
})

// ... more routes
```

### Hono (Production - Cloudflare Workers)
```typescript
import { Hono } from 'hono'
import { TaskHandlers } from '@hadoku/task/api'
import { createGitHubStorage } from './storage/github'

const storage = createGitHubStorage({
  owner: 'WolffM',
  repo: 'hadoku-task',
  branch: 'main',
  token: env.GITHUB_TOKEN
})

const app = new Hono()

app.get('/task/api', async (c) => {
  const auth = { userType: c.req.query('userType') || 'public' }
  try {
    const tasks = await TaskHandlers.getTasks(storage, auth)
    return c.json(tasks)
  } catch (error) {
    return c.json({ error: error.message }, 403)
  }
})

// ... more routes
```

## Testing

The pure handlers are now easy to test:

```typescript
import { TaskHandlers } from '@hadoku/task/api'

// Mock storage
const mockStorage = {
  getTasks: async () => ({ version: 1, tasks: [], updatedAt: '' }),
  saveTasks: async () => {},
  getStats: async () => ({ version: 2, counters: {}, timeline: [], tasks: {} }),
  saveStats: async () => {}
}

// Test handler
const result = await TaskHandlers.createTask(
  mockStorage,
  { userType: 'friend' },
  { title: 'Test task' }
)

assert(result.ok === true)
assert(result.id.startsWith('task_friend_'))
```

## Migration Path

The existing `src/server/` code can remain for now as it provides a working implementation. When the parent app is ready:

1. Parent app implements `TaskStorage` interface
2. Parent app creates adapters for both environments
3. Parent app imports handlers from `@hadoku/task/api`
4. The `src/server/` directory can be deprecated

This allows for a gradual, safe migration without breaking existing functionality.

## Documentation

Full API documentation is available in `api/README.md`, including:
- Detailed architecture overview
- Complete usage examples
- Framework adapter examples (Express, Hono)
- API reference for all handlers
- Permission system explanation

---

✅ **The refactoring is complete!** The child repository now exports framework-agnostic handlers that can be used in any environment.
