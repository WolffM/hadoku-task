# Architecture

Deep dive into the system design, patterns, and technical decisions behind Hadoku Task Manager.

> **Audience**: Developers integrating, extending, or understanding the system architecture.

---

## Overview

Hadoku Task Manager uses the **Universal Adapter Pattern** - a framework-agnostic architecture that separates pure business logic from framework-specific routing.

### Core Benefits

- ✅ **Framework Agnostic** - Handlers work with Express, Hono, Cloudflare Workers, etc.
- ✅ **Deployment Flexibility** - Deploy to Workers (KV) or self-hosted (filesystem)
- ✅ **Pure Business Logic** - No framework coupling in core operations
- ✅ **Single Source of Truth** - Types exported via npm package

### Key Principle

```typescript
// Pure handlers (business logic)
export async function createTask(storage: Storage, auth: AuthContext, input: CreateTaskInput) {
  // No Express, no Hono, no framework-specific code
  const tasks = await storage.getTasks(auth.userType)
  const newTask = { id: generateULID(), ...input }
  await storage.saveTasks(auth.userType, [...tasks.tasks, newTask])
  return newTask
}

// Parent app provides storage implementation
const storage = createKVStorage(env.TASK_KV) // or filesystem, database, etc.

// Use with any framework
const result = await TaskHandlers.createTask(storage, auth, input)
```

---

## Security & Authentication

### Authentication Model

**This micro-frontend delegates authentication to the parent application.**

The task app does NOT:

- ❌ Handle user credentials
- ❌ Hash passwords
- ❌ Generate session tokens
- ❌ Validate authentication keys

The task app DOES:

