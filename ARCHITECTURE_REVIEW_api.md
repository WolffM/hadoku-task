# Architecture Review: api.ts

## Status: ✅ MOSTLY CLEAN - Minor improvements possible

## Purpose
Optimistic update API wrapper - localStorage-first with background server sync.

## Analysis

### ✅ Strengths
1. **Clear separation**: Public mode vs server-synced modes
2. **Optimistic pattern**: Immediate UI updates
3. **Fire-and-forget sync**: Background fetch doesn't block
4. **Good error handling**: All fetches have .catch()
5. **Consistent pattern**: Every method follows same structure

### ⚠️ Minor Issues

#### 1. Unused `syncBoardsToLocalStorage` Complexity
**Location:** Lines 8-47

**Current approach:**
- Function manually constructs localStorage keys
- Directly calls `window.localStorage.setItem()`
- Duplicates key generation logic from localStorageApi.ts

**Problem:**
- Bypasses the localStorageApi abstraction
- Direct localStorage manipulation is fragile
- Key format could drift from localStorageApi

**Better approach:**
```typescript
async function syncBoardsToLocalStorage(
  localApi: ReturnType<typeof createLocalStorageApi>, 
  apiData: BoardsFile
) {
  // Just use the localStorageApi methods!
  // They already know how to handle keys, validation, etc.
  
  // Option 1: Replace entire boards structure
  // (may need a new method in localStorageApi)
  
  // Option 2: For now, the existing approach works
  // but should eventually use localStorageApi methods
}
```

#### 2. Missing `getTasks` Usage
**Location:** Line 228
```typescript
async getTasks(boardId: string = 'main') {
  return await localStorage.getTasks(boardId)
}
```

**Analysis:**
- This method exists but is never called by the client
- Client always uses `getBoards()` which includes tasks
- `getTasks()` is redundant

**Recommendation:** Remove this method (not used)

#### 3. Repetitive Pattern
**Every sync method follows this pattern:**
```typescript
async createTask(...) {
  const result = await localStorage.createTask(...)
  fetch('/task/api/...', { ... })
    .then(() => console.log('[api] Background sync: createTask completed'))
    .catch(err => console.error('[api] Failed to sync createTask:', err))
  return result
}
```

**Could be simplified with a helper:**
```typescript
function withBackgroundSync<T>(
  localOp: () => Promise<T>,
  serverOp: () => Promise<any>,
  opName: string
): Promise<T> {
  const result = await localOp()
  serverOp()
    .then(() => console.log(`[api] Background sync: ${opName} completed`))
    .catch(err => console.error(`[api] Failed to sync ${opName}:`, err))
  return result
}

// Then:
async createTask(data, boardId = 'main', suppressBroadcast = false) {
  return withBackgroundSync(
    () => localStorage.createTask(data, boardId, suppressBroadcast),
    () => fetch('/task/api', { ... }),
    'createTask'
  )
}
```

**But:** Current approach is more explicit and readable. The duplication is acceptable.

### 📊 API Method Usage

| Method | Called By | Status |
|--------|-----------|--------|
| `getBoards()` | useTasks | ✅ Active |
| `syncFromApi()` | useTasks | ✅ Active |
| `getStats()` | None | ⚠️ Unused |
| `createTask()` | useTasks | ✅ Active |
| `createTag()` | useTasks | ✅ Active |
| `deleteTag()` | useTasks | ✅ Active |
| `patchTask()` | useTasks | ✅ Active |
| `completeTask()` | useTasks | ✅ Active |
| `deleteTask()` | useTasks | ✅ Active |
| `createBoard()` | useTasks | ✅ Active |
| `deleteBoard()` | useTasks | ✅ Active |
| `getTasks()` | None | ❌ Dead code |
| `getPreferences()` | App.tsx | ✅ Active |
| `savePreferences()` | App.tsx | ✅ Active |

## Recommendations

### LOW PRIORITY
1. **Remove `getTasks()` method** - Never called, redundant with getBoards()
2. **Remove `getStats()` method** - Never called, stats come with getBoards()
3. **Consider refactoring syncBoardsToLocalStorage** - Should use localStorageApi methods instead of direct localStorage access

### OPTIONAL
4. **Extract background sync pattern** - Could reduce code duplication, but current approach is fine

## Code to Remove

```typescript
// DELETE lines 228-230 (getTasks method)
async getTasks(boardId: string = 'main') {
  return await localStorage.getTasks(boardId)
},

// DELETE lines 102-104 (getStats method)
async getStats(boardId: string = 'main'): Promise<StatsFile> {
  return await localStorage.getStats(boardId)
},
```

## Overall Assessment
This file is actually in pretty good shape! The optimistic update pattern is clean and consistent. The only issues are:
- Two unused methods (getTasks, getStats)
- Minor coupling in syncBoardsToLocalStorage

After removing dead code, this file will be solid. ✅
