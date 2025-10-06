# Architecture

## Overview

Hadoku Task Manager uses a modular architecture with clear separation between client, server, and shared utilities. The codebase has been extensively refactored for maintainability:

- **App.tsx**: Reduced from 612 → 131 lines (79% reduction)
- **Router**: Reduced from 506 → 43 lines (91% reduction)  
- **CSS**: Split from 1 monolithic file → 7 organized modules with design tokens

---

## Client Architecture (React Frontend)

```
src/
├── App.tsx                    # Main component (131 lines) - orchestrates hooks & layout
├── entry.tsx                  # Micro-frontend mount/unmount exports
├── components/
│   ├── TaskItem.tsx          # Individual task card with actions
│   └── TaskLayout.tsx        # Dynamic grid layout with tag columns
├── hooks/
│   ├── useTasks.ts           # Task CRUD operations & API calls
│   ├── useDragAndDrop.ts     # Drag-and-drop state & handlers
│   └── useTaskSort.ts        # Sort state & utilities
├── lib/
│   ├── api.ts                # API client wrapper
│   ├── formatters.ts         # Date/time formatting utilities
│   ├── layoutUtils.ts        # Grid layout calculations
│   ├── tagUtils.ts           # Tag parsing & filtering logic
│   ├── types.ts              # TypeScript interfaces
│   └── ulid.ts               # ULID generation
└── styles/
    ├── index.css             # Main stylesheet (imports all others)
    ├── variables.css         # CSS custom properties (design tokens)
    ├── base.css              # Global resets & base styles
    ├── buttons.css           # Button variants (complete, delete, tag, etc.)
    ├── task-items.css        # Task list & item card styles
    ├── task-layout.css       # Grid layout & tag column styles
    └── main.css              # App structure, controls, filters
```

### Component Hierarchy

```
App (131 lines)
├── useTasks() hook - Task operations & API calls
├── useDragAndDrop() hook - Drag-and-drop logic
├── useTaskSort() hook - Sort state
└── TaskLayout
    ├── Tag columns (dynamic based on top tags)
    │   └── TaskItem (for each task in tag)
    └── Remaining tasks section
        └── TaskItem (for each untagged/remaining task)
```

### Data Flow

1. **User Action** → TaskItem component
2. **Component** → useTasks hook function
3. **Hook** → API call via lib/api.ts
4. **API Response** → Hook updates state
5. **State Update** → Re-render TaskLayout → TaskItem

### Build Output

- **Client bundle**: `dist/index.js` (~18.58KB, gzipped: 4.80KB)
- **Styles**: `dist/style.css` (~8.25KB, gzipped: 1.92KB)
- **Deploy target**: `hadoku_site/public/mf/task/`

---

## Server Architecture (Express Backend)

```
src/server/
├── router.ts                      # Main Express router (43 lines) - mounts routes
├── handlers/
│   ├── data-access.ts            # Unified data access layer (public vs file-based)
│   ├── stats-operations.ts       # Pure stats functions (record/clear)
│   └── task-operations.ts        # Pure task functions (create/complete/update/delete)
└── routes/
    ├── tasks.ts                  # GET/POST endpoints (get tasks, create, clear)
    └── task-operations.ts        # Task action endpoints (complete, update, delete)
```

### Router Architecture

**Main Router** (`router.ts` - 43 lines):
```typescript
export function createTaskRouter(config: TaskRouterConfig): Router {
  const dataAccess = new DataAccess(config.dataPath)
  const router = Router()
  
  router.use('/', createTaskRoutes(dataAccess))
  router.use('/', createTaskOperationRoutes(dataAccess))
  
  return router
}
```

**Key Pattern**: Data Access Layer eliminates duplication
- Before: 506 lines with repeated if/else for public vs file-based storage
- After: 43 lines + unified DataAccess class

### Data Access Layer

**Purpose**: Abstract storage differences between user types

```typescript
class DataAccess {
  async getTasks(userType: UserType): Promise<TaskFile>
  async getStats(userType: UserType): Promise<StatsFile>
  async setTasks(userType: UserType, tasks: TaskFile): Promise<void>
  async setStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementation**:
- **Public users**: In-memory Map storage
- **Friend/Admin users**: File system (with automatic directory creation)

### Pure Operation Functions

**Task Operations** (`task-operations.ts`):
```typescript
export function createTask(tasks: TaskFile, ...): TaskOperationResult
export function completeTask(tasks: TaskFile, ...): TaskOperationResult
export function updateTask(tasks: TaskFile, ...): TaskOperationResult
export function deleteTask(tasks: TaskFile, ...): TaskOperationResult
export function clearTasks(tasks: TaskFile): TaskOperationResult
```

**Stats Operations** (`stats-operations.ts`):
```typescript
export function recordCreation(stats: StatsFile, ...): StatsFile
export function recordCompletion(stats: StatsFile, ...): StatsFile
export function recordUpdate(stats: StatsFile, ...): StatsFile
export function recordDeletion(stats: StatsFile, ...): StatsFile
export function clearStats(stats: StatsFile): StatsFile
```

**Benefits**:
- ✅ Pure functions (no side effects)
- ✅ Easily testable
- ✅ Immutable operations
- ✅ Reusable across routes

### Route Handlers

**Task Routes** (`routes/tasks.ts`):
- `GET /` - Get all tasks
- `GET /stats` - Get statistics
- `POST /` - Create new task
- `POST /clear` - Clear all tasks (public only)

**Task Operation Routes** (`routes/task-operations.ts`):
- `POST /:id/complete` - Mark task complete
- `PATCH /:id` - Update task
- `DELETE /:id` - Delete task

**Pattern**: Routes handle HTTP, operations handle logic
```typescript
// Route handler
router.post('/', async (req, res) => {
  const tasks = await dataAccess.getTasks(userType)
  const stats = await dataAccess.getStats(userType)
  
  // Pure function does the work
  const result = createTask(tasks, stats, title, tag, timestamp)
  
  await dataAccess.setTasks(userType, result.tasks)
  await dataAccess.setStats(userType, result.stats)
  
  res.json(result.task)
})
```

### Build Output

```
dist/server/
├── router.js                 # Main Express router
├── handlers/
│   ├── data-access.js       # Data access layer
│   ├── stats-operations.js  # Stats operation functions
│   └── task-operations.js   # Task operation functions
└── routes/
    ├── tasks.js             # Task GET/POST routes
    └── task-operations.js   # Task action routes
