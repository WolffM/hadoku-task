# Architecture Review: useTasks.ts

## Status: ⚠️ NEEDS CLEANUP - Legacy patterns and duplication

## Purpose
React hook that manages task/board state and operations. Main orchestration layer between UI and API.

## Analysis

### ✅ Strengths
1. **Good separation**: UI doesn't directly call API
2. **Pending operations tracking**: Prevents duplicate requests
3. **Cross-tab sync**: BroadcastChannel for multi-tab updates
4. **Optimistic UI**: All operations show immediately
5. **Console logging**: Excellent debugging output

### 🔴 CRITICAL ISSUES

#### 1. Duplicated Broadcast Logic
**Location:** Lines 19-29 (deferredBroadcast helper) vs localStorageApi.ts

**Problem:** Same broadcast logic exists in TWO places:
- useTasks.ts: `deferredBroadcast()` function
- localStorageApi.ts: Identical `deferredBroadcast()` function

**Impact:**
- If we change broadcast format, must update both
- Logic can drift
- ~15 lines duplicated

**Fix:** Extract to shared utility:
```typescript
// src/lib/broadcast.ts
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export function broadcastUpdate(
  type: 'tasks-updated' | 'boards-updated',
  sessionId: string,
  userType: string,
  userId?: string,
  boardId?: string
) {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type, sessionId, userType, userId, boardId })
      bc.close()
    } catch (err) {
      console.error('[broadcast] Failed:', err)
    }
  }, 50)
}
```

**Then:**
- localStorageApi imports from `lib/broadcast.ts`
- useTasks imports from `lib/broadcast.ts`
- Delete both duplicate implementations

#### 2. SESSION_ID Export Causes Circular Import
**Location:** Line 16
```typescript
export const SESSION_ID = `session-${Date.now()}-...`
```

**Problem:**
- localStorageApi.ts imports `SESSION_ID` from useTasks
- useTasks imports `createApi()` which uses localStorageApi
- Creates circular dependency

**Already documented in todo #6**, but confirms the issue is real.

#### 3. Manual Reload After Every Operation
**Pattern seen throughout:**
```typescript
async function addTask(input: string) {
  await api.createTask(parsed, currentBoardId)
  await reload()  // ← Always manual reload
}

async function completeTask(taskId: string) {
  await api.completeTask(taskId, currentBoardId)
  await reload()  // ← Always manual reload
}
```

**Problem:**
- Every operation requires manual `await reload()`
- Easy to forget when adding new operations
- Causes extra network requests
- BroadcastChannel already triggers reload for cross-tab sync

**Better approach:**
```typescript
// Option 1: Auto-reload in api wrapper
async function withReload<T>(operation: () => Promise<T>): Promise<T> {
  const result = await operation()
  await reload()
  return result
}

async function addTask(input: string) {
  return withReload(() => api.createTask(parsed, currentBoardId))
}

// Option 2: Subscribe to BroadcastChannel even for own changes
// Let broadcast trigger reload for ALL updates (including own)
```

**Current approach is fine but repetitive.**

### ⚠️ MEDIUM ISSUES

#### 4. Inconsistent Error Handling
**Some operations:**
```typescript
try {
  await api.createTask(...)
  await reload()
  return true
} catch (error) {
  alert((error as Error).message || 'Failed to create task')
  return false
}
```

**Other operations:**
```typescript
try {
  await api.completeTask(...)
  await reload()
} catch (error) {
  // Only show error if it's not a 404 (task already processed)
  if (!(error as any)?.message?.includes('404')) {
    alert((error as Error).message || 'Failed to complete task')
  }
}
```

**Issues:**
- Some return success boolean, others don't
- Some swallow 404 errors, others don't
- No consistent error handling strategy
- Using `alert()` (commented as "blocked by browser")

**Better approach:**
```typescript
// Create error handler utility
function handleTaskError(error: unknown, operation: string) {
  const message = (error as Error).message || `Failed to ${operation}`
  if (message.includes('404')) {
    // Task already processed, ignore
    console.log(`[useTasks] ${operation}: Task already processed (404)`)
    return
  }
  // TODO: Use React toast/notification instead of alert
  console.error(`[useTasks] ${operation} failed:`, message)
  alert(message)
}

// Then:
catch (error) {
  handleTaskError(error, 'create task')
}
```

#### 5. Suspicious Comment: "Browser dialogs blocked"
**Location:** Line 271
```typescript
// NOTE: Browser dialogs (confirm/prompt/alert) are being blocked by browser/extension
// Proceeding without confirmation - TODO: implement custom React modal for confirmation
```

**Problem:**
- Code proceeds WITHOUT confirmation for destructive operations
- TODO has been there for a while
- Security/UX issue: users can't confirm bulk deletes

**Fix:** Implement React confirmation dialog
- Replace `confirm()`, `prompt()`, `alert()` with custom modal
- Already using React, should be easy
- Better UX anyway (styled, consistent)

#### 6. Complex Board Switching Logic
**Location:** Lines 321-336, 374-393, 406-414

Three different patterns for updating board state:
1. `createBoard`: Manual setState + getBoards + find + setTasks
2. `deleteBoard`: Check if current, complex branching
3. `switchBoard`: Simple find + setTasks OR reload

**Problem:**
- Inconsistent patterns
- Easy to miss edge cases
- Duplicated "find board and set tasks" logic

**Better approach:**
```typescript
// Extract common pattern
async function switchToBoard(boardId: string) {
  setCurrentBoardId(boardId)
  await reload()
}

async function createBoard(boardId: string) {
  await api.createBoard(boardId)
  await switchToBoard(boardId)
}

async function deleteBoard(boardId: string) {
  await api.deleteBoard(boardId)
  if (currentBoardId === boardId) {
    await switchToBoard('main')
  } else {
    await reload()
  }
}
```

