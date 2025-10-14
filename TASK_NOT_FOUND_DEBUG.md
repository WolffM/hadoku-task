# Task Not Found Error - Debug Guide

## Error Symptoms

```
DELETE https://task-api.../task/api/MGPXHG6I5XOLLUFQLU3ORRAA - Ok @ 10/13/2025, 7:17:05 PM
  (error) Error: Task not found
```

- DELETE returns HTTP 200 "Ok"
- But worker logs show "Error: Task not found"
- Happens immediately after successful POST (task creation)

## Root Cause

**Parameter order mismatch between v2.2.5/v2.2.6 and KV storage implementation**

### The Bug (v2.2.6 and earlier):

```typescript
// WRONG - Storage interface had wrong parameter order
saveTasks(userType: UserType, tasks: TasksFile, userId?: string, boardId?: string)
//                              ^^^^^ tasks in SECOND position

// When createTask called:
await storage.saveTasks(auth.userType, updatedTasks, auth.userId, boardId)
//                                     ^^^^^^^^^^^^  wrong order!
```

**What happened:**
- `userType` = 'admin' (correct)
- `tasks` = updatedTasks object (correct)
- `userId` = 'some-user-id' (correct)
- `boardId` = 'main' (correct)

But the KV storage implementation expected:
```typescript
saveTasks(userType, userId, boardId, tasks)
//                                   ^^^^^ tasks should be LAST
```

**Result:** Tasks were saved to the wrong KV key or with corrupted data!

### The Fix (v2.2.7):

```typescript
// CORRECT - Parameter order matches KV implementation
saveTasks(userType: UserType, userId?: string, boardId?: string, tasks: TasksFile)
//                                                                 ^^^^^ tasks LAST

// When createTask calls:
await storage.saveTasks(auth.userType, auth.userId, boardId, updatedTasks)
//                                                            ^^^^^^^^^^^^^ correct!
```

## Why "Task not found"?

1. **createTask** (v2.2.6) saved task to wrong KV key:
   ```
   KV key: tasks:admin:TasksFile-object:main  // ❌ WRONG - used tasks object as userId!
   ```

2. **deleteTask** tried to read from correct KV key:
   ```
   KV key: tasks:admin:actual-user-id:main    // ✅ CORRECT
   ```

3. Task exists in storage but at wrong location
4. deleteTask can't find it → throws "Task not found"

## How to Fix

### 1. Deploy v2.2.7 to task-api worker

```bash
# In your task-api worker directory (hadoku_site/workers/task-api or similar)
cd /path/to/hadoku_site/workers/task-api

# Update to v2.2.7
npm install @wolffm/task@2.2.7

# Deploy to Cloudflare
npx wrangler deploy
```

### 2. Verify the version deployed

Check your worker's `package.json`:
```json
{
  "dependencies": {
    "@wolffm/task": "2.2.7"  // ← Should be 2.2.7 or higher
  }
}
```

### 3. Clear corrupted KV data (if needed)

**Option A: Fresh start (recommended for testing)**
```bash
# In Cloudflare dashboard or via wrangler:
npx wrangler kv:key delete --binding=TASKS "tasks:admin:your-user-id:main"
npx wrangler kv:key delete --binding=TASKS "stats:admin:your-user-id:main"
```

**Option B: Manual migration** (if you have production data)
- Read all KV keys with wrong format
- Manually move data to correct keys
- Delete old keys

### 4. Test the fix

1. Clear localStorage in browser (F12 → Application → Local Storage → Clear)
2. Refresh page
3. Create a task → Should see POST succeed
4. Delete the task → Should work without "Task not found" error
5. Check worker logs → Should show clean success

## Verification Checklist

- [ ] task-api worker uses `@wolffm/task@2.2.7` or higher
- [ ] Worker deployed successfully to Cloudflare
- [ ] Browser localStorage cleared
- [ ] Create task works (POST returns `{ok: true, id: "..."}`)
- [ ] Delete task works (no "Task not found" error)
- [ ] Update task works (PATCH succeeds)
- [ ] Cross-tab sync works (open two tabs, changes appear in both)

## KV Key Structure (v2.2.7+)

**Correct format:**
```
tasks:${userType}:${userId}:${boardId}
stats:${userType}:${userId}:${boardId}
boards:${userType}:${userId}
```

**Examples:**
```
tasks:admin:user-abc123:main       → TasksFile with tasks array
stats:admin:user-abc123:main       → StatsFile with counters
boards:admin:user-abc123           → BoardsFile with board metadata
tasks:admin:user-abc123:work       → Tasks for "work" board
tasks:friend:friend-xyz789:main    → Friend's tasks
```

## Related Versions

- **v2.2.5** - Board-scoped storage (tried to access board.tasks directly - WRONG)
- **v2.2.6** - Fixed board access but had parameter order bug
- **v2.2.7** - Fixed parameter order + removed dead code ✅

## Additional Notes

If you're still seeing errors after deploying v2.2.7:

1. **Check which version is actually running:**
   ```bash
   # In your worker code, add a version endpoint:
   // GET /task/api/version
   return new Response(JSON.stringify({ version: '2.2.7' }))
   ```

2. **Check KV keys manually:**
   ```bash
   npx wrangler kv:key list --binding=TASKS
   ```

3. **Enable verbose logging in worker:**
   ```typescript
   console.log('[storage] getTasks', { userType, userId, boardId })
   console.log('[storage] saveTasks', { userType, userId, boardId, tasksCount: tasks.tasks.length })
   ```

4. **Verify boardId is being passed correctly:**
   - Check browser network tab → DELETE request → Request Payload
   - Should show: `{ "boardId": "main" }`
