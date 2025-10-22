# Architecture

## Overview

Hadoku Task Manager uses the **Universal Adapter Pattern** - a framework-agnostic architecture that separates pure business logic from framework-specific routing. This enables deployment flexibility across Cloudflare Workers, self-hosted servers, or any web framework.

**Key Benefits**:
- ✅ **Framework Agnostic** - Handlers work with Express, Hono, Cloudflare Workers, etc.
- ✅ **Deployment Flexibility** - Deploy to Workers (KV) or self-hosted (filesystem)
- ✅ **Pure Business Logic** - No framework coupling in core operations
- ✅ **Single Source of Truth** - Types imported from package via npm link

---

## Universal Adapter Pattern

### Core Concept

The package exports **pure handlers** and a **Storage interface**. The parent app implements storage for their environment:

```typescript
// Child exports (src/server/index.ts)
export * as TaskHandlers from './handlers.js'
export type { Storage as TaskStorage } from './storage.js'

// Parent implements storage
const storage: TaskStorage = {
  getTasks: async (userType) => { /* KV, filesystem, DB, etc */ },
  saveTasks: async (userType, tasks) => { /* ... */ },
  getStats: async (userType) => { /* ... */ },
  saveStats: async (userType, stats) => { /* ... */ }
}

// Parent uses handlers with any framework
const result = await TaskHandlers.createTask(storage, auth, input)
```

See **[Universal Adapter Pattern](UNIVERSAL_ADAPTER_PATTERN.md)** for complete implementation guide.

---

## Client Architecture (React Frontend)

**Key Files**:
- `App.tsx` - Main orchestrator with theme state, user management, and custom hooks
- `entry.tsx` - Micro-frontend mount/unmount exports
- `components/` - TaskItem (card), TaskLayout (grid), Modal (dialogs), ContextMenu, BoardButton, TagFilterButton
- `hooks/` - useTasks (CRUD + user management), useDragAndDrop, useTaskSort, useLongPress, useIsMobile
- `lib/` - Utilities (api, formatters, tagUtils, ulid)
- `styles/` - Modular CSS system with comprehensive theming

**Styling System**:
- `variables.css` - Design tokens and 7 complete theme definitions
- `main.css` - Layout, header, theme picker, task app structure
- `buttons.css` - All button variants with theme-aware colors
- `modal.css` - Reusable modal components (settings, confirmations)
- `filters.css` - Tag filter buttons
- `boards.css` - Board navigation and management
- `tasks.css` - Task item cards and layout

