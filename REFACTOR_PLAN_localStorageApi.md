# Refactor Plan: localStorageApi.ts → Single Source of Truth

**Created:** October 14, 2025  
**Status:** 🔴 CRITICAL - Ready to Start  
**Estimated Time:** 4-6 hours (incremental phases)  
**Impact:** -200 lines, zero duplication, maintainable codebase

---

## 🎯 Goal

Eliminate 200 lines of duplicated business logic by making client and server use the same handlers.

**Current Problem:**
```
handlers.ts (server) ─→ Validation, stats, mutations
localStorageApi.ts (client) ─→ DUPLICATE validation, stats, mutations ❌
```

**Target Solution:**
```
handlers.ts ─→ ALL business logic (single source of truth)
    ↓
    ├─→ storage.ts (KV/File) ─→ Server
    └─→ LocalStorageStorage (localStorage) ─→ Client
```

---

## 📋 Prerequisites

✅ **Completed:**
- [x] Dead code removed (clearTasks, getTasks, getStats)
- [x] Board type fixed (`tags: string[]` not optional)
- [x] Circular import resolved (session.ts created)
- [x] All `as any` casts removed from localStorageApi.ts

✅ **Ready to proceed!**

---

## 🗺️ Incremental Migration Strategy

Break the refactor into **small, testable phases**. Each phase:
1. Make one change
2. Test it works
3. Commit immediately
4. Move to next phase

### Phase Overview

| Phase | Task | Time | Risk | Can Rollback? |
|-------|------|------|------|---------------|
| 1 | Create LocalStorageStorage class | 1 hr | LOW | ✅ Yes (new file) |
| 2 | Migrate getBoards() | 30 min | LOW | ✅ Yes (one method) |
| 3 | Migrate createBoard() | 20 min | LOW | ✅ Yes (one method) |
| 4 | Migrate deleteBoard() | 20 min | LOW | ✅ Yes (one method) |
| 5 | Migrate createTask() | 30 min | MEDIUM | ✅ Yes (one method) |
| 6 | Migrate patchTask() | 30 min | MEDIUM | ✅ Yes (one method) |
| 7 | Migrate completeTask() | 20 min | LOW | ✅ Yes (one method) |
| 8 | Migrate deleteTask() | 20 min | LOW | ✅ Yes (one method) |
| 9 | Migrate createTag() | 15 min | LOW | ✅ Yes (one method) |
| 10 | Migrate deleteTag() | 15 min | LOW | ✅ Yes (one method) |
| 11 | Delete duplicated helpers | 30 min | LOW | ✅ Yes (cleanup) |
| 12 | Final testing & cleanup | 30 min | LOW | ✅ Yes (polish) |
| **TOTAL** | | **4-5 hrs** | | |

---

## 📝 Phase-by-Phase Implementation

### Phase 1: Create LocalStorageStorage Class (1 hour)

**Goal:** Implement Storage interface for localStorage

**Create:** `src/lib/storage/LocalStorageStorage.ts`

```typescript
/**
 * localStorage implementation of Storage interface
 * Used by handlers.ts to persist data client-side
 */

import type { TasksFile, StatsFile, BoardsFile } from '../types'

export class LocalStorageStorage {
  constructor(
    private userType: string = 'public',
    private userId: string = 'public'
  ) {}

  // --- Storage Keys ---
  
  private getTasksKey(userType: string, userId: string | undefined, boardId: string | undefined): string {
    return `${userType}-${userId || this.userId}-${boardId || 'main'}-tasks`
  }

  private getStatsKey(userType: string, userId: string | undefined, boardId: string | undefined): string {
    return `${userType}-${userId || this.userId}-${boardId || 'main'}-stats`
  }

  private getBoardsKey(userType: string, userId: string | undefined): string {
    return `${userType}-${userId || this.userId}-boards`
  }

  // --- Tasks Operations ---

  async getTasks(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined
  ): Promise<TasksFile> {
    const key = this.getTasksKey(userType, userId, boardId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return empty tasks file if not found
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks: []
    }
  }

  async saveTasks(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined,
    tasks: TasksFile
  ): Promise<void> {
    const key = this.getTasksKey(userType, userId, boardId)
    tasks.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(tasks))
  }

  // --- Stats Operations ---

  async getStats(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined
  ): Promise<StatsFile> {
    const key = this.getStatsKey(userType, userId, boardId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return empty stats file if not found
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      counters: {
        created: 0,
        completed: 0,
        edited: 0,
        deleted: 0
      },
      timeline: [],
      tasks: {}
    }
  }

  async saveStats(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined,
    stats: StatsFile
  ): Promise<void> {
    const key = this.getStatsKey(userType, userId, boardId)
    stats.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(stats))
  }

  // --- Boards Operations ---

  async getBoards(
    userType: string,
    userId: string | undefined
  ): Promise<BoardsFile> {
    const key = this.getBoardsKey(userType, userId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return default main board if not found
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      boards: []
    }
  }

  async saveBoards(
    userType: string,
    userId: string | undefined,
    boards: BoardsFile
  ): Promise<void> {
    const key = this.getBoardsKey(userType, userId)
    boards.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(boards))
  }

  // --- Cleanup Operations ---

  async deleteBoardData(
    userType: string,
    userId: string | undefined,
    boardId: string
  ): Promise<void> {
    const tasksKey = this.getTasksKey(userType, userId, boardId)
    const statsKey = this.getStatsKey(userType, userId, boardId)
    localStorage.removeItem(tasksKey)
    localStorage.removeItem(statsKey)
  }
}
```

