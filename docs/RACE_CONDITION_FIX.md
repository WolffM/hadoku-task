# Race Condition Issue in Task API

## Problem Description

When multiple PATCH/POST/DELETE requests are sent simultaneously for operations affecting the same board, only some updates succeed while others are lost. This affects three main scenarios:

1. **Multi-tag assignment** - Dragging 2+ tasks onto a tag
2. **Multi-board move** - Dragging 2+ tasks to a different board (involves both CREATE and DELETE)
3. **Clear tag from all tasks** - Clicking "Clear All" button to remove a tag from multiple tasks

In all cases, only partial updates succeed and the rest are overwritten.

### Root Cause

The `@wolffm/task` package uses a **file-based storage pattern**:
- All tasks for a board are stored in a single KV entry: `tasks:admin:main`
- Each PATCH request performs: **READ entire file → MODIFY one task → WRITE entire file**
- Concurrent requests create a race condition where the second write overwrites the first

### Example Timeline (Multi-Tag Scenario)

```
Time 494ms:  PATCH /task/api/TASK1 {tag: 'work'} starts
             - Reads KV: [task1: {tag: null}, task2: {tag: null}]
             - Updates task1 in memory: {tag: 'work'}

Time 499ms:  PATCH /task/api/TASK2 {tag: 'work'} starts (5ms later)
             - Reads KV: [task1: {tag: null}, task2: {tag: null}]  ← Still old data!
             - Updates task2 in memory: {tag: 'work'}

Time 916ms:  PATCH #1 writes to KV
             - Saves: [task1: {tag: 'work'}, task2: {tag: null}]

Time 1019ms: PATCH #2 writes to KV
             - Saves: [task1: {tag: null}, task2: {tag: 'work'}]  ← Overwrites PATCH #1!
```

**Result:** Only task2 has the tag. Task1's update was lost.

### Example Timeline (Multi-Board Move Scenario)

```
Time 100ms:  POST /task/api (create task1 on board2) starts
             - Reads KV for board2: [task3, task4]
             - Adds task1 to board2 in memory

Time 105ms:  POST /task/api (create task2 on board2) starts
             - Reads KV for board2: [task3, task4]  ← Still old data!
             - Adds task2 to board2 in memory

Time 200ms:  DELETE /task/api/TASK1 (from board1) starts
             - Reads KV for board1: [task1, task2]
             - Removes task1 from board1

Time 205ms:  DELETE /task/api/TASK2 (from board1) starts  
             - Reads KV for board1: [task1, task2]  ← Still old data!
             - Removes task2 from board1

Time 300ms:  POST #1 writes board2 KV → [task3, task4, task1]
Time 350ms:  POST #2 writes board2 KV → [task3, task4, task2]  ← Lost task1!
Time 400ms:  DELETE #1 writes board1 KV → [task2]
Time 450ms:  DELETE #2 writes board1 KV → [task1]  ← Lost task2 deletion!
```

**Result:** task1 exists on both boards, task2 was deleted from source but not added to target.

### Example Timeline (Clear Tag Scenario)

```
Time 100ms:  PATCH /task/api/TASK1 {tag: null} starts
             - Reads KV: [task1: {tag: 'work'}, task2: {tag: 'work'}, task3: {tag: 'work'}]
             - Updates task1 to remove 'work' tag

Time 110ms:  PATCH /task/api/TASK2 {tag: null} starts
             - Reads KV: [task1: {tag: 'work'}, task2: {tag: 'work'}, task3: {tag: 'work'}]  ← Stale!
             - Updates task2 to remove 'work' tag

Time 120ms:  PATCH /task/api/TASK3 {tag: null} starts
             - Reads KV: [task1: {tag: 'work'}, task2: {tag: 'work'}, task3: {tag: 'work'}]  ← Stale!
             - Updates task3 to remove 'work' tag

Time 300ms:  PATCH #1 writes → [task1: {tag: null}, task2: {tag: 'work'}, task3: {tag: 'work'}]
Time 310ms:  PATCH #2 writes → [task1: {tag: 'work'}, task2: {tag: null}, task3: {tag: 'work'}]  ← Reverted task1!
Time 320ms:  PATCH #3 writes → [task1: {tag: 'work'}, task2: {tag: 'work'}, task3: {tag: null}]  ← Reverted 1&2!
```