See **[Development Guide](DEVELOPMENT.md#project-structure)** for complete directory structure.

### Component Hierarchy

```
App
├── Settings Modal (User Management + Preferences)
│   ├── User ID input (disabled for public users)
│   ├── Session Key input with validation
│   └── Preferences toggles (experimental themes, vertical layout)
├── useTasks() hook - Task operations, board management, & user management API calls
├── useDragAndDrop() hook - Drag-and-drop logic
├── useTaskSort() hook - Sort state
└── TaskLayout
    ├── Tag columns (dynamic based on top tags)
    │   └── TaskItem (for each task in tag)
    └── Remaining tasks section
        └── TaskItem (for each untagged/remaining task)
```

### User Management Flow

**Session Key Validation:**
1. User enters new key in settings modal
2. App calls `api.validateKey(key)` 
3. If valid: Reload page with `?key=newkey` in URL
4. Parent app validates `?key=` param and sets `userType` accordingly
5. Child remounts with new `sessionId` from parent props

**Architecture:**
- **Parent Responsibility:** Validate `?key=` URL param and provide `userType` + `sessionId` to child
- **Child Responsibility:** Provide UI for entering key, validate via API, reload with key in URL
- **Storage:** Theme stored in `sessionStorage` (per-tab), preferences synced to server

### Theming System

**7 Complete Themes**:
- **Light** - Clean blue and white with sky blue/sunset orange buttons
- **Dark** - Sophisticated midnight palette with bright yellow/light purple buttons
- **Strawberry** - Sweet pink tones with plant green/hot magenta buttons
- **Ocean** - Deep sea blues with vibrant coral/electric cyan buttons
- **Cyberpunk** - Neon dystopia with full-saturation neon green/neon pink buttons
- **Coffee** - Rich espresso tones with warm caramel/espresso brown buttons
- **Lavender** - Soft purple elegance with bright lime/deep violet buttons

**Theme Implementation**:
- CSS custom properties (~45 variables per theme)
- Data attribute selector `[data-theme="..."]` for instant switching
- Theme picker with horizontal dropdown
- Monochrome Unicode icons (☼☽❖≈◆◉✿) inheriting text color
- Dynamic button text colors (white or dark) for visibility
- Comprehensive color system: primary, success/danger, neutral, text, borders, backgrounds, shadows

### Data Flow

1. **User Action** → TaskItem component
2. **Component** → useTasks hook function
3. **Hook** → API call via lib/api.ts
4. **API Response** → Hook updates state
5. **State Update** → Re-render TaskLayout → TaskItem

### Build Output

- **Client bundle**: `dist/index.js` (~95KB / ~22KB gzipped)
- **Styles**: `dist/style.css` (~40KB / ~7KB gzipped with 7 complete themes)
- **Deploy target**: `hadoku_site/public/mf/task/`

**Note**: CSS includes all 7 themes (~45 variables × 7 themes = ~315 theme variables), plus shared tokens and component styles.

---

## Server Architecture (Framework-Agnostic Handlers)

**Key Files**:
- `handlers.ts` - Pure business logic (createTask, updateTask, etc.)
- `storage.ts` - Storage interface + filesystem implementation
- `types.ts` - Shared TypeScript types (exported via npm link)
- `utils.ts` - Utility functions (ULID generation with Web Crypto API)
- `router.ts` - Express adapter (for testing/self-hosted)
- `routes-adapter.ts` - Route factory for any framework

See **[Development Guide](DEVELOPMENT.md#project-structure)** for complete directory structure.

### Handler Architecture

**Pure Business Logic** (`handlers.ts`):
```typescript
export async function getTasks(storage: Storage, auth: AuthContext) {
  const tasks = await storage.getTasks(auth.userType)
  return { tasks: tasks.tasks.filter(t => !t.closedAt) }
}

export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput
) {
  // Pure logic - no framework coupling
  const tasks = await storage.getTasks(auth.userType)
  const stats = await storage.getStats(auth.userType)
  
  const newTask = { id: generateULID(), title: input.title, ... }
  const updatedTasks = { ...tasks, tasks: [...tasks.tasks, newTask] }
  const updatedStats = recordCreation(stats, newTask)
  
  await storage.saveTasks(auth.userType, updatedTasks)
  await storage.saveStats(auth.userType, updatedStats)
  
  return newTask
}
```

**Benefits**:
- ✅ No Express/Hono/framework dependencies
- ✅ Works in any JavaScript runtime (Node.js, Cloudflare Workers, Deno)
- ✅ Easy to test (just mock the Storage interface)
- ✅ Reusable across different parent apps

### Storage Interface

**Purpose**: Abstract storage implementation from business logic

```typescript
export interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementations**:
- **Filesystem** (`storage.ts`) - For self-hosted (included in child repo)
- **Cloudflare KV** - Parent implements for Workers deployment
- **Database** - Parent could implement for SQL/NoSQL

### Express Adapter

**For Testing & Self-Hosted** (`router.ts`):
```typescript
export function createTaskRouter(config: RouterConfig): Router {
  const storage = createStorage(config.dataPath)
  const router = Router()
  
  // Use createRoutes from routes-adapter.ts
  router.use('/', createRoutes(storage))
  
  return router
}
```

**Note**: This is just one possible adapter. Parent apps can use handlers directly with Hono, Cloudflare Workers, or any framework.

### Route Adapter

**Framework-Agnostic Route Factory** (`routes-adapter.ts`):
```typescript
export function createRoutes(storage: Storage) {
  return {
    getTasks: async (auth) => await TaskHandlers.getTasks(storage, auth),
    createTask: async (auth, input) => await TaskHandlers.createTask(storage, auth, input),
    // ... other routes
  }
}
```

This adapter can be used with Express, Hono, or any framework.

### Build Output

```
dist/server/
├── handlers.js          # Pure business logic (exported)
├── storage.js           # Storage interface + filesystem impl
├── types.js             # TypeScript types (exported)
├── utils.js             # Utilities (exported)
├── router.js            # Express adapter (optional)
├── routes-adapter.js    # Route factory
└── sync-queue.js        # Git commit queue (for filesystem storage)
```

**Deploy targets**: 
- Self-hosted: `hadoku_site/api/apps/task/`
- Cloudflare Workers: `hadoku_site/functions/task/lib/`

---

## Data Storage

### Storage Interface Pattern

The child repo exports a **Storage interface**. The parent implements storage based on their deployment:

```typescript
export interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

### Filesystem Storage (Included)

The child repo includes a filesystem implementation (`storage.ts`) for self-hosted deployments:

**Public Users**:
- **Storage**: In-memory Map  
- **Persistence**: None (lost on restart)  
- **Performance**: < 1ms  
- **Use Case**: Anonymous users, demos

**Friend/Admin Users**:
- **Storage**: File system + Git commits  
- **Persistence**: Committed to repository  
- **Performance**: ~5-10ms  
- **Use Case**: Authenticated users

**Git Integration**: Automatic commits for backup and sync.

### Cloudflare KV Storage (Parent Implements)

For Cloudflare Workers deployment, the parent implements KV storage:

```typescript
// Parent app implements
const storage: TaskStorage = {
  getTasks: async (userType) => {
    const key = `tasks:${userType}`
    const data = await env.TASK_KV.get(key, 'json')
    return data || { version: 1, tasks: [], updatedAt: new Date().toISOString() }
  },
  saveTasks: async (userType, tasks) => {
    await env.TASK_KV.put(`tasks:${userType}`, JSON.stringify(tasks))
  },
  // ... getStats, saveStats
}
```

---

## Design Patterns

### 1. Universal Adapter Pattern
**Purpose**: Separate pure business logic from framework-specific routing  
**Implementation**: Handlers export pure functions, storage is injected  
**Benefit**: Deploy to any environment (Workers, self-hosted, serverless)

### 2. Storage Interface Pattern
**Purpose**: Abstract storage implementation from business logic  
**Implementation**: Storage interface with getTasks, saveTasks, getStats, saveStats  
**Benefit**: Swap storage backends without changing handlers

### 3. Pure Handler Functions
**Purpose**: Business logic without side effects  
**Implementation**: Handlers take storage + auth + input, return results  
**Benefit**: Testable, reusable, framework-agnostic

### 4. Custom Hooks Pattern
**Purpose**: Extract stateful React logic into reusable hooks  
**Implementation**: useTasks, useDragAndDrop, useTaskSort  
**Benefit**: Clean component code, reusable state management

### 5. Component Composition
**Purpose**: Modular UI rendering  
**Implementation**: TaskLayout and TaskItem components  
**Benefit**: Clear separation of concerns

### 6. CSS Design Tokens & Theming
**Purpose**: Centralized theme configuration with multiple theme support  
**Implementation**: CSS custom properties with data attribute selectors `[data-theme]`  
**Structure**: ~45 variables per theme (primary, success/danger, text, borders, backgrounds, shadows)  
**Benefit**: Consistent styling, instant theme switching, easy to add new themes

### 7. Dynamic Button Text Colors
**Purpose**: Ensure button text visibility across all themes  
**Implementation**: `--color-success-text` and `--color-danger-text` variables (white or dark)  
**Benefit**: Accessible buttons with proper contrast regardless of background color

### 8. npm Link Self-Import
**Purpose**: Single source of truth for types  
**Implementation**: Frontend imports types from package via npm link  
**Benefit**: Eliminate type duplication between frontend and server

---

## Styling Architecture

### CSS Module System

The app uses a modular CSS architecture with separate files for different concerns:

**Core Files**:
- `variables.css` - Design tokens and theme definitions (~450 lines)
- `main.css` - Layout, header, theme picker, app structure
- `buttons.css` - All button variants (action, sort, clear, theme)
- `modal.css` - Reusable modal dialog components
- `filters.css` - Tag filter buttons and add button
- `boards.css` - Board navigation and management
- `tasks.css` - Task item cards and grid layout

### Theme System Architecture

**Data Attribute Switching**:
```css
/* Default (light) theme in :root */
:root { --color-primary: #2563eb; }

/* Theme override via data attribute */
[data-theme="dark"] { --color-primary: #60a5fa; }
```

**Theme Structure** (45 variables per theme):
```css
[data-theme="themename"] {
  /* Primary colors (5 variants) */
  --color-primary: ...
  --color-primary-dark: ...
  --color-primary-light: ...
  --color-primary-bg: ...
  --color-primary-hover: ...
  
  /* Success/Danger (theme-specific opposing colors) */
  --color-success: ...
  --color-success-dark: ...
  --color-success-text: white | #darkcolor  /* For visibility */
  --color-danger: ...
  --color-danger-dark: ...
  --color-danger-darker: ...
  --color-danger-light: ...
  --color-danger-text: white | #darkcolor  /* For visibility */
  
  /* Neutral, text, borders, backgrounds, shadows... */
}
```

**Button Color Philosophy**:
Each theme has unique, opposing button colors that reflect the theme's personality:
- **Light**: Sky blue (complete) vs Sunset orange (delete)
- **Dark**: Bright yellow vs Light purple
- **Strawberry**: Plant green vs Hot magenta
- **Cyberpunk**: NEON green vs NEON pink (full saturation)
- **Ocean**: Vibrant coral vs Electric cyan
- **Coffee**: Warm caramel vs Rich espresso brown

**Text Color System**:
- Light button backgrounds (yellow, lime, neon) use dark text (`#1e293b`, `#1f1f29`, `#020617`)
- Dark button backgrounds use white text
- Ensures checkmark ✓ and X are always visible

### Theme Picker Component

**Location**: Top-right corner of header

**Implementation**:
```tsx
// App.tsx
const [theme, setTheme] = useState<'light' | 'dark' | ...>('light')
const [showThemePicker, setShowThemePicker] = useState(false)

// Apply to document
useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme)
}, [theme])
```

**UI Structure**:
- Toggle button (32x32px, circular hover) shows current theme icon
- Horizontal dropdown opens to the right
- 7 option buttons (32x32px each) with monochrome Unicode icons
- Click-outside handler closes dropdown

**Icons**: ☼ (sun), ☽ (moon), ❖ (diamond), ≈ (waves), ◆ (diamond), ◉ (bean), ✿ (flower)

### Adding a New Theme

1. **Define theme in `variables.css`**:
```css
[data-theme="mytheme"] {
  /* Copy structure from existing theme */
  /* Define all 45 variables */
  /* Choose creative opposing button colors */
  --color-success: #color;
  --color-success-text: white; /* or dark color */
  --color-danger: #opposingcolor;
  --color-danger-text: white; /* or dark color */
}
```

2. **Add to type union in `App.tsx`**:
```tsx
const [theme, setTheme] = useState<'light' | ... | 'mytheme'>('light')
```

3. **Add icon mapping**:
```tsx
{theme === 'mytheme' ? '◈' : ...}
```

4. **Add dropdown button**:
```tsx
<button 
  className={`theme-picker__option ${theme === 'mytheme' ? 'active' : ''}`}
  onClick={() => { setTheme('mytheme'); setShowThemePicker(false); }}
  title="My Theme"
>
  ◈
</button>
```

---

## Type System

### Single Source of Truth

All TypeScript types are defined in `src/server/types.ts` and exported via package exports:

```typescript
// package.json
{
  "exports": {
    "./api/types": "./src/server/types.ts"
  }
}

// Frontend imports via npm link
import { Task, TasksFile, StatsFile } from '@hadoku/task/api/types'

// Parent imports from published package
import { Task, TasksFile, StatsFile } from '@hadoku/task/api/types'
```

### Core Types

```typescript
interface Task {
  id: ULID          // Unique identifier
  title: string
  tag?: string
  createdAt: string // ISO timestamp
  updatedAt: string
  closedAt?: string // When completed or deleted
}

interface TasksFile {
  version: number
  tasks: Task[]     // Active tasks only
  updatedAt: string
}

interface StatsFile {
  version: number
  counters: {
    totalCreated: number
    totalCompleted: number
    totalDeleted: number
    totalUpdated: number
  }
  graveyard: StatsTaskRecord[] // Completed/deleted tasks
}

interface StatsTaskRecord {
  id: ULID
  title: string
  tag?: string
  createdAt: string
  closedAt: string
  reason: 'completed' | 'deleted'
}

type UserType = 'public' | 'friend' | 'admin'
```

**Key Design**: 
- Active tasks in `tasks.json`
- Completed/deleted tasks in `stats.json` graveyard
- Single `closedAt` timestamp (no separate completedAt/deletedAt)

---

## Performance Characteristics

### Client
- **Bundle size**: ~95KB (~22KB gzipped)
- **CSS size**: ~40KB (~7KB gzipped, includes 7 complete themes)
- **Initial load**: ~50-100ms
- **Task operations**: Instant UI updates (optimistic)
- **Theme switching**: Instant (CSS custom property override)
- **Themes**: All loaded upfront, no async loading needed

### Server (Handlers)
- **Pure functions**: No overhead (just JS execution)
- **Storage-dependent**: Performance varies by implementation
  - In-memory: < 1ms
  - Filesystem: ~5-10ms
  - Cloudflare KV: ~10-50ms (depends on region)
  - Database: Varies by DB and query

---

## Extension Points

### Adding New Features

1. **New Task Property**:
   - Update `Task` interface in `src/server/types.ts`
   - Update handler logic in `src/server/handlers.ts`
   - Update UI in `src/components/TaskItem.tsx`

2. **New Handler**:
   - Add function to `src/server/handlers.ts`
   - Export in `src/server/index.ts`
   - Parent uses handler with their framework

3. **New Storage Backend**:
   - Implement `Storage` interface
   - Use with existing handlers
   - No changes needed to business logic

4. **New UI Component**:
   - Create in `src/components/`
   - Import in `App.tsx` or `TaskLayout.tsx`
   - Add styles to appropriate file in `src/styles/`

5. **New Framework Adapter**:
   - Import handlers from `@hadoku/task/api`
   - Create routes using your framework
   - Inject your Storage implementation

6. **New Theme**:
   - Add theme definition block in `src/styles/variables.css`
   - Define all CSS custom properties (~45 variables)
   - Add theme option to type union in `App.tsx`
   - Add button to theme picker dropdown with Unicode icon
   - Ensure button colors use `--color-success-text` and `--color-danger-text` for visibility

---

## Testing Strategy

### Unit Testing (Recommended)

**Pure functions** (easy to test):
- `src/lib/tagUtils.ts` - Tag parsing & filtering
- `src/lib/formatters.ts` - Date formatting
- `src/server/handlers.ts` - Task operations (framework-agnostic)
- `src/server/utils.ts` - ULID generation

**Example**:
```typescript
import { TaskHandlers } from '@hadoku/task/api'

test('createTask adds new task', async () => {
  // Mock storage
  const storage = {
    getTasks: async () => ({ version: 1, tasks: [], updatedAt: '' }),
    saveTasks: async () => {},
    getStats: async () => ({ version: 2, counters: {...}, graveyard: [] }),
    saveStats: async () => {}
  }
  
  const auth = { userType: 'public' }
  const input = { title: 'Test', tag: 'work' }
  
  const result = await TaskHandlers.createTask(storage, auth, input)
  
  expect(result.title).toBe('Test')
  expect(result.tag).toBe('work')
})
```

### Integration Testing

**Test with real storage implementation**:
```typescript
import { TaskHandlers } from '@hadoku/task/api'
import { createStorage } from '@hadoku/task/api/storage'

test('full CRUD workflow', async () => {
  const storage = createStorage('/tmp/test-data')
  const auth = { userType: 'friend' }
  
  // Create
  const task = await TaskHandlers.createTask(storage, auth, { title: 'Test' })
  expect(task.title).toBe('Test')
  
  // Update
  const updated = await TaskHandlers.updateTask(storage, auth, task.id, { title: 'Updated' })
  expect(updated.title).toBe('Updated')
  
  // Complete
  const completed = await TaskHandlers.completeTask(storage, auth, task.id)
  expect(completed.closedAt).toBeDefined()
  
  // Verify removed from active tasks
  const { tasks } = await TaskHandlers.getTasks(storage, auth)
  expect(tasks).toHaveLength(0)
})
```

---

### Maintaining Modularity

**Guidelines**:
- Keep files under 250 lines
- Extract utilities when logic repeats
- Create new components for complex UI
- Add new CSS files rather than bloating existing ones
- Use design tokens for all styling
- Keep pure functions separate from I/O
- Document new patterns in this file

---

## See Also

- **[API Reference](API.md)** - Complete endpoint documentation with examples
- **[README](../README.md)** - Project overview and quick start
