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
-  **7 Themes** - Light, Dark, Strawberry, Ocean, Cyberpunk, Coffee, Lavender
-  **Optimistic Updates** - Instant UI response, background sync to Cloudflare Workers KV
-  **Multi-User** - Public (localStorage only), Friend/Admin (localStorage + KV persistence)
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

### Themes
Choose from 7 carefully crafted themes with the theme picker (icon in top-right):

- **☼ Light** - Clean blue and white
- **☽ Dark** - Sophisticated midnight palette  
- **❖ Strawberry** - Sweet pink tones
- **≈ Ocean** - Deep sea blues
- **◆ Cyberpunk** - Neon dystopia
- **◉ Coffee** - Rich espresso tones
- **✿ Lavender** - Soft purple elegance

Each theme includes distinct button colors for visual interest and proper contrast.

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
- **Client bundle**: `dist/index.js` (~21KB), `dist/style.css` (~11KB with 7 themes)
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
- ✅ **Cloudflare Workers** - Use with Hono + Workers KV storage
- ✅ **Self-hosted** - Use with Express + filesystem storage (for testing/development)
- ✅ **Any framework** - Just implement the Storage interface

**Client Architecture**:
- **All user types** use browser localStorage for instant UI updates
- **Public mode** - localStorage only, no persistence
- **Friend/Admin mode** - localStorage + background sync to Cloudflare Workers KV
- Zero blocking on API calls, optimistic updates everywhere

### Client Architecture

- Main component with theme state orchestrates custom hooks
- Modular components (TaskItem, TaskLayout)
- Utility libraries for tags, formatting, layout
- Comprehensive CSS module system with 7 complete themes
- Design token system with ~45 CSS custom properties per theme
- Theme picker with horizontal dropdown and monochrome Unicode icons

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
| Styles | `src/styles/` (modular CSS files) |
| Theme | `src/styles/variables.css` + `App.tsx` |
| Operation | `src/server/handlers/` |
| Route | `src/server/routes/` |

**Styling Guidelines**: 
- Use CSS custom properties for all colors, spacing, typography
- Add new themes by defining all ~45 variables in `variables.css`
- Include `--color-success-text` and `--color-danger-text` for button visibility
- Keep CSS files modular (variables, layout, buttons, modals, filters, boards, tasks)

**Code Guidelines**: Keep files <250 lines, extract reusable logic.

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
