# Child Package Update Needed: Optimistic Updates for All User Types

## Current State ❌

**Problem:** Admin and Friend modes wait for API responses before updating UI (~2000ms delay)

- ✅ Public mode: Instant (uses localStorage)
- ❌ Admin mode: Waits for POST response
- ❌ Friend mode: Waits for POST response

## Required Changes in `hadoku-task` Repository

###  1. Storage Layer - Support All User Types in localStorage

**Current (`src/storage.ts`):**
```typescript
const TASKS_KEY = 'hadoku-public-tasks'
const STATS_KEY = 'hadoku-public-stats'
```

**New:**
```typescript
const getTasksKey = (userType: string) => `hadoku-${userType}-tasks`
const getStatsKey = (userType: string) => `hadoku-${userType}-stats`
```

### 2. API Client - Non-Blocking Background Sync

**Current Pattern (Blocking):**
```typescript
async function createTask(input) {
  const task = await apiClient.post('/task/api', input)  // ❌ Waits
  await reload()  // ❌ Waits for GET
  return task
}
```

**New Pattern (Optimistic):**
```typescript
async function createTask(input) {
  // 1. Generate ID locally
  const id = generateULID()
  const newTask = {
    id,
    title: input.title,
    tag: input.tag,
    state: 'Active',
    createdAt: new Date().toISOString()
  }
  
  // 2. Update localStorage IMMEDIATELY ✅
  const tasks = getTasksFromLocalStorage(userType)
  tasks.tasks.push(newTask)
  saveTasksToLocalStorage(userType, tasks)
  
  // 3. Sync to API in background (non-blocking)
  if (userType !== 'public') {
    apiClient.post('/task/api', input).catch(err => {
      console.error('Background sync failed:', err)
      // Task stays in localStorage, will retry on next action
    })
  }
  
  return newTask
}
```

### 3. Component Updates - Remove Await on Mutations

**Current:**
```typescript
async function handleCreate(title: string) {
  try {
    await taskClient.createTask({ title })  // ❌ Blocks UI
    await reload()  // ❌ Another wait
  } catch (err) {
    alert(err)
  }
}
```

**New:**
```typescript
async function handleCreate(title: string) {
  try {
    taskClient.createTask({ title })  // ✅ No await! Returns immediately
    // UI updates via localStorage change event or state update
  } catch (err) {
    // This shouldn't throw - failures are logged, not thrown
  }
}
```

### 4. Sync Queue (Advanced - Optional)

For reliable background sync:

```typescript
class SyncQueue {
  private queue: SyncOperation[] = []
  
  add(operation: SyncOperation) {
    this.queue.push(operation)
    this.processNext()
  }
  
  private async processNext() {
    if (this.processing || this.queue.length === 0) return
    
    this.processing = true
    const op = this.queue[0]
    
    try {
      await op.execute()
      this.queue.shift()  // Remove on success
    } catch (err) {
      // Retry logic with exponential backoff
      await sleep(op.retries * 1000)
      op.retries++
    } finally {
      this.processing = false
      this.processNext()
    }
  }
}
```

## Implementation Checklist

- [ ] Update storage to use `hadoku-${userType}-tasks` keys
- [ ] Make `createTask()` optimistic (localStorage first, API background)
- [ ] Make `updateTask()` optimistic
- [ ] Make `completeTask()` optimistic
- [ ] Make `deleteTask()` optimistic
- [ ] Remove `await` from mutation calls in React components
- [ ] Add error handling for background sync failures
- [ ] Test all three user types (public, friend, admin)
- [ ] Build and publish new package version
- [ ] Update parent repo to use new version

## Expected Behavior After Update

### All User Types:
1. ✅ Click "Create Task" → **Instant** UI update (< 100ms)
2. ✅ Task saved to localStorage immediately
3. ✅ API call happens in background (user doesn't wait)
4. ✅ If API fails, task stays in localStorage
5. ✅ Next successful operation syncs previous changes

### Network Behavior:
- **Public:** No API calls (localStorage only)
- **Friend/Admin:** API calls fire-and-forget style
- **UI never waits** for network responses

## Testing

After implementing:

1. Create task → Should appear instantly
2. Check DevTools → Network tab → POST should complete after UI updates
3. Check localStorage → Should have `hadoku-admin-tasks` key
4. Offline test → Create tasks offline, should work, sync when back online

## Related Files in hadoku-task Repo

```
src/
├── storage/
│   ├── localStorage.ts    # Add userType parameter
│   └── index.ts           # Export getKey functions
├── api/
│   ├── client.ts          # Make all mutations non-blocking
│   └── sync-queue.ts      # Optional: reliable sync
├── components/
│   └── TaskApp.tsx        # Remove awaits from handlers
└── hooks/
    └── useTasks.ts        # Optimistic state updates
```

## Performance Impact

**Before:**
- Create task: ~2000ms (POST + GET)
- User waits for both network calls

**After:**  
- Create task: ~50ms (localStorage write)
- Network happens async, user doesn't notice

## Migration Path

1. Update child package (`hadoku-task`)
2. Test locally with `npm link`
3. Publish to GitHub Packages
4. Update parent: `npm install @wolffm/task@latest`
5. Copy new bundles to `public/mf/task/`
6. Deploy parent site
7. Users get instant updates!

---

**Status:** ⏳ Waiting for child package update
**Priority:** 🔥 High - Significantly improves UX