- ✅ Receive `userType` and `sessionId` as props
- ✅ Use these for storage namespacing (localStorage keys, API requests)
- ✅ Validate operations based on `userType` (e.g., public can't sync to server)

### Parent Application Responsibilities

Your parent application must handle:

1. **User Authentication**
   - Login/logout flows
   - Session management
   - Token generation and validation

2. **Key Validation**
   - Implement `/validate-key` endpoint
   - Verify keys against your auth system
   - Return `{ valid: true/false }`

3. **API Security**
   - Validate `X-User-Type` header
   - Verify `X-Session-Id` against your session store
   - Return 403 for unauthorized requests

4. **Props to Task App**
   - Provide correct `userType` (public, friend, admin, etc.)
   - Provide stable `sessionId` (changes on logout/login)

### Security Features

- ✅ No credentials stored or handled
- ✅ No authentication logic exposed in codebase
- ✅ All sensitive operations delegated to parent
- ✅ Uses standard web APIs (localStorage, fetch) safely
- ✅ React escapes output by default (XSS protection)
- ✅ No direct database access (SQL injection-proof)

**Separation of concerns makes this safe to open source while keeping authentication private.**

---

## Universal Adapter Pattern

### The Pattern

Export **pure handlers** and a **Storage interface**. Parent implements storage for their environment.

```typescript
// Task app exports (src/server/index.ts)
export * as TaskHandlers from './handlers.js'
export type { Storage as TaskStorage } from './storage.js'

// Parent implements storage
const storage: TaskStorage = {
  getTasks: async userType => {
    /* KV, filesystem, DB */
  },
  saveTasks: async (userType, tasks) => {
    /* ... */
  },
  getStats: async userType => {
    /* ... */
  },
  saveStats: async (userType, stats) => {
    /* ... */
  }
}

// Use with ANY framework
app.post('/task/api', async (req, res) => {
  const result = await TaskHandlers.createTask(storage, auth, req.body)
  res.json(result)
})
```

### Why This Works

**Pure functions = maximum reusability**

- No Express/Hono/framework dependencies
- Works in any JavaScript runtime (Node.js, Workers, Deno)
- Easy to test (mock the Storage interface)
- Reusable across different parent apps

**Storage abstraction = deployment flexibility**

- Cloudflare Workers KV (production)
- Filesystem (development)
- Database (SQL/NoSQL)
- In-memory (testing)

---

## Client Architecture

### Technology Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **CSS Custom Properties** - Theming
- **localStorage** - Client-side storage
- **BroadcastChannel** - Cross-tab sync

### Component Hierarchy

```
App (main orchestrator)
├── Theme State Management
├── User Management
└── Custom Hooks
    ├── useTasks() - CRUD operations, board management
    ├── useDragAndDrop() - Drag and drop logic
    ├── useTaskSort() - Sort state
    ├── usePreferences() - Settings sync
    └── useTheme() - Theme switching

├── TaskLayout (grid/column layout)
│   ├── BoardButton (board navigation)
│   ├── TagFilterButton (tag filtering)
│   └── TaskItem (individual task card)
│       ├── Complete/delete buttons
│       ├── Inline edit
│       └── Tag management

└── Modals
    ├── SettingsModal (user management + preferences)
    ├── CreateBoardModal
    ├── CreateTagModal
    └── ContextMenus (board/tag actions)
```

### Data Flow

1. **User Action** → Component (TaskItem, TagFilterButton, etc.)
2. **Component** → Hook (useTasks)
3. **Hook** → API Client (optimistic localStorage update)
4. **API Client** → Background server sync (if not public)
5. **localStorage change** → BroadcastChannel event
6. **Other tabs** → Receive event and refresh

### Optimistic Updates

**All user types use localStorage for instant UI:**

```typescript
// 1. Update localStorage immediately (UI updates)
await localStorage.createTask(task)

// 2. If not public, sync to server in background
if (userType !== 'public') {
  fetch('/task/api', { method: 'POST', body: JSON.stringify(task) }).catch(err =>
    console.error('Background sync failed')
  )
}
```

**Benefits:**

- ✅ Zero UI blocking
- ✅ Instant feedback
- ✅ Works offline (public mode)
- ✅ Server sync happens in background

---

## Server Architecture

### File Structure

```
src/server/
├── index.ts              # Exports (TaskHandlers, TaskStorage)
├── handlers.ts           # Pure business logic functions
├── storage.ts            # Storage interface + filesystem impl
├── types.ts              # TypeScript type definitions
└── utils.ts              # ULID generation, utilities
```

### Handler Pattern

**Pure functions with no side effects:**

```typescript
export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput
): Promise<Task> {
  // 1. Load current state
  const tasks = await storage.getTasks(auth.userType)
  const stats = await storage.getStats(auth.userType)

  // 2. Pure transformation
  const newTask = {
    id: generateULID(),
    title: input.title,
    tag: input.tag,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  // 3. Save new state
  await storage.saveTasks(auth.userType, {
    ...tasks,
    tasks: [...tasks.tasks, newTask]
  })

  await storage.saveStats(auth.userType, {
    ...stats,
    counters: { ...stats.counters, totalCreated: stats.counters.totalCreated + 1 }
  })

  return newTask
}
```

**Benefits:**

- ✅ Testable (just mock Storage)
- ✅ Framework-agnostic
- ✅ No hidden dependencies
- ✅ Easy to reason about

### Storage Interface

```typescript
interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementations:**

**Filesystem** (included for development):

```typescript
const storage = createFilesystemStorage('./data')
```

**Cloudflare Workers KV** (parent implements):

```typescript
const storage = {
  getTasks: async userType => {
    const data = await env.TASK_KV.get(`tasks:${userType}`, 'json')
    return data || defaultTasksFile
  },
  saveTasks: async (userType, tasks) => {
    await env.TASK_KV.put(`tasks:${userType}`, JSON.stringify(tasks))
  }
  // ... getStats, saveStats
}
```

---

## Styling System

### CSS Architecture

**Modular CSS files for separation of concerns:**

```
src/styles/
├── variables.css       # Design tokens + 7 theme definitions
├── base.css           # CSS reset and base styles
├── main.css           # Layout, header, app structure
├── buttons.css        # All button variants
├── modal.css          # Modal dialogs
├── task-items.css     # Task card styles
├── task-layout.css    # Grid/column layouts
└── index.css          # Import orchestrator
```

### Theme System

**7 complete themes with ~45 CSS variables each:**

```css
:root {
  /* Light theme (default) */
}
[data-theme='dark'] {
  /* Dark theme */
}
[data-theme='strawberry'] {
  /* Strawberry theme */
}
/* ... 4 more themes */
```

**Theme variables structure:**

- Primary colors (5 variants)
- Success/Danger colors (theme-specific, opposing colors)
- Neutral colors (grays)
- Text colors (primary, secondary, muted)
- Border colors
- Background colors (app, cards, hover states)
- Shadow values

**Theme switching:**

```typescript
// Instant switching via data attribute
document.documentElement.setAttribute('data-theme', 'dark')
```

### Design Token Philosophy

**All values use CSS custom properties:**

- ✅ Colors: `var(--color-primary)`
- ✅ Spacing: `var(--spacing-md)`
- ✅ Typography: `var(--font-size-body)`
- ✅ Borders: `var(--border-radius)`
- ✅ Shadows: `var(--shadow-card)`

**Benefits:**

- Instant theme switching
- Consistent design system
- Easy to add new themes
- No JavaScript needed for theming

---

## Data Storage

### Storage Keys Pattern

**localStorage keys use sessionId for stability:**

```typescript
// Tasks: {userType}-{sessionId}-{boardId}-tasks
'public-abc123-main-tasks'
'friend-xyz789-work-tasks'

// Boards index: {userType}-{sessionId}-boards
'admin-def456-boards'

// Stats: {userType}-{sessionId}-{boardId}-stats
'friend-xyz789-main-stats'
```

**Why sessionId?**

- ✅ Stable across page reloads
- ✅ Parent controls session lifecycle
- ✅ Multiple devices/tabs can coexist
- ✅ Clean separation per user

### Server Storage

**Per-board storage:**

```
data/
  {userType}/
    {sessionId}/
      boards.json              # Board index
      {boardId}-tasks.json     # Tasks for board
      {boardId}-stats.json     # Stats for board
```

**Benefits:**

- Boards load independently
- Parallel board operations
- Efficient sync (only changed boards)

---

## Performance Characteristics

### Bundle Sizes

- **Client**: ~95KB raw, ~22KB gzipped
- **CSS**: ~40KB raw, ~7KB gzipped (includes all 7 themes)
- **Initial load**: ~50-100ms on average connection

### Runtime Performance

- **Task operations**: Instant (localStorage)
- **Theme switching**: Instant (CSS custom properties)
- **Drag and drop**: 60fps (CSS transforms)
- **Cross-tab sync**: ~50ms (BroadcastChannel)

### Server Performance

**Handler execution:**

- Pure functions: No overhead
- Storage-dependent: Varies by implementation
  - In-memory: <1ms
  - Filesystem: ~5-10ms
  - Cloudflare KV: ~10-50ms (depends on region)
  - Database: Varies by DB and query

---

## Design Patterns

### 1. Universal Adapter Pattern

**Separation of business logic from framework routing**

### 2. Storage Interface Pattern

**Abstract storage implementation from business logic**

### 3. Pure Handler Functions

**Business logic without side effects for testability**

### 4. Custom Hooks Pattern

**Extract stateful React logic into reusable hooks**

### 5. Component Composition

**Modular UI rendering with clear responsibilities**

### 6. CSS Design Tokens

**Centralized theme configuration with custom properties**

### 7. Optimistic Updates

**Instant UI feedback with background server sync**

---

## Extension Points

### Adding Features

**New Task Property:**

1. Update `Task` interface in `src/domain/types.ts`
2. Update handler logic in `src/domain/handlers/handlers.ts`
3. Update UI in `src/components/TaskItem.tsx`

**New Handler:**

1. Add function to `src/domain/handlers/handlers.ts`
2. Export in `src/server/index.ts`
3. Parent uses handler with their framework

**New Storage Backend:**

1. Implement `Storage` interface
2. Use with existing handlers (no changes needed)

**New Theme:**

1. Add theme definition in `src/styles/variables.css` (~45 variables)
2. Add to type union in `src/app/App.tsx`
3. Add theme picker option with icon

**New Component:**

1. Create in `src/components/`
2. Add styles to appropriate CSS file
3. Import in parent component

---

## Testing Strategy

### Recommended Approach

**Unit Testing** (handlers):

```typescript
import { TaskHandlers } from '@wolffm/task/api'

test('createTask adds new task', async () => {
  const storage = createMockStorage()
  const auth = { userType: 'public' }
  const input = { title: 'Test', tag: 'work' }

  const result = await TaskHandlers.createTask(storage, auth, input)

  expect(result.title).toBe('Test')
  expect(result.tag).toBe('work')
})
```

**Integration Testing** (with real storage):

```typescript
test('full CRUD workflow', async () => {
  const storage = createFilesystemStorage('/tmp/test')

  const task = await TaskHandlers.createTask(storage, auth, { title: 'Test' })
  const updated = await TaskHandlers.updateTask(storage, auth, task.id, { title: 'Updated' })
  await TaskHandlers.completeTask(storage, auth, task.id)

  const tasks = await TaskHandlers.getTasks(storage, auth)
  expect(tasks.tasks).toHaveLength(0) // Task moved to graveyard
})
```

---

## Build Output

### Client Bundle

```
dist/
├── index.js          # React app (~95KB / ~22KB gzipped)
└── style.css         # All themes (~40KB / ~7KB gzipped)
```

### Server Handlers

```
dist/server/
├── index.js          # Exports (TaskHandlers, TaskStorage)
├── handlers.js       # Pure business logic
├── storage.js        # Storage interface
├── types.js          # TypeScript types
└── utils.js          # Utilities
```

---

## Related Documentation

- **[README.md](../README.md)** - Getting started and integration
- **[API.md](API.md)** - Complete endpoint reference
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Development workflow
- **[CHANGELOG.md](CHANGELOG.md)** - Version history