**Result:** Only task3 has tag removed. Task1 and task2 still have 'work' tag.

### Observed Behavior

From logs at 10/14/2025, 6:27:52 PM:
- All requests (PATCH/POST/DELETE) report "SUCCESS"
- All write operations complete without errors
- But on refresh, only partial updates are applied
- No errors or failures logged
- Affects all three scenarios:
  - Multi-tag: Only last-written task gets the tag
  - Multi-board move: Tasks may duplicate or disappear
  - Clear tag: Only last-written task has tag removed

### Affected Code Locations

**Frontend (`@wolffm/task` package):**
- `src/hooks/useTasks/index.ts`:
  - `bulkUpdateTaskTags()` - Multi-tag assignment (lines 189-206)
  - `moveTasksToBoard()` - Multi-board move (lines 285-313)
  - `clearTasksByTag()` - Clear tag from all tasks (lines 208-255)

**All three use `withBulkOperation()` helper which:**
1. Suppresses individual broadcasts
2. Loops through tasks making sequential API calls
3. Broadcasts once at the end
4. **But doesn't prevent the race condition at the storage layer**

## Solution Options

### Option 1: Individual KV Entries (Proper Fix)

**Design:** Store each task as a separate KV entry instead of one big file.

**Storage Pattern:**
```
Current:  tasks:admin:main → {tasks: [task1, task2, task3, ...]}
Proposed: task:admin:main:TASK_ID_1 → task1
          task:admin:main:TASK_ID_2 → task2
          task:admin:main:TASK_ID_3 → task3
```

**Pros:**
- Eliminates race conditions entirely
- Each task update is independent
- Better scalability (no need to read/write entire array)
- Faster operations (only touch the data you need)

**Cons:**
- Requires significant refactoring of storage layer
- Need to update all handlers (get, create, update, delete)
- Need to handle "get all tasks" differently (multiple KV reads or maintain an index)
- Breaking change - requires data migration

**Implementation Steps:**
1. Update storage interface in `@wolffm/task/api/storage`
2. Change key pattern from `tasks:${userType}:${boardId}` to `task:${userType}:${boardId}:${taskId}`
3. Update `updateTask` handler to read/write single task
4. Update `getBoardTasks` to read multiple individual keys
5. Add migration script for existing data
6. Update tests

**Estimated Effort:** Medium-Large (4-8 hours)

---

### Option 2: Batch Update Endpoints (Frontend Fix)

**Design:** Change frontend to send one request with all updates instead of multiple individual requests.

**API Patterns:**

**A. Batch Tag Update:**
```
Current:  PATCH /task/api/TASK_ID_1 {tag: 'work'}
          PATCH /task/api/TASK_ID_2 {tag: 'work'}

Proposed: PATCH /task/api/batch-tag {
            boardId: 'main',
            updates: [
              {id: 'TASK_ID_1', tag: 'work'},
              {id: 'TASK_ID_2', tag: 'work'}
            ]
          }
```

**B. Batch Board Move:**
```
Current:  POST /task/api {title: 'task1', boardId: 'target'}  (create)
          DELETE /task/api/TASK1?boardId=source               (delete)
          POST /task/api {title: 'task2', boardId: 'target'}  (create)
          DELETE /task/api/TASK2?boardId=source               (delete)

Proposed: POST /task/api/batch-move {
            sourceBoardId: 'source',
            targetBoardId: 'target',
            taskIds: ['TASK1', 'TASK2']
          }
```

**C. Batch Tag Clear:**
```
Current:  PATCH /task/api/TASK_ID_1 {tag: null}
          PATCH /task/api/TASK_ID_2 {tag: null}
          PATCH /task/api/TASK_ID_3 {tag: null}
          DELETE /task/api/tags {boardId: 'main', tag: 'work'}

Proposed: POST /task/api/batch-clear-tag {
            boardId: 'main',
            tag: 'work',
            taskIds: ['TASK_ID_1', 'TASK_ID_2', 'TASK_ID_3']
          }
```

**Pros:**
- Naturally avoids race condition (single request per operation)
- More efficient (one network round-trip instead of N)
- Simpler backend logic (one read-modify-write cycle)
- Can be added alongside existing endpoints (non-breaking)
- Atomic operations (all succeed or all fail)

