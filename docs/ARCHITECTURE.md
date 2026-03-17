# Architecture & Strategy

This is the **authoritative reference** for Hadoku Task Manager's system design, architectural decisions, and strategic direction. All major technical decisions are documented here.

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

## Key Design Decisions

### 1. API Always Wins (Data Sync Strategy)

**Server is the source of truth.** When syncing data, API data always overwrites localStorage.

```typescript
// On page load, syncFromApi() fetches server data and overwrites localStorage
await syncFromApi() // API data → localStorage (no timestamp comparison)
```

**Why this is safer than timestamp comparison:**

- ✅ Corrupted localStorage won't overwrite good server data
- ✅ Empty localStorage won't wipe server data
- ✅ Stale localStorage won't resurrect deleted data
- ✅ Simple, predictable behavior

**Trade-off:** If a user reloads during a pending background sync, the un-synced local change may be lost. This is rare and acceptable.

### 2. Initialization Priority Order

On page load, values are determined in this priority:

```typescript
// entry.tsx
const userType = storedUserType || props.userType || urlParams.userType || 'public'
const sessionId = storedSessionId || props.sessionId || 'public-session'
```

**Priority (highest to lowest):**

1. **localStorage** - Survives auth, device-specific (e.g., `currentUserType: 'friend'`)
2. **Props** - From parent app (e.g., registry.json defaults)
3. **URL params** - Fallback for testing
4. **Default** - `'public'` / `'public-session'`

**Why localStorage first:** After key validation, the authenticated `userType` is stored in localStorage. On reload, this must override the default `'public'` from the parent's registry.json.

### 3. Session-Based Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    KEY VALIDATION FLOW                               │
└─────────────────────────────────────────────────────────────────────┘
User enters key in Settings
        │
        ▼
POST /task/api/validate-key
Headers: { X-User-Key: "user-key" }
        │
        ▼ (if valid)
POST /task/api/session/create
Headers: { X-User-Key: "user-key" }
Response: { sessionId: "abc123", userType: "friend" }
        │
        ▼
Store in localStorage:
- currentSessionId: "abc123"
- currentUserType: "friend"
        │
        ▼
Page reload (URL cleaned of ?key= param)
        │
        ▼
entry.tsx reads localStorage → userType='friend', sessionId='abc123'
        │
        ▼
createApi('friend', 'abc123') → API with syncFromApi()
        │
        ▼
syncFromApi() → fetches boards from server → updates localStorage
```

### 4. Session Expiration Handling

Server sessions may expire (e.g., KV TTL exceeded after 24+ hours). When this happens, the server treats the user as `public` even if the client thinks they're authenticated.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SESSION EXPIRATION FLOW                            │
└─────────────────────────────────────────────────────────────────────┘
User reloads after 24+ hours
        │
        ▼
localStorage: userType='friend', sessionId='abc123'
        │
        ▼
POST /task/api/session/handshake
Headers: { X-User-Type: 'friend', X-Session-Id: 'abc123' }
        │
        ▼
Edge-router: KV lookup for session → expired/not found
        │
        ▼
Response: { userType: 'public', ... }  ← Server disagrees with client
        │
        ▼
Client detects mismatch: expected 'friend', got 'public'
        │
        ▼
Show toast: "Your session has expired. Please enter your key again."
        │
        ▼
Update localStorage: userType='public'
        │
        ▼
Page reload → App reinitializes as public user
```

**Key implementation details:**

- `performSessionHandshake()` returns `{ preferences, serverUserType }`
- `useSessionInitialization` compares `serverUserType` with client's `userType`
- On mismatch where authenticated user becomes public: show toast, update localStorage, reload
- This prevents "lost context" where user sees empty/public data instead of their authenticated data

---

## Security & Authentication

### Authentication Model

**This micro-frontend delegates most authentication to the parent application.**

The task app does NOT:

- ❌ Handle user credentials or passwords
- ❌ Hash passwords
- ❌ Generate session tokens
- ❌ Store authentication keys

The task app DOES:

- ✅ Call parent's `/validate-key` and `/session/create` endpoints
- ✅ Store `sessionId` and `userType` in localStorage after auth
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

#### Pure functions = maximum reusability

- No Express/Hono/framework dependencies
- Works in any JavaScript runtime (Node.js, Workers, Deno)
- Easy to test (mock the Storage interface)
- Reusable across different parent apps

#### Storage abstraction = deployment flexibility

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