### 🟢 MINOR ISSUES

#### 7. Unused Stack Trace in Logging
**Location:** Line 54
```typescript
console.log('[useTasks] reload called', { 
  currentBoardId, 
  stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
})
```

**Analysis:**
- Generating stack traces on every reload
- Performance impact (minimal but unnecessary)
- Useful for debugging during development
- Should be behind a debug flag or removed

**Options:**
1. Remove entirely (clean logs)
2. Only log in dev mode: `process.env.NODE_ENV === 'development'`
3. Use a debug flag: `if (DEBUG_MODE)`

#### 8. Filter Active Tasks Everywhere
**Pattern:**
```typescript
setTasks((board.tasks || []).filter((t: Task) => t.state === 'Active'))
```

**Appears 6+ times** throughout the file.

**Better approach:**
```typescript
function getActiveTasks(board: Board | undefined): Task[] {
  return (board?.tasks || []).filter(t => t.state === 'Active')
}

// Then:
setTasks(getActiveTasks(board))
```

Reduces duplication, easier to change logic.

### 📊 Function Complexity

| Function | Lines | Complexity | Notes |
|----------|-------|------------|-------|
| `useTasks` | 445 | 🔴 HIGH | Main hook, could be split |
| `reload` | 10 | 🟢 LOW | Simple |
| `initialLoad` | 8 | 🟢 LOW | Simple |
| `addTask` | 10 | 🟢 LOW | Simple |
| `completeTask` | 18 | 🟡 MEDIUM | Pending ops logic |
| `deleteTask` | 25 | 🟡 MEDIUM | Pending ops + logging |
| `clearTasksByTag` | 45 | 🔴 HIGH | Complex logic |
| `moveTasksToBoard` | 27 | 🟡 MEDIUM | Nested loops |
| `deleteBoard` | 20 | 🟡 MEDIUM | Branching logic |

**Recommendation:** Consider splitting into smaller hooks:
- `useTaskOperations` (create, complete, delete, update)
- `useBoardOperations` (create, delete, switch)
- `useTagOperations` (create, delete, bulk operations)
- `useTasks` (orchestrates all three)

But current approach is acceptable for now.

## Recommendations

### 🔥 HIGH PRIORITY

#### 1. Extract Broadcast Logic to Shared Utility
**Effort:** 30 minutes  
**Impact:** Eliminates duplication, fixes circular import

**Steps:**
1. Create `src/lib/broadcast.ts`
2. Move SESSION_ID and broadcast function there
3. Update localStorageApi.ts imports
4. Update useTasks.ts imports
5. Delete duplicate code

#### 2. Implement React Confirmation Modal
**Effort:** 2 hours  
**Impact:** Better UX, security

**Replace:**
- `confirm()` with `<ConfirmDialog />`
- `prompt()` with `<PromptDialog />`
- `alert()` with `<Toast />` or `<AlertDialog />`

### 🟡 MEDIUM PRIORITY

#### 3. Extract Board Switching Logic
**Effort:** 1 hour  
**Impact:** Consistency, less duplication

```typescript
async function switchToBoard(boardId: string) {
  setCurrentBoardId(boardId)
  await reload()
}

function getActiveTasks(board: Board | undefined): Task[] {
  return (board?.tasks || []).filter(t => t.state === 'Active')
}
```

#### 4. Standardize Error Handling
**Effort:** 1 hour  
**Impact:** Consistency

```typescript
function handleTaskError(error: unknown, operation: string) {
  // Consistent error handling logic
}
```

### 🟢 LOW PRIORITY

#### 5. Remove/Gate Stack Trace Logging
**Effort:** 5 minutes

```typescript
const DEBUG_MODE = import.meta.env.DEV
if (DEBUG_MODE) {
  console.log('[useTasks] reload called', { stack: ... })
}
```

#### 6. Extract Active Tasks Filter
**Effort:** 10 minutes

Reduces duplication across 6+ call sites.

## Code to Extract

### 1. Broadcast Utility (src/lib/broadcast.ts)
```typescript
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export function broadcastUpdate(
  type: 'tasks-updated' | 'boards-updated',
  data: {
    sessionId: string
    userType: string
    userId?: string
    boardId?: string
  }
) {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type, ...data })
      bc.close()
    } catch (err) {
      console.error('[broadcast] Failed:', err)
    }
  }, 50)
}
```

### 2. Board Helpers
```typescript
function getActiveTasks(board: Board | undefined): Task[] {
  return (board?.tasks || []).filter(t => t.state === 'Active')
}

async function switchToBoard(boardId: string) {
  setCurrentBoardId(boardId)
  const bf = await api.getBoards()
  setBoards(bf)
  const board = bf.boards.find(b => b.id === boardId)
  setTasks(getActiveTasks(board))
}
```

### 3. Error Handler
```typescript
function handleTaskError(error: unknown, operation: string): void {
  const message = (error as Error).message || `Failed to ${operation}`
  
  // Ignore 404s (task already processed)
  if (message.includes('404') || message.includes('not found')) {
    console.log(`[useTasks] ${operation}: Already processed`)
    return
  }
  
  console.error(`[useTasks] ${operation} failed:`, message)
  // TODO: Replace with Toast notification
  alert(message)
}
```

## Overall Assessment

**Current state:** Functional but has duplication and inconsistencies

**After cleanup:**
- ✅ No broadcast duplication
- ✅ No circular imports
- ✅ Consistent error handling
- ✅ Consistent board switching
- ✅ Better UX with React dialogs

**Estimated total cleanup time:** 5-6 hours

**Value:** High - this is a core file used by entire app
