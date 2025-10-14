# Cross-Tab Synchronization Issue

## Problem Summary

When opening multiple tabs with the same user key, tabs don't see each other's changes. Each tab shows stale data from its own localStorage perspective.

## Root Cause

In `@wolffm/task` package, the `getBoards()` API function (compiled to `public/mf/task/index.js` lines 177-181):

```javascript
async getBoards() {
  const n = await o.getBoards();  // ❌ Returns localStorage immediately
  
  // ❌ Fire-and-forget API call - response is IGNORED
  fetch(`/task/api/boards?userType=${e}&userId=${encodeURIComponent(t)}`, {
    headers: V(e, t, a)
  })
    .then((r) => r.json())
    .then(() => console.log("[api] Background sync: getBoards completed"))
    .catch((r) => console.error("[api] Background sync failed (getBoards):", r));
  
  return n;  // ❌ Returns stale localStorage data
}
```

### What Happens

1. **Tab 1**: Creates 5 tasks → writes to localStorage → broadcasts message
2. **Tab 2**: Opens fresh → calls `initialLoad()` → `reload()` → `getBoards()`
3. **Tab 2**: `getBoards()` returns **its own stale localStorage** (not Tab 1's data)
4. **Tab 2**: API fetch happens in background but **response is ignored**
5. **Tab 2**: Shows 0 tasks (or old data) even though server has 5 tasks

### BroadcastChannel Issue

The BroadcastChannel listener (`public/mf/task/index.js` lines 330-349) only triggers on **localStorage writes**, not API responses:

```javascript
s.onmessage = (c) => {
  const d = c.data || {};
  // Only responds to localStorage-triggered broadcasts
  if (d.type === "tasks-updated" || d.type === "boards-updated") {
    S();  // Reload - but this STILL reads localStorage!
  }
};
```

Even if we broadcast after API sync, the `reload()` function calls `getBoards()` which returns localStorage again!

## Solution Required

### Fix #1: Force API Sync on Load (Priority 1)

Change `getBoards()` to fetch from API **first**, then update localStorage:

```javascript
async getBoards() {
  try {
    // ✅ Fetch from API FIRST
    const apiResponse = await fetch(`/task/api/boards?userType=${e}&userId=${encodeURIComponent(t)}`, {
      headers: V(e, t, a)
    });
    
    if (!apiResponse.ok) {
      throw new Error(`API returned ${apiResponse.status}`);
    }
    
    const apiData = await apiResponse.json();
    
    // ✅ Merge API data into localStorage
    // For each board in apiData.boards:
    //   - Update board metadata in boards file
    //   - Write tasks to tasks:{userType}:{userId}:{boardId} key
    //   - Write stats to stats:{userType}:{userId}:{boardId} key
    
    console.log("[api] Synced from API to localStorage", {
      boardCount: apiData.boards.length,
      taskCount: apiData.boards.reduce((sum, b) => sum + (b.tasks?.length || 0), 0)
    });
    
    // ✅ Broadcast that we updated from API
    I('api-synced', { userType: e, userId: t });
    
  } catch (error) {
    console.error("[api] API fetch failed, falling back to localStorage:", error);
  }
  
  // ✅ Now return localStorage (updated if API succeeded)
  return await o.getBoards();
}
```

### Fix #2: Broadcast API Updates (Priority 1)

After successful API sync, broadcast a message so other tabs can reload:

```javascript
// In createTask, deleteTask, completeTask, etc.
await fetch("/task/api", { ... })
  .then(() => {
    console.log("[api] Background sync: createTask completed");
    // ✅ Broadcast so other tabs know to reload
    I('api-synced', { userType: e, userId: t });
  });
```

### Fix #3: Listen for API Sync Broadcasts (Priority 1)

Update BroadcastChannel listener to respond to `api-synced` events:

```javascript
s.onmessage = (c) => {
  const d = c.data || {};
  
  if (d.type === "tasks-updated" || 
      d.type === "boards-updated" || 
      d.type === "api-synced") {  // ✅ Added
    console.log("[useTasks] BroadcastChannel: triggering reload");
    S();  // This will now call getBoards() which syncs from API
  }
};
```

### Fix #4: Sync Other Operations (Priority 2)

Apply the same pattern to:
- `getTasks(boardId)` - should sync from API first
- `getStats(boardId)` - should sync from API first
- All write operations should broadcast after API success

## Testing Strategy

1. **Open Tab 1**: Create 3 tasks
2. **Open Tab 2**: Should immediately show 3 tasks (verifies Fix #1)
3. **Tab 1**: Create 2 more tasks (now 5 total)
4. **Tab 2**: Should auto-update to show 5 tasks within ~50ms (verifies Fix #2 + #3)
5. **Tab 2**: Delete 1 task (now 4 total)
6. **Tab 1**: Should auto-update to show 4 tasks (verifies cross-tab sync works both ways)

## Implementation Location

**Package**: `@wolffm/task` (private GitHub package)
**Files to modify**:
- Client-side API wrapper (the code that compiles to `public/mf/task/index.js`)
- Specifically the `Xe()` function that wraps `Je()` with API calls

**After fixing**:
1. Update package version (e.g., `2.2.11`)
2. Publish to GitHub packages
3. Run `npm install @wolffm/task@latest` in hadoku_site
4. Run `npm run update-task-bundle` to regenerate `public/mf/task/index.js`
5. Deploy edge-router and task-api workers

## Impact

- **Before**: Tabs show independent stale data, no cross-tab awareness
- **After**: All tabs stay synchronized, always show server truth
- **Performance**: Adds ~50-200ms latency on initial load (acceptable for correctness)
- **Offline**: Falls back to localStorage if API fails (graceful degradation)

## Current Workaround

None. User must manually refresh each tab to see changes from other tabs.