**Test:**
```typescript
// Quick test in browser console
const storage = new LocalStorageStorage('public', 'public')
const boards = await storage.getBoards('public', 'public')
console.log('Boards:', boards)
```

**Commit:**
```bash
git add src/lib/storage/LocalStorageStorage.ts
git commit -m "feat: create LocalStorageStorage class implementing Storage interface"
```

---

### Phase 2: Migrate getBoards() (30 min)

**Goal:** First handler migration - prove the pattern works

**Update:** `src/lib/localStorageApi.ts`

```typescript
import { LocalStorageStorage } from './storage/LocalStorageStorage'
import * as TaskHandlers from '../server/handlers'
import { SESSION_ID } from './session'

export function createLocalStorageApi(userType: string = 'public', userId: string = 'public') {
  const storage = new LocalStorageStorage(userType, userId)
  
  return {
    // ✅ NEW: Use handler
    async getBoards(): Promise<BoardsFile> {
      const boardsFile = await TaskHandlers.getBoards(storage, { userType, userId })
      
      // Populate each board with tasks and stats (same as old logic)
      const populated: BoardsFile = { 
        version: boardsFile.version, 
        updatedAt: boardsFile.updatedAt, 
        boards: [] 
      }
      
      for (const b of boardsFile.boards) {
        const tasksFile = await storage.getTasks(userType, userId, b.id)
        const statsFile = await storage.getStats(userType, userId, b.id)
        populated.boards.push({
          id: b.id,
          name: b.name,
          tasks: tasksFile.tasks,
          stats: statsFile,
          tags: b.tags || []
        })
      }
      
      return populated
    },

    // OLD: Keep other methods unchanged for now
    async createBoard(boardId: string): Promise<Board> {
      // ... existing code
    },
    // ... rest of methods unchanged
  }
}
```

**Test:**
1. Run `npm run dev`
2. Open browser console
3. Verify boards load correctly
4. Check no errors in console

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate getBoards() to use handlers.ts"
```

---

### Phase 3: Migrate createBoard() (20 min)

**Update:** Replace createBoard method

```typescript
async createBoard(boardId: string): Promise<Board> {
  console.debug('[localStorageApi] createBoard (using handler)', { userType, userId, boardId })
  
  // Use handler
  const result = await TaskHandlers.createBoard(
    storage,
    { userType, userId },
    { id: boardId, name: boardId }
  )
  
  // Initialize empty tasks/stats for new board
  await storage.saveTasks(userType, userId, boardId, {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: []
  })
  
  await storage.saveStats(userType, userId, boardId, {
    version: 2,
    updatedAt: new Date().toISOString(),
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {}
  })
  
  // Broadcast update
  deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId })
  
  return result.board
}
```

**Test:**
1. Create a new board
2. Verify it appears in boards list
3. Switch to new board
4. Verify empty task list

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate createBoard() to use handlers.ts"
```

---

### Phase 4: Migrate deleteBoard() (20 min)

**Update:** Replace deleteBoard method

```typescript
async deleteBoard(boardId: string): Promise<void> {
  // Use handler
  await TaskHandlers.deleteBoard(
    storage,
    { userType, userId },
    boardId
  )
  
  // Cleanup board data
  await storage.deleteBoardData(userType, userId, boardId)
  
  // Broadcast update
  deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId })
}
```