```

**Deploy target**: `hadoku_site/api/apps/task/`

---

## Data Storage

### Public Users

**Storage**: In-memory Map  
**Persistence**: None (lost on restart)  
**Performance**: < 1ms  
**Use Case**: Anonymous users, demos

```typescript
// In DataAccess class
private publicData = new Map<string, any>()
```

### Friend/Admin Users

**Storage**: File system + Git  
**Persistence**: Permanent (committed to repository)  
**Performance**: ~5-10ms  
**Use Case**: Authenticated users

```
task/data/
├── friend/
│   ├── tasks.json    # Active tasks
│   └── stats.json    # History & analytics
└── admin/
    ├── tasks.json
    └── stats.json
```

**Auto-creation**: Directories and files created automatically on first write

**Git Integration**: Task data files are committed to the repository for:
- ✅ **Backup** - Tasks backed up to GitHub
- ✅ **Sync** - Pull/push to sync across machines  
- ✅ **History** - Git tracks changes over time
- ✅ **Simplicity** - No separate backup strategy needed

**Note**: This approach works well for personal apps. For multi-user production apps, consider using a database and excluding data files from Git

---

## Design Patterns

### 1. Data Access Layer Pattern
**Problem**: Massive duplication for public vs file-based storage  
**Solution**: Single DataAccess class with unified interface  
**Benefit**: 91% code reduction in router

### 2. Pure Operation Functions
**Problem**: Business logic mixed with HTTP handling  
**Solution**: Extract pure functions that return new objects  
**Benefit**: Testable, reusable, predictable

### 3. Custom Hooks Pattern
**Problem**: App.tsx becoming too large (612 lines)  
**Solution**: Extract stateful logic into custom hooks  
**Benefit**: 79% code reduction, reusable logic

### 4. Component Composition
**Problem**: Monolithic rendering logic  
**Solution**: TaskLayout and TaskItem components  
**Benefit**: Clear separation of concerns

### 5. CSS Design Tokens
**Problem**: Magic numbers repeated throughout CSS  
**Solution**: CSS custom properties in variables.css  
**Benefit**: Centralized theme, easy updates

---

## Type System

### Shared Types

All TypeScript interfaces defined in `src/lib/types.ts`:

```typescript
interface Task {
  id: string        // ULID
  title: string
  tag?: string
  createdAt: string // ISO timestamp
  updatedAt: string
}

interface TaskFile {
  version: number
  tasks: Task[]
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
  timeline: TimelineEvent[]
}

type UserType = 'public' | 'friend' | 'admin'
```

---

## Performance Characteristics

### Client
- **Bundle size**: 18.58KB (4.80KB gzipped)
- **CSS size**: 8.25KB (1.92KB gzipped)
- **Initial load**: ~50-100ms
- **Task operations**: Instant UI updates (optimistic)

### Server
- **Public users**: < 1ms (in-memory)
- **Friend/Admin users**: ~5-10ms (file I/O)
- **Concurrent requests**: Handled by Express
- **Memory footprint**: Minimal (~5MB base)

---

## Extension Points

### Adding New Features

1. **New Task Property**:
   - Update `Task` interface in `types.ts`
   - Update task operations in `task-operations.ts`
   - Update UI in `TaskItem.tsx`

2. **New Route**:
   - Add function to appropriate file in `routes/`
   - Mount in `router.ts`

3. **New Storage Backend**:
   - Extend `DataAccess` class
   - Add new methods for storage type
   - Update constructor to handle config

4. **New UI Component**:
   - Create in `src/components/`
   - Import in `App.tsx` or `TaskLayout.tsx`
   - Add styles to appropriate file in `src/styles/`

---

## Testing Strategy

### Unit Testing (Recommended)

**Pure functions** (easy to test):
- `src/lib/tagUtils.ts` - Tag parsing & filtering
- `src/lib/formatters.ts` - Date formatting
- `src/server/handlers/task-operations.ts` - Task operations
- `src/server/handlers/stats-operations.ts` - Stats operations

**Example**:
```typescript
import { createTask } from './task-operations'

test('createTask adds new task', () => {
  const tasks = { version: 1, tasks: [], updatedAt: '' }
  const stats = { version: 2, counters: {...}, timeline: [] }
  
  const result = createTask(tasks, stats, 'Test', 'tag', Date.now())
  
  expect(result.tasks.tasks).toHaveLength(1)
  expect(result.task.title).toBe('Test')
})
```

### Integration Testing

**Routes** (test with supertest):
```typescript
import request from 'supertest'
import { createTaskRouter } from './router'

test('POST / creates task', async () => {
  const app = express()
  app.use('/api/task', createTaskRouter({ dataPath: './test-data' }))
  
  const response = await request(app)
    .post('/api/task')
    .set('X-User-Type', 'public')
    .send({ title: 'Test', tag: 'work' })
  
  expect(response.status).toBe(200)
  expect(response.body.title).toBe('Test')
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
