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

### Observed Behavior (Verified in Production Logs)

**From logs at 10/14/2025, 6:27:52 PM - Race condition confirmed:**

```
Time 0ms:   PATCH #1 reads tasks: [task1: {tag: null}, task2: {tag: null}]
Time 5ms:   PATCH #2 reads tasks: [task1: {tag: null}, task2: {tag: null}]  ← Same stale data!
Time 100ms: PATCH #1 writes: [task1: {tag: 'both-tagged'}, task2: {tag: null}]
Time 150ms: PATCH #2 writes: [task1: {tag: null}, task2: {tag: 'both-tagged'}]  ← Overwrites #1!
```

**Symptoms:**
- All requests (PATCH/POST/DELETE) report "SUCCESS" with 200 status codes
- All write operations complete without errors
- But on refresh, only partial updates are applied
- No errors or failures logged in application code
- Race condition visible only by comparing request timestamps and final state

**Affects all three scenarios:**
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

### Option 2: Batch Update Endpoints (RECOMMENDED)

**Design:** Change frontend to send one request with all updates instead of multiple individual requests.

**Why this fixes the race condition:**
- Instead of N separate HTTP requests (each doing READ → MODIFY → WRITE)
- We send ONE HTTP request that does a single READ → MODIFY ALL → WRITE
- No race condition possible because there's only one read and one write

**API Patterns:**

**A. Batch Tag Update:**
```
Current:  PATCH /task/api/TASK_ID_1 {tag: 'work'}  ← Separate read/write
          PATCH /task/api/TASK_ID_2 {tag: 'work'}  ← Separate read/write
          (Race condition: writes can overwrite each other)

Proposed: PATCH /task/api/batch-tag {
            boardId: 'main',
            updates: [
              {id: 'TASK_ID_1', tag: 'work'},
              {id: 'TASK_ID_2', tag: 'work'}
            ]
          }
          ✅ Single read, modify both tasks, single write
```

**B. Batch Board Move:**
```
Current:  POST /task/api {title: 'task1', boardId: 'target'}  ← Separate read/write
          DELETE /task/api/TASK1?boardId=source               ← Separate read/write
          POST /task/api {title: 'task2', boardId: 'target'}  ← Separate read/write
          DELETE /task/api/TASK2?boardId=source               ← Separate read/write
          (Race condition: 4 separate operations on 2 boards = 4 chances to conflict)

Proposed: POST /task/api/batch-move {
            sourceBoardId: 'source',
            targetBoardId: 'target',
            taskIds: ['TASK1', 'TASK2']
          }
          ✅ Read both boards once, modify both, write both once
```

**C. Batch Tag Clear:**
```
Current:  PATCH /task/api/TASK_ID_1 {tag: null}  ← Separate read/write
          PATCH /task/api/TASK_ID_2 {tag: null}  ← Separate read/write
          PATCH /task/api/TASK_ID_3 {tag: null}  ← Separate read/write
          DELETE /task/api/tags {boardId: 'main', tag: 'work'}
          (Race condition: N tasks = N chances to overwrite)

Proposed: POST /task/api/batch-clear-tag {
            boardId: 'main',
            tag: 'work',
            taskIds: ['TASK_ID_1', 'TASK_ID_2', 'TASK_ID_3']
          }
          ✅ Single read, modify all tasks + delete tag, single write
```

**Pros:**
- ✅ **Completely eliminates race condition** (single read-modify-write per operation)
- ✅ More efficient (one network round-trip instead of N)
- ✅ Atomic operations (all succeed or all fail together)
- ✅ Can be added alongside existing endpoints (non-breaking)
- ✅ Easy to implement - we already have all task IDs at multi-drag time

**Cons:**
- Requires frontend changes in three places
- Need three new API endpoints
- Batch endpoints need error handling for partial failures
- Doesn't fix race conditions from truly independent operations (but those don't happen in practice)

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

**✅ Implement Option 2 (Batch Endpoints) - BEST SOLUTION**

Reasons:
- **Completely fixes the race condition** by reducing N operations to 1
- **Easy to implement** - we already have all task IDs at the time of multi-drag
- **More efficient** - reduces network round-trips from N to 1
- **Atomic** - operations succeed or fail as a unit
- **Non-breaking** - old endpoints can remain for backward compatibility
- **Medium effort** - estimated 4-6 hours total (2 hours per endpoint)

**Not recommended:**
- Option 1 (Individual KV entries) - Major refactor, breaks existing storage model
- Option 3 (Optimistic locking) - Still requires multiple requests, just adds retry logic
- Option 4 (Locks) - Only works on single worker, doesn't scale to edge

## Current Workaround (Insufficient)

The `withBulkOperation()` helper in `src/hooks/useTasks/helpers.ts`:
- Suppresses individual BroadcastChannel messages during loops
- Broadcasts once after all operations complete
- **Does NOT prevent the race condition at all**
- Only prevents excessive UI re-renders
- **The race condition still happens because multiple HTTP requests are still being sent**

The problem: Even though we loop and send requests sequentially in the frontend, each request still does a separate read-modify-write cycle on the server, causing the race condition shown in the timelines above.

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
