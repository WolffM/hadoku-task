# Refactor Analysis: handlers.ts

## File Stats
- **Lines:** 527
- **Handlers:** 11 exported functions
- **Current Status:** Single source of truth for all business logic

## Analysis Date: October 14, 2025

---

## 🔍 Identified Patterns & Duplication

### 1. **Auth Guard Pattern** (7 occurrences)
**Lines:** 180, 225, 274, 369, 407, 445, 493

**Duplicated Code:**
```typescript
if (auth.userType === 'public') {
  throw new Error('Forbidden: Public users cannot [action]');
}
```

**Impact:** ~14 lines (2 lines × 7 occurrences)

**Recommendation:** Extract to helper function
```typescript
/**
 * Require authenticated user (non-public)
 * @throws Error if user is public
 */
function requireAuth(auth: AuthContext, action: string): void {
  if (auth.userType === 'public') {
    throw new Error(`Forbidden: Public users cannot ${action}`);
  }
}

// Usage:
requireAuth(auth, 'create tasks');
requireAuth(auth, 'update tasks');
```

**Savings:** ~10 lines of code, improved consistency

---

### 2. **Task Lookup Pattern** (3 occurrences)
**Lines:** 235-238, 284-287, 329-332

**Duplicated Code:**
```typescript
const taskIndex = tasks.tasks.findIndex(t => t.id === taskId);
if (taskIndex < 0) {
  throw new Error('Task not found');
}
const task = tasks.tasks[taskIndex];
```

**Impact:** ~12 lines (4 lines × 3 occurrences)

**Recommendation:** Extract to helper function
```typescript
/**
 * Find task by ID or throw error
 * @throws Error if task not found
 */
function findTaskOrThrow(tasks: TasksFile, taskId: ULID): { task: Task; index: number } {
  const index = tasks.tasks.findIndex(t => t.id === taskId);
  if (index < 0) {
    throw new Error('Task not found');
  }
  return { task: tasks.tasks[index], index };
}

// Usage:
const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId);
```

**Savings:** ~8 lines of code

---

### 3. **Board Lookup Pattern** (3 occurrences)
**Lines:** 419-422, 452-455, 500-503

**Duplicated Code:**
```typescript
const boardIndex = boards.boards.findIndex(b => b.id === boardId);
if (boardIndex < 0) {
  throw new Error(`Board ${boardId} not found`);
}
const board = boards.boards[boardIndex];
```

**Impact:** ~12 lines (4 lines × 3 occurrences)

**Recommendation:** Extract to helper function
```typescript
/**
 * Find board by ID or throw error
 * @throws Error if board not found
 */
function findBoardOrThrow(boards: BoardsFile, boardId: string): { board: Board; index: number } {
  const index = boards.boards.findIndex(b => b.id === boardId);
  if (index < 0) {
    throw new Error(`Board ${boardId} not found`);
  }
  return { board: boards.boards[index], index };
}

// Usage:
const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
```

**Savings:** ~8 lines of code

---

### 4. **Board Update Pattern** (2 occurrences)
**Lines:** 469-477 (createTag), 512-520 (deleteTag)

**Duplicated Code:**
```typescript
const updatedBoards: BoardsFile = {
  ...boards,
  updatedAt: timestamp,
  boards: [
    ...boards.boards.slice(0, boardIndex),
    updatedBoard,
    ...boards.boards.slice(boardIndex + 1)
  ]
};
```

**Impact:** ~18 lines (9 lines × 2 occurrences)

**Recommendation:** Extract to helper function
```typescript
/**
 * Update a board at specific index immutably
 */
function updateBoardAtIndex(
  boards: BoardsFile,
  boardIndex: number,
  updatedBoard: Board,
  timestamp: string
): BoardsFile {
  return {
    ...boards,
    updatedAt: timestamp,
    boards: [
      ...boards.boards.slice(0, boardIndex),
      updatedBoard,
      ...boards.boards.slice(boardIndex + 1)
    ]
  };
}

// Usage:
const updatedBoards = updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp);
```

**Savings:** ~10 lines of code

---

### 5. **Timestamp Generation** (8 occurrences)
**Lines:** 184, 229, 278, 323, 373, 416, 449, 497

**Current Code:**
```typescript
const timestamp = now();
```

**Analysis:** This is already using a utility function from `utils.ts`. ✅ **Already optimal!**

**No action needed.**

