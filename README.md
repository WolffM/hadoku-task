# Hadoku Task Manager

**A minimalist task tracking micro-frontend for hadoku.me**

Fast, focused task management with tags, filtering, and multi-user support. Built as a portable micro-frontend with framework-agnostic API handlers.

---

## Quick Start

```bash
# Install and run
npm install
npm run dev
# Open http://localhost:5173?userType=public
```

---

## Features

-  **Quick Task Entry** - Type and press Enter
-  **Tag Support** - Organize with `#tags`
-  **Smart Filtering** - Filter by tag or view all
-  **Drag & Drop** - Move tasks between columns
-  **Multi-User** - Public (in-memory), Friend/Admin (persistent)
-  **Framework Agnostic** - Pure handlers work with Express, Hono, Cloudflare Workers

---

## Usage

### Creating Tasks
```
Buy groceries [Enter]                    # Plain task
Buy groceries #home [Enter]              # With tag
Fix bug #high priority [Enter]           # Multi-word tag  #high-priority
```

### Actions
- **** Mark complete
- **** Delete task
- **** Edit title
- **+** Add tag
- **Drag** Move between columns

---

## Documentation

 **[Architecture](docs/ARCHITECTURE.md)** - System design and Universal Adapter Pattern  
 **[API Reference](docs/API.md)** - Complete endpoint documentation  
 **[Development Guide](docs/DEVELOPMENT.md)** - Setup, workflow, contribution guidelines  
 **[Child App Template](docs/CHILD_APP_TEMPLATE.md)** - Template for creating new micro-frontend apps  
 **[Universal Adapter Pattern](docs/UNIVERSAL_ADAPTER_PATTERN.md)** - Framework-agnostic API handlers

---

## Build & Deploy

```bash
npm run build          # Client only
npm run build:router   # Server handlers
npm run build:all      # Both
```

**Output**: 
- Client: `dist/index.js` (~21KB), `dist/style.css` (~9KB)
- Handlers: `dist/server/` (TypeScript compiled to JavaScript)

**Deploy to**: 
- Client → `hadoku_site/public/mf/task/`
- Handlers → `hadoku_site/api/apps/task/` or `hadoku_site/functions/task/lib/`

---

## Architecture

### Universal Adapter Pattern

This package exports **pure, framework-agnostic handlers** that work with any web framework:

```typescript
import { TaskHandlers, TaskStorage } from '@hadoku/task/api'

// Implement storage for your environment
const storage: TaskStorage = {
  getTasks: async (userType) => { /* KV, filesystem, database, etc */ },
  saveTasks: async (userType, tasks) => { /* ... */ },
  getStats: async (userType) => { /* ... */ },
  saveStats: async (userType, stats) => { /* ... */ }
}

// Use with any framework
const result = await TaskHandlers.createTask(storage, auth, { title: 'Task' })
```

**Deployment Flexibility**:
- ✅ **Cloudflare Workers** - Use with Hono + KV storage
- ✅ **Self-hosted** - Use with Express + filesystem storage
- ✅ **Any framework** - Just implement the Storage interface

### Client (React)

- Main component orchestrates custom hooks
- Modular components (TaskItem, TaskLayout)
- Utility libraries for tags, formatting, layout
- 7 CSS files with design token system

### Server Handlers

- **handlers.ts** - Pure business logic (createTask, updateTask, etc.)
- **storage.ts** - Storage interface + filesystem implementation
- **router.ts** - Express adapter (for testing/self-hosted)
- **routes-adapter.ts** - Route factory for any framework

See **[Architecture docs](docs/ARCHITECTURE.md)** for detailed system design and **[Universal Adapter Pattern](docs/UNIVERSAL_ADAPTER_PATTERN.md)** for implementation guide.

---

## API

The handlers export pure functions. Example integration:

### Framework-Agnostic Handlers

```typescript
import { TaskHandlers } from '@hadoku/task/api'

// All handlers follow this pattern:
await TaskHandlers.getTasks(storage, auth)
await TaskHandlers.createTask(storage, auth, input)
await TaskHandlers.updateTask(storage, auth, taskId, input)
await TaskHandlers.deleteTask(storage, auth, taskId)
```

### Express Integration

```typescript
import { createTaskRouter } from './apps/task/router.js'
app.use('/task/api', createTaskRouter({ dataPath: './data/task' }))
```

### Hono Integration (Cloudflare Workers)

```typescript
import { TaskHandlers, TaskStorage } from '@hadoku/task/api'
import { Hono } from 'hono'

const app = new Hono()
const storage: TaskStorage = createKVStorage(env.TASK_KV)

app.get('/task/api', async (c) => {
  const auth = { userType: c.req.header('X-User-Type') || 'public' }
  return c.json(await TaskHandlers.getTasks(storage, auth))
})
```

See **[API docs](docs/API.md)** for complete endpoint examples.

---

## Integration

### Client
```javascript
import { mount } from '/mf/task/index.js'
mount(document.getElementById('app'), {
  apiUrl: '/task/api',
  userType: 'friend'
})
```

### Server
```typescript
import { TaskHandlers, TaskStorage } from '@hadoku/task/api'

// Implement storage for your environment
const storage: TaskStorage = {
  getTasks: async (userType) => { /* your implementation */ },
  saveTasks: async (userType, tasks) => { /* your implementation */ },
  getStats: async (userType) => { /* your implementation */ },
  saveStats: async (userType, stats) => { /* your implementation */ }
}

// Use handlers with your framework
const result = await TaskHandlers.createTask(storage, auth, input)
```

See **[Child App Template](docs/CHILD_APP_TEMPLATE.md)** for full integration guide.

---

## Development

```bash
npm run dev           # Vite dev server
npm run test:server   # With backend
```

### Adding Features

| Add | Location |
|-----|----------|
| Utility | `src/lib/` |
| API call | `src/hooks/useTasks.ts` |
| Component | `src/components/` |
| Styles | `src/styles/` |
| Operation | `src/server/handlers/` |
| Route | `src/server/routes/` |

**Guidelines**: Keep files <250 lines, use CSS variables, extract reusable logic.

See **[Development docs](docs/DEVELOPMENT.md)** for detailed workflow.

---

## Data Storage

| User Type | Storage | Persistence | Performance | Backup |
|-----------|---------|-------------|-------------|--------|
| Public | In-memory | None | <1ms | None |
| Friend | File + Git | Committed to repo | ~5-10ms | Automatic |
| Admin | File + Git | Committed to repo | ~5-10ms | Automatic |

**Files**: `task/data/friend/`, `task/data/admin/` (committed for backup/sync)

---

## Links

- **Demo**: https://hadoku.me/task
- **Parent**: https://hadoku.me
- **Repo**: https://github.com/WolffM/hadoku-task

---

**Version**: 0.1.0 | **License**: MIT | **Author**: WolffM