**Test:**
1. Create a test board
2. Delete the board
3. Verify it's removed from list
4. Verify localStorage cleaned up

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate deleteBoard() to use handlers.ts"
```

---

### Phase 5: Migrate createTask() (30 min)

**Update:** Replace createTask method

```typescript
async createTask(
  data: { title: string; tag?: string }, 
  boardId: string = 'main', 
  suppressBroadcast: boolean = false
): Promise<Task> {
  console.log('[localStorageApi] createTask (using handler)', { data, boardId, suppressBroadcast })
  
  // Use handler - it handles stats, validation, everything
  const result = await TaskHandlers.createTask(
    storage,
    { userType, userId },
    data,
    boardId
  )
  
  // Broadcast update unless suppressed
  if (!suppressBroadcast) {
    console.log('[localStorageApi] createTask: broadcasting', { 
      sessionId: SESSION_ID, 
      boardId, 
      taskId: result.task.id 
    })
    deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  } else {
    console.log('[localStorageApi] createTask: broadcast suppressed')
  }
  
  return result.task
}
```

**Test:**
1. Create task with title only
2. Create task with title + tag
3. Verify both appear immediately
4. Check stats updated (counters.created++)
5. Verify cross-tab sync works

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate createTask() to use handlers.ts"
```

---

### Phase 6: Migrate patchTask() (30 min)

**Update:** Replace patchTask method

```typescript
async patchTask(
  id: string, 
  updates: Partial<Pick<Task, 'title' | 'tag'>>, 
  boardId: string = 'main', 
  suppressBroadcast: boolean = false
): Promise<Task> {
  // Use handler
  const result = await TaskHandlers.updateTask(
    storage,
    { userType, userId },
    id,
    updates,
    boardId
  )
  
  // Broadcast update unless suppressed
  if (!suppressBroadcast) {
    deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  }
  
  return result.task
}
```

**Test:**
1. Edit task title
2. Edit task tag
3. Verify changes persist
4. Check stats updated (counters.edited++)

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate patchTask() to use handlers.ts"
```

---

### Phase 7: Migrate completeTask() (20 min)

**Update:** Replace completeTask method

```typescript
async completeTask(id: string, boardId: string = 'main'): Promise<Task> {
  // Use handler
  const result = await TaskHandlers.completeTask(
    storage,
    { userType, userId },
    id,
    boardId
  )
  
  // Broadcast update
  deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  
  return result.task
}
```

**Test:**
1. Complete a task
2. Verify it's removed from active list
3. Check stats updated (counters.completed++)
4. Verify task.state === 'Completed'

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate completeTask() to use handlers.ts"
```

---

### Phase 8: Migrate deleteTask() (20 min)

**Update:** Replace deleteTask method

```typescript
async deleteTask(
  id: string, 
  boardId: string = 'main', 
  suppressBroadcast: boolean = false
): Promise<Task> {
  console.log('[localStorageApi] deleteTask (using handler)', { id, boardId, suppressBroadcast })
  
  // Use handler
  const result = await TaskHandlers.deleteTask(
    storage,
    { userType, userId },
    id,
    boardId
  )
  
  // Broadcast update unless suppressed
  if (!suppressBroadcast) {
    console.log('[localStorageApi] deleteTask: broadcasting', { sessionId: SESSION_ID })
    deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  } else {
    console.log('[localStorageApi] deleteTask: broadcast suppressed')
  }
  
  return result.task
}
```

**Test:**
1. Delete a task
2. Verify it's removed from list
3. Check stats updated (counters.deleted++)
4. Verify task.state === 'Deleted'

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate deleteTask() to use handlers.ts"
```

---

### Phase 9: Migrate createTag() (15 min)

**Update:** Replace createTag method

```typescript
async createTag(tag: string, boardId: string = 'main'): Promise<void> {
  // Use handler
  await TaskHandlers.createTag(
    storage,
    { userType, userId },
    tag,
    boardId
  )
  
  // Broadcast update
  deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId, boardId })
}
```

**Test:**
1. Create a custom tag
2. Verify it appears in tag list
3. Verify it persists after refresh

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate createTag() to use handlers.ts"
```

---

### Phase 10: Migrate deleteTag() (15 min)

**Update:** Replace deleteTag method

```typescript
async deleteTag(tag: string, boardId: string = 'main'): Promise<void> {
  // Use handler
  await TaskHandlers.deleteTag(
    storage,
    { userType, userId },
    tag,
    boardId
  )
  
  // Broadcast update
  deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId, boardId })
}
```

