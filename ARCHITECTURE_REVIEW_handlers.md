# Architecture Review: handlers.ts

## Status: ✅ CLEAN - No changes needed

## Purpose
Pure business logic handlers for task operations. Framework-agnostic server-side logic.

## Analysis

### ✅ Strengths
1. **Clean separation**: Pure functions, no framework coupling
2. **Consistent patterns**: All handlers follow same structure
3. **Good error messages**: Clear validation and error handling
4. **Board-scoped storage**: Properly implements v2 architecture
5. **Stats recording**: All operations properly update stats

### ⚠️ Issues Found

#### 1. Legacy `clearTasks()` Handler
**Location:** Lines 367-390
```typescript
export async function clearTasks(
  storage: Storage,
  auth: AuthContext
): Promise<{ ok: boolean; message: string }> {
  if (auth.userType !== 'public') {
    throw new Error('Forbidden: Only public users can clear tasks');
  }
  // ... localStorage-style reset behavior
}
```

**Problem:** 
- Comment says "only for public mode compatibility"
- But public users can't create tasks anyway (line 181: `if (auth.userType === 'public') throw`)
- This handler is **dead code** - it can never be used
- Public users: can't create tasks → nothing to clear
- Other users: forbidden from using clearTasks

**Recommendation:** DELETE this entire handler and remove from exports

#### 2. Unused Handlers
**Location:** Lines 138-166
```typescript
export async function getBoardTasks() { ... }
export async function getBoardStats() { ... }
```

**Analysis:**
- These are never called by the client
- Client only uses `getBoards()` which internally fetches tasks/stats
- These might be useful for future API endpoints, but currently unused

**Recommendation:** Keep for now (potential future use) OR delete if not needed

### 📊 Handler Usage Map

| Handler | Used By | Status |
|---------|---------|--------|
| `getBoards()` | Client API | ✅ Active |
| `getBoardTasks()` | None | ⚠️ Unused |
| `getBoardStats()` | None | ⚠️ Unused |
| `createTask()` | Client API | ✅ Active |
| `updateTask()` | Client API | ✅ Active |
| `completeTask()` | Client API | ✅ Active |
| `deleteTask()` | Client API | ✅ Active |
| `clearTasks()` | None | ❌ Dead code |
| `createBoard()` | Client API | ✅ Active |
| `deleteBoard()` | Client API | ✅ Active |
| `createTag()` | Client API | ✅ Active |
| `deleteTag()` | Client API | ✅ Active |

## Recommendations

### HIGH PRIORITY
1. **Delete `clearTasks()` handler** - Dead code, can never be used

### MEDIUM PRIORITY
2. **Consider removing `getBoardTasks()` and `getBoardStats()`** - Currently unused
3. If keeping them, add JSDoc comments explaining they're for future direct board/stats queries

## Code to Remove

```typescript
// DELETE lines 367-390
export async function clearTasks(
  storage: Storage,
  auth: AuthContext
): Promise<{ ok: boolean; message: string }> {
  if (auth.userType !== 'public') {
    throw new Error('Forbidden: Only public users can clear tasks');
  }

  const timestamp = now();
  const emptyTasks: TasksFile = {
    version: 1,
    updatedAt: timestamp,
    tasks: []
  };

  const emptyStats: StatsFile = {
    version: 2,
    updatedAt: timestamp,
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {}
  };

  await storage.saveTasks(auth.userType, undefined, undefined, emptyTasks);
  await storage.saveStats(auth.userType, undefined, undefined, emptyStats);

  return { ok: true, message: 'Public tasks cleared' };
}
```

Also remove from index.ts exports and any route definitions.