---

## 📊 Summary

| Pattern | Occurrences | Lines Wasted | Recommended Action |
|---------|-------------|--------------|-------------------|
| Auth guard | 7 | ~14 | Extract `requireAuth()` |
| Task lookup | 3 | ~12 | Extract `findTaskOrThrow()` |
| Board lookup | 3 | ~12 | Extract `findBoardOrThrow()` |
| Board update | 2 | ~18 | Extract `updateBoardAtIndex()` |
| Timestamp | 8 | 0 | ✅ Already using `now()` |
| **TOTAL** | **23** | **~56 lines** | **4 new helpers** |

---

## 🎯 Refactor Proposal

### Option A: Add Helpers to handlers.ts (Minimal)
**Pros:**
- Self-contained file
- No additional imports needed
- Quick to implement

**Cons:**
- File stays at ~490 lines (527 - 56 + 20 for helpers = ~491)
- Helpers are internal-only

### Option B: Create handlers-utils.ts (Recommended)
**Pros:**
- Separates pure helpers from business logic
- Makes helpers reusable
- handlers.ts becomes ~470 lines (more focused)
- Clear separation of concerns

**Cons:**
- One more file
- Additional import statement

**Recommended Structure:**
```
src/server/
  handlers.ts          (~470 lines - business logic only)
  handlers-utils.ts    (~50 lines - helper functions)
  utils.ts             (~25 lines - generic utilities)
```

---

## 💡 Additional Observations

### Already Well-Refactored ✅
1. **Stats recording functions** (recordCreation, recordCompletion, etc.)
   - Already extracted
   - Good separation of concerns
   - No further action needed

2. **Timestamp utility** (`now()`)
   - Already in utils.ts
   - Properly reused throughout

### Not Worth Extracting
1. **Storage operations** (get/save patterns)
   - Each has unique parameters
   - Context-specific logic
   - Would create more complexity than it saves

2. **Task state updates**
   - Each handler has unique update logic
   - Different fields modified in each case
   - Should stay inline for clarity

---

## 🚀 Implementation Plan

### Phase 1: Create handlers-utils.ts
```typescript
// src/server/handlers-utils.ts
export function requireAuth(auth: AuthContext, action: string): void { ... }
export function findTaskOrThrow(tasks: TasksFile, taskId: ULID) { ... }
export function findBoardOrThrow(boards: BoardsFile, boardId: string) { ... }
export function updateBoardAtIndex(boards: BoardsFile, ...) { ... }
```

### Phase 2: Update handlers.ts
1. Add import: `import { requireAuth, findTaskOrThrow, ... } from './handlers-utils.js'`
2. Replace 7 auth guards with `requireAuth(auth, 'action')`
3. Replace 3 task lookups with `findTaskOrThrow(...)`
4. Replace 3 board lookups with `findBoardOrThrow(...)`
5. Replace 2 board updates with `updateBoardAtIndex(...)`

### Phase 3: Verify
- Run tests
- Check bundle size
- Verify no regressions

---

## 📉 Expected Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| handlers.ts lines | 527 | ~470 | -57 lines (-11%) |
| Total lines (handlers + utils) | 527 | ~520 | -7 lines |
| Code duplication | 56 lines | 0 lines | -56 lines |
| Reusable helpers | 0 | 4 | +4 functions |

---

## ⚠️ Trade-offs

**Pros:**
- ✅ Less duplication (56 lines eliminated)
- ✅ More consistent error handling
- ✅ Easier to modify auth logic in one place
- ✅ Better testability (helpers can be unit tested)
- ✅ Clearer business logic (less boilerplate)

**Cons:**
- ❌ One more file to maintain
- ❌ Slightly more indirection (function calls)
- ❌ Need to understand helpers when reading code

---

## 🤔 Recommendation

**YES, refactor is worth it** if:
- You plan to add more handlers in the future
- You want to enforce consistent patterns
- You value DRY principles

**NO, keep as-is** if:
- File size isn't a concern
- You prefer explicit code over abstractions
- Team is unfamiliar with helper patterns

**My Vote:** ✅ **REFACTOR** - The consistency and maintainability gains outweigh the cost of one additional file.

---

## 📝 Notes

- handlers.ts is already in good shape (has recordX helpers)
- This refactor is **nice-to-have**, not urgent
- Can be done incrementally (one pattern at a time)
- All handlers would benefit from these helpers