```text
App (main orchestrator)
├── Theme State Management
├── User Management
└── Custom Hooks
    ├── useTasks() - CRUD operations, board management
    ├── useTaskHandlers() - UI integration layer (modals, validation)
    ├── useSessionInitialization() - Session setup and sync
    ├── useDragAndDrop() - Drag and drop logic
    ├── useTaskSort() - Sort state
    ├── usePreferences() - Settings sync
    └── useTheme() - Theme switching

├── AppModals - Centralized modal management
│   ├── SettingsModal
│   ├── CreateBoardModal
│   ├── CreateTagModal
│   ├── EditTagModal
│   ├── ClearTagModal
│   ├── BoardContextMenu
│   └── TagContextMenu

├── TaskLayout (grid/column layout)
│   ├── BoardButton (board navigation)
│   ├── TagFilterButton (tag filtering)
│   └── TaskItem (individual task card)
│       ├── Complete/delete buttons
│       ├── Inline edit
│       └── Tag management

└── MarqueeOverlay - Drag selection overlay
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

```text
src/
├── api/                      # API client layer
│   ├── client.ts            # Optimistic API with extensive logging
│   ├── localStorageApi.ts   # localStorage implementation
│   ├── session.ts           # Session management
│   └── storage/             # Storage implementations
│
├── app/                      # Application entry and config
│   ├── App.tsx              # Main orchestrator (~400 lines, refactored)
│   ├── entry.tsx            # React mount point
│   ├── themeConfig.tsx      # Theme configuration
│   └── constants.ts         # App constants
│
├── components/               # UI components
│   ├── AppModals.tsx        # Centralized modal management
│   ├── MarqueeOverlay.tsx   # Drag selection overlay
│   ├── TaskLayout.tsx       # Main layout component
│   ├── TaskItem.tsx         # Individual task card
│   ├── BoardsSection.tsx    # Board navigation
│   ├── TagFiltersSection.tsx # Tag filters
│   └── modals/              # Modal components
│       ├── SettingsModal.tsx
│       ├── CreateBoardModal.tsx
│       ├── CreateTagModal.tsx
│       ├── EditTagModal.tsx
│       ├── ClearTagModal.tsx
│       ├── BoardContextMenu.tsx
│       └── TagContextMenu.tsx
│
├── domain/                   # Business logic
│   ├── types.ts             # TypeScript interfaces
│   ├── handlers/            # Pure handler functions
│   └── utils/               # Domain utilities (tags, validation)
│
├── hooks/                    # Custom React hooks
│   ├── useTasks/            # Task operations (CRUD, boards)
│   │   ├── index.ts         # Main hook (~400 lines)
│   │   └── helpers.ts       # Shared utilities
│   ├── useTaskHandlers.ts   # UI integration layer
│   ├── useSessionInitialization.ts # Session setup
│   ├── useDragAndDrop/      # Drag and drop logic
│   ├── useModalState.ts     # Modal state management
│   ├── usePreferences.ts    # Settings persistence
│   └── useTheme.ts          # Theme switching
│
├── server/                   # Exported handlers for backend
│   ├── index.ts             # Exports
│   ├── handlers.ts          # Business logic
│   └── storage.ts           # Storage interface
│
├── styles/                   # CSS modules
│   ├── base.css              # Design tokens + base styles
│   ├── main.css            # Layout and structure
│   ├── buttons.css         # Button styles
│   ├── modal.css           # Modal dialogs
│   ├── task-items.css      # Task cards
│   └── task-layout.css     # Grid layouts
│
└── utils/                    # App utilities
    ├── auth.ts              # Authentication helpers
    ├── broadcast.ts         # Cross-tab sync
    ├── dragDrop.ts          # Drag and drop utilities
    ├── formatters.ts        # Text formatting
    ├── layout.ts            # Layout calculations
    ├── placeholders.ts      # Placeholder text
    ├── preferences.ts       # Preferences helpers
    └── validation.ts        # Input validation
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

```text
src/styles/
├── base.css            # Base styles, design tokens, and CSS reset
├── main.css           # Layout, header, app structure
├── buttons.css        # All button variants
├── modal.css          # Modal dialogs
├── task-items.css     # Task card styles
├── task-layout.css    # Grid/column layouts
└── index.css          # Import orchestrator
```

### Theme System

**9 theme families (18 themes with light/dark) with ~40 CSS variables each:**

```css
:root {
  /* Light theme (default) */
}
[data-theme='dark'] {
  /* Dark theme */
}
[data-theme='strawberry-light'] {
  /* Strawberry light — each family has light + dark */
}
/* ... 7 more families × 2 variants */
```

**Theme variables structure:**

- Primary colors (6 variants incl. `--color-on-primary`)
- Success colors (5 variants incl. `--color-on-success`)
- Warning colors (4 variants incl. `--color-on-warning`)
- Danger colors (6 variants incl. `--color-on-danger`)
- Neutral colors (6 variants incl. `--color-on-neutral`)
- Text colors (4: primary, secondary, tertiary, muted)
- Border colors (2: default, light)
- Background colors (5: default, card, alt, hover, overlay)
- Shadows (6: sm, md, lg, focus, focus-sm, focus-alt)

> **Note:** `--color-on-*` variables define the text color to use ON TOP OF
> that color's surface. These are computed from the color's luminance,
> not the theme mode. See THEME_CREATION_GUIDE.md for details.

**Theme switching:**

```typescript
// Instant switching via data attribute
document.documentElement.setAttribute('data-theme', 'dark')
```

### Design Token Philosophy

**All values use CSS custom properties (namespaced for Tailwind v4 compatibility):**

- ✅ Colors: `var(--color-primary)`
- ✅ Spacing: `var(--hdk-space-md)`
- ✅ Typography: `var(--hdk-text-base)`
- ✅ Borders: `var(--hdk-radius)`
- ✅ Shadows: `var(--hdk-shadow-md)`

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