**Cons:**
- Requires frontend changes in three places
- Need three new API endpoints
- Batch endpoints need error handling for partial failures
- Doesn't fix race conditions for independent operations (though those are rare)

**Implementation Steps:**

**Backend (`workers/task-api`):**
1. Add `POST /task/api/batch-tag` endpoint
2. Add `POST /task/api/batch-move` endpoint  
3. Add `POST /task/api/batch-clear-tag` endpoint
4. Each handler: read once, apply all updates, write once
5. Add proper error responses for validation/partial failures
6. Keep old endpoints for backward compatibility

**Frontend (`@wolffm/task` package):**
1. Update `src/api/client.ts`:
   - Add `bulkUpdateTaskTags(boardId, updates)` method
   - Add `moveTasksToBoard(sourceBoardId, targetBoardId, taskIds)` method
   - Add `clearTagFromTasks(boardId, tag, taskIds)` method
2. Update `src/hooks/useTasks/index.ts`:
   - Change `bulkUpdateTaskTags()` to call new batch endpoint
   - Change `moveTasksToBoard()` to call new batch endpoint
   - Change `clearTasksByTag()` to call new batch endpoint
3. Remove loop-based API calls, replace with single batch call

**Estimated Effort:** Medium (4-6 hours total, ~2 hours per endpoint)

---

### Option 3: Optimistic Locking (Retry Pattern)

**Design:** Add version numbers to the tasks file and retry on conflicts.

**Pattern:**
```typescript
do {
  const {tasks, version} = await readTasksWithVersion();
  const updatedTasks = modifyTask(tasks, taskId, updates);
  success = await writeIfVersionMatches(updatedTasks, version);
} while (!success && retries < MAX_RETRIES);
```

**Pros:**
- Handles race conditions gracefully
- No storage redesign needed
- Works with existing storage pattern

**Cons:**
- Adds complexity (version tracking, retry logic)
- Performance penalty on conflicts (wasted reads/writes)
- Doesn't solve fundamental design issue
- May still fail if too many concurrent requests

**Estimated Effort:** Small (1-2 hours)

---

### Option 4: In-Memory Lock (Quick Workaround)

**Design:** Add mutex/semaphore at worker level to serialize writes to same board.

**Pattern:**
```typescript
const boardLocks = new Map<string, Promise<any>>();

async function withBoardLock(boardKey, operation) {
  await boardLocks.get(boardKey); // Wait for previous operation
  const promise = operation();
  boardLocks.set(boardKey, promise);
  return await promise;
}
```

**Pros:**
- Quick to implement (already coded in current branch)
- No storage changes needed
- No frontend changes needed
- Works immediately

**Cons:**
- Only works within single worker instance (not across edge locations)
- Doesn't scale well (serializes ALL operations on a board)
- Band-aid solution, doesn't fix root cause
- May cause performance bottleneck with many concurrent users

**Estimated Effort:** Minimal (already implemented)

---

## Recommendation

**Short-term:** Deploy Option 4 (lock) to fix the immediate issue.

**Long-term:** Choose between:
- **Option 1** if you want proper KV design (best for scale)
- **Option 2** if you want quick win with frontend change (easiest to implement well)

**Not recommended:**
- Option 3 (optimistic locking) - adds complexity without solving fundamental issue

## Current Workaround

The `withBulkOperation()` helper in `src/hooks/useTasks/helpers.ts`:
- Suppresses individual BroadcastChannel messages during loops
- Broadcasts once after all operations complete
- **Does NOT prevent the race condition** (broadcasts are separate from storage writes)
- Only prevents excessive UI re-renders

## Related Files

**Backend:**
- `src/domain/handlers/handlers.ts` - Task operation handlers (child package)
- `src/server/storage.ts` - Storage interface (child package)
- `workers/task-api/src/index.ts` - API worker in parent repo (has lock implementation)

**Frontend (all in child package `@wolffm/task`):**
- `src/hooks/useTasks/index.ts` - Contains all three affected operations
- `src/hooks/useTasks/helpers.ts` - `withBulkOperation()` helper
- `src/api/client.ts` - API client methods (needs batch methods added)
- `src/hooks/useDragAndDrop/index.ts` - Multi-drag selection logic