**Test:**
1. Delete a tag
2. Verify it's removed from tag list
3. Verify tasks still exist with that tag (only tag list changes)

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: migrate deleteTag() to use handlers.ts"
```

---

### Phase 11: Delete Duplicated Helpers (30 min)

**Goal:** Remove all the old helper functions that are now unused

**Delete from localStorageApi.ts:**
```typescript
// DELETE these functions (lines 19-111):
- function getTasks() { ... }
- function saveTasks() { ... }
- function getStats() { ... }
- function saveStats() { ... }
- function recordEvent() { ... }
- function getBoardsIndex() { ... }
- function saveBoardsIndex() { ... }
```

**Keep:**
```typescript
// KEEP these (still needed):
- deferredBroadcast() - used for cross-tab sync
- SESSION_ID import - used in broadcasts
```

**Test:**
1. Verify app still builds: `npm run build`
2. Full manual test:
   - Create/edit/complete/delete tasks
   - Create/delete boards
   - Create/delete tags
   - Cross-tab sync
   - Page refresh (persistence)

**Commit:**
```bash
git add src/lib/localStorageApi.ts
git commit -m "refactor: remove duplicated helper functions (-200 lines)"
```

---

### Phase 12: Final Testing & Cleanup (30 min)

**Comprehensive Testing Checklist:**

- [ ] **Task Operations**
  - [ ] Create task → appears immediately
  - [ ] Create task with tag → tag appears in filter
  - [ ] Edit task title → updates instantly
  - [ ] Edit task tag → updates instantly
  - [ ] Complete task → removed from active list
  - [ ] Delete task → removed from list
  - [ ] Stats counters update correctly

- [ ] **Board Operations**
  - [ ] Create board → appears in board list
  - [ ] Switch boards → correct tasks shown
  - [ ] Delete board → removed from list
  - [ ] Boards persist across refresh

- [ ] **Tag Operations**
  - [ ] Create tag → appears in filter
  - [ ] Drag task to tag → task tagged
  - [ ] Delete tag → removed from filter
  - [ ] Tags persist across refresh

- [ ] **Cross-Tab Sync**
  - [ ] Open app in 2 tabs
  - [ ] Create task in tab 1 → appears in tab 2
  - [ ] Complete task in tab 2 → updates in tab 1
  - [ ] Verify SESSION_ID prevents self-broadcasts

- [ ] **Error Handling**
  - [ ] Try to delete non-existent task
  - [ ] Try to create duplicate board
  - [ ] Check browser console for errors

**Performance Check:**
```bash
npm run build
# Check bundle size - should be smaller!
```

**Final Commit:**
```bash
git add .
git commit -m "refactor: complete localStorageApi migration to handlers.ts

BREAKING: None (behavior unchanged)
IMPACT: -200 lines, zero duplication, single source of truth

All task/board/tag operations now use handlers.ts business logic.
Client and server share identical validation, stats, and mutations.
Easier to maintain, test, and extend.

Closes #<issue-number>
"
```

---

## 🎉 Success Criteria

After completing all phases:

✅ **Code Quality**
- [ ] No duplicated business logic
- [ ] handlers.ts is single source of truth
- [ ] LocalStorageStorage is pure data layer
- [ ] TypeScript compiles with no errors
- [ ] No console errors in browser

✅ **Functionality**
- [ ] All features work identically to before
- [ ] Stats tracking works correctly
- [ ] Cross-tab sync works
- [ ] Data persists across refresh
- [ ] No regressions

✅ **Metrics**
- [ ] ~200 fewer lines of code
- [ ] Zero duplication between client/server
- [ ] Build size reduced
- [ ] Easier to understand and modify

---

## 🚨 Rollback Plan

**If something breaks during migration:**

1. **Identify which phase broke:**
   ```bash
   git log --oneline -10
   ```

2. **Rollback to previous working phase:**
   ```bash
   git revert <commit-hash>
   # OR
   git reset --hard <previous-good-commit>
   ```

3. **Each phase is independently committable** - safe to rollback individual changes

4. **Worst case:**
   ```bash
   git reset --hard origin/main
   # Start over from clean state
   ```

---

## 📚 Reference Files

- `ARCHITECTURE_REVIEW_localStorageApi.md` - Detailed analysis
- `ARCHITECTURE_REVIEW_handlers.md` - Handler interface
- `ARCHITECTURE_REVIEW_SUMMARY.md` - Overall strategy
- `src/server/handlers.ts` - Business logic reference
- `src/server/types.ts` - Storage interface definition

---

## 🤔 FAQ

**Q: What if I need to pause between phases?**  
A: Each phase is independently committable. Stop after any phase, commit, and resume later.

**Q: What if tests fail during a phase?**  
A: Fix the issue before committing. If stuck, revert that phase and ask for help.

**Q: Do I need to update the Worker code too?**  
A: No! Worker already uses handlers.ts correctly. This refactor is client-only.

**Q: What about preferences operations?**  
A: Keep those unchanged - they don't have duplication issues.

**Q: Will this break production?**  
A: No - this only affects client-side code. Server/Worker unchanged.

---

## ✅ Ready to Start?

1. **Review this plan** - understand each phase
2. **Start with Phase 1** - create LocalStorageStorage class
3. **Test after each phase** - verify everything works
4. **Commit frequently** - save progress after each phase
5. **Take breaks** - this is 4-6 hours of careful work

**Good luck! You got this! 🚀**

---

**Document Status:** ✅ Ready for Implementation  
**Last Updated:** October 14, 2025  
**Estimated Completion:** 4-6 hours (split across sessions)