```text
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
- **CSS**: ~40KB raw, ~7KB gzipped (includes all theme families)
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

Separation of business logic from framework routing

### 2. Storage Interface Pattern

Abstract storage implementation from business logic

### 3. Pure Handler Functions

Business logic without side effects for testability

### 4. Custom Hooks Pattern

Extract stateful React logic into reusable hooks

### 5. Component Composition

Modular UI rendering with clear responsibilities

### 6. CSS Design Tokens

Centralized theme configuration with custom properties

### 7. Optimistic Updates

Instant UI feedback with background server sync

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

1. Add theme definition in `themes/src/style.css` (~40 variables: 34 color + 6 shadow)
2. Add to `THEMES` array in `themes/src/index.ts`
3. Add theme family in `themes/src/metadata.tsx` with icon

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

```text
dist/
├── index.js          # React app (~95KB / ~22KB gzipped)
└── style.css         # All themes (~40KB / ~7KB gzipped)
```

### Server Handlers

```text
dist/server/
├── index.js          # Exports (TaskHandlers, TaskStorage)
├── handlers.js       # Pure business logic
├── storage.js        # Storage interface
├── types.js          # TypeScript types
└── utils.js          # Utilities
```

---

## Logging System

### Production-Safe Logging

The app includes comprehensive logging via `@wolffm/task-ui-components/logger`:

```typescript
import { logger } from '@wolffm/task-ui-components'

// Info logs (dev/admin only)
logger.info('[api] createTask: Starting', { title, boardId })
logger.info('[api] createTask: Created locally', { taskId })

// Warnings (always shown)
logger.warn('[api] createTask: Server sync returned error', { status })

// Errors (always shown)
logger.error('[api] createTask: Server sync failed', { error })
```

**Behavior:**

| Mode      | Development | Production (Admin) | Production (User) |
| --------- | ----------- | ------------------ | ----------------- |
| `info()`  | ✅          | ✅                 | ❌                |
| `debug()` | ✅          | ✅                 | ❌                |
| `warn()`  | ✅          | ✅                 | ✅                |
| `error()` | ✅          | ✅                 | ✅                |

**Admin Mode:**

```typescript
// Enable admin logging in production
if (userType === 'admin') {
  logger.setAdminStatus(true)
}
```

**Logging Coverage:**

- ✅ All API operations (start, local complete, server sync)
- ✅ Performance metrics (sync duration)
- ✅ Error details with context
- ✅ State changes in hooks
- ✅ Cross-tab sync events

---

## Refactored Architecture (v3.4+)

### App.tsx Refactoring

**Before:** 633 lines of mixed concerns  
**After:** 404 lines focused on composition (36% reduction)

**Extracted Components:**

1. **AppModals** (201 lines) - All modal components centralized
2. **MarqueeOverlay** (27 lines) - Drag selection overlay

**Extracted Hooks:**

1. **useTaskHandlers** (207 lines) - UI integration layer
   - Modal state management
   - Input validation
   - Tag/board creation with pending operations
2. **useSessionInitialization** (117 lines) - Session setup
   - Initial API sync
   - Preference loading
   - Authentication state

**Extracted Utilities:**

1. **domain/utils/tags.ts** - Tag parsing and formatting
   - `splitTags()` - Consistent tag parsing
   - `formatError()` - Error message formatting

### Hook Organization

**useTasks** - Pure business logic

- CRUD operations
- Board management
- API calls
- BroadcastChannel sync

**useTaskHandlers** - UI integration

- Connects useTasks to UI components
- Modal state coordination
- Input validation
- Pending operation management

**Separation Benefits:**

- ✅ Clear separation of concerns
- ✅ Easier testing (mock at different levels)
- ✅ Better code organization
- ✅ Reduced component complexity

---

## Calendar & Scheduling (Planned)

### Data Model

Tasks optionally include `startTime` and `endTime` fields (ISO 8601 format, matching `createdAt`/`updatedAt`/`closedAt`).

**Scheduling modes:**

- **Neither field** - Classic board task (existing behavior)
- **startTime only** - Open-ended event, starts at specific time
- **endTime only** - Deadline/due date
- **Both fields** - Fully scheduled time block

Tasks without scheduling fields appear only in board view. Tasks with scheduling appear in both board view and calendar view.

### View Architecture

The app uses a **view-agnostic data layer** - tasks are stored the same way regardless of how they're displayed.

**Planned views:**

- **Board View** - Existing tag-based column layout (current)
- **Day View** - Calendar-style day visualization (planned)
- **Week View** - Weekly calendar grid (future)
- **Month View** - Monthly overview (future)

**Key principle:** All views operate on the same board's tasks. A task created in calendar view appears in board view and vice versa.

### View Switcher

A view mode selector will be added to the header area, allowing users to toggle between Board and Calendar views while staying on the same board.

---

## Related Documentation

- **[README.md](../README.md)** - Getting started and integration
- **[API.md](API.md)** - Complete endpoint reference
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Development workflow
- **[CHANGELOG.md](CHANGELOG.md)** - Version history
