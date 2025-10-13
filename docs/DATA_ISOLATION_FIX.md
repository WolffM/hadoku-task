# Data Isolation Fix

## Problem Summary

When navigating between different access keys in the URL (e.g., from `https://hadoku.me/task` to `https://hadoku.me/task/?key=a21743d9-b0f1-4c75-8e01-ba2dc37feacd`), the task app was retaining data from the previous session instead of loading fresh data for the new key.

## Root Cause

The `useTasks` hook was creating the API client once on mount and never recreating it when `userType` or `userId` props changed. This caused:

1. **Stale API instance**: localStorage keys remained scoped to the old userType/userId
2. **Stale context**: Background fetch calls sent old userType/userId headers
3. **No reload trigger**: Component didn't reinitialize when userId changed (only userType)
4. **Cross-contamination**: BroadcastChannel messages from other contexts weren't filtered

## Changes Made

### 1. `src/hooks/useTasks.ts`

#### Added `useMemo` for API instance (Line ~32-36)
```typescript
// ✅ FIX: Recreate API when userType or userId changes
const api = useMemo(
  () => createApi(userType as 'public' | 'friend' | 'admin', userId || 'public'),
  [userType, userId]
)
```

**Why:** Ensures the API client is recreated with fresh localStorage keys and headers whenever the user context changes.

#### Added context change effect (Line ~61-69)
```typescript
// ✅ FIX: Clear state and reload when user context changes
useEffect(() => {
  console.log('[useTasks] User context changed, clearing state and reloading', { userType, userId })
  setTasks([])
  setPendingOperations(new Set())
  setBoards(null)
  setCurrentBoardId('main')
  void reload()
}, [userType, userId])
```

**Why:** When userType or userId changes:
- Clears all in-memory state
- Resets to default board
- Triggers fresh data load from correct localStorage scope

#### Enhanced BroadcastChannel filtering (Line ~76-87)
```typescript
// ✅ FIX: Only respond to messages for the current user context
if (msg.userType !== userType || msg.userId !== userId) {
  console.log('[useTasks] Ignoring message for different user context', { 
    msgContext: { userType: msg.userType, userId: msg.userId },
    currentContext: { userType, userId }
  })
  return
}
```

**Why:** Prevents cross-contamination between tabs with different user contexts. Tab A (public mode) won't reload when Tab B (admin mode) makes changes.

#### Updated effect dependencies (Line ~103)
```typescript
}, [currentBoardId, userType, userId]) // ✅ FIX: Recreate listener when user context changes
```

**Why:** Recreates BroadcastChannel listener with fresh closure variables when context changes.

### 2. `src/App.tsx`

#### Updated initialization effect (Line ~63-67)
```typescript
// Initialize and reload when user context changes
useEffect(() => {
  console.log('[App] User context changed, initializing...', { userType, userId })
  void initialLoad()
  inputRef.current?.focus()
}, [userType, userId])
```

**Why:** Previously only depended on `[userType]`. Now also depends on `[userId]` to reinitialize when switching between different custom user IDs (e.g., key=USER_A → key=USER_B).

## How It Works Now

### Scenario 1: Fresh Page Load
```
1. User opens: https://hadoku.me/task
   → Parent: userType='public', userId='public'
   → Child: Creates API with 'public-public-*' localStorage keys
   → Loads public tasks

2. User opens NEW TAB: https://hadoku.me/task/?key=ADMIN_KEY
   → Parent: userType='admin', userId='admin'
   → Child: Creates API with 'admin-admin-*' localStorage keys
   → Loads admin tasks
   → No interference with Tab 1
```

**Result:** ✅ Each tab has isolated data

### Scenario 2: Same-Tab Navigation
```
1. User at: https://hadoku.me/task (public mode)
   → Has some public tasks
   
2. User navigates to: https://hadoku.me/task/?key=ADMIN_KEY
   → Parent detects key change
   → Parent calls: module.mount(root, { userType: 'admin', userId: 'admin' })
   → Child receives new props
   → useEffect [userType, userId] triggers
   → Clears all state
   → Creates new API with 'admin-admin-*' keys
   → Loads admin tasks
   → Public tasks no longer visible

3. User navigates back to: https://hadoku.me/task
   → Parent calls: module.mount(root, { userType: 'public', userId: 'public' })
   → Child receives new props
   → useEffect triggers again
   → Switches back to public context
   → Public tasks reappear
```

**Result:** ✅ Data switches correctly based on URL

### Scenario 3: Multiple User IDs
```
1. User at: https://hadoku.me/task/?key=USER_ID_1
   → userType='admin', userId='USER_ID_1'
   → Adds tasks to 'admin-USER_ID_1-main-tasks'
   
2. User navigates to: https://hadoku.me/task/?key=USER_ID_2
   → userType='admin', userId='USER_ID_2'
   → useEffect detects userId change
   → Clears state, creates API with 'admin-USER_ID_2-main-tasks'
   → USER_ID_1 tasks not visible
   → Starts with empty list for USER_ID_2
```

**Result:** ✅ Each userId has isolated data

## Testing Checklist

### Test 1: Cross-Tab Isolation ✅
- [ ] Open `https://hadoku.me/task` in Tab A (public mode)
- [ ] Add task "Public Task A"
- [ ] Open `https://hadoku.me/task/?key=ADMIN_KEY` in Tab B (admin mode)
- [ ] Add task "Admin Task B"
- [ ] Verify Tab A shows only "Public Task A"
- [ ] Verify Tab B shows only "Admin Task B"

### Test 2: Same-Tab Navigation ✅
- [ ] Open `https://hadoku.me/task` (public mode)
- [ ] Add task "Public Task 1"
- [ ] Navigate to `https://hadoku.me/task/?key=ADMIN_KEY` (same tab)
- [ ] Verify "Public Task 1" disappears
- [ ] Add task "Admin Task 2"
- [ ] Navigate back to `https://hadoku.me/task` (same tab)
- [ ] Verify "Public Task 1" reappears
- [ ] Verify "Admin Task 2" not visible

### Test 3: Multiple User IDs ✅
- [ ] Navigate to `https://hadoku.me/task/?key=USER_A`
- [ ] Add task "Task for User A"
- [ ] Navigate to `https://hadoku.me/task/?key=USER_B` (same tab)
- [ ] Verify "Task for User A" not visible
- [ ] Verify task list is empty
- [ ] Add task "Task for User B"
- [ ] Navigate back to `https://hadoku.me/task/?key=USER_A`
- [ ] Verify "Task for User A" reappears
- [ ] Verify "Task for User B" not visible

### Test 4: BroadcastChannel Isolation ✅
- [ ] Open `https://hadoku.me/task` in Tab A
- [ ] Open `https://hadoku.me/task/?key=ADMIN_KEY` in Tab B
- [ ] Add task in Tab A
- [ ] Verify Tab B does NOT reload (console shows "Ignoring message for different user context")
- [ ] Add task in Tab B
- [ ] Verify Tab A does NOT reload

### Test 5: Console Logging ✅
- [ ] Open DevTools console
- [ ] Navigate between different keys
- [ ] Verify logs show:
  - `[App] User context changed, initializing...`
  - `[useTasks] User context changed, clearing state and reloading`
  - `[useTasks] Setting up BroadcastChannel listener` with correct context

## localStorage Keys Structure

The localStorage keys follow this pattern:
```
{userType}-{userId}-{boardId}-tasks
{userType}-{userId}-{boardId}-stats
{userType}-{userId}-boards
```

**Examples:**
- Public mode: `public-public-main-tasks`
- Admin mode: `admin-admin-main-tasks`
- Friend mode: `friend-friend-main-tasks`
- Custom user: `admin-a21743d9-b0f1-4c75-8e01-ba2dc37feacd-main-tasks`

This ensures complete isolation between different user contexts.

## API Request Headers

For non-public modes, background fetch calls include:
```javascript
headers: {
  'Content-Type': 'application/json',
  'X-User-Type': userType,      // e.g., 'admin'
  'X-User-Id': userId            // e.g., 'a21743d9-...'
}
```

Server uses these headers to scope data correctly.

## Deployment Checklist

- [x] Code changes committed
- [x] Build successful (`npm run build`)
- [ ] Version bumped (Husky pre-commit hook)
- [ ] Push to GitHub
- [ ] Publish package: `npm publish`
- [ ] Deploy to `hadoku.me/task`
- [ ] Run all 5 test scenarios on production
- [ ] Verify console logs show correct behavior
- [ ] Confirm no data leakage between contexts

## Related Files

- `src/hooks/useTasks.ts` - Main data management hook
- `src/App.tsx` - Root component with initialization
- `src/lib/api.ts` - API client factory
- `src/lib/localStorageApi.ts` - localStorage implementation with scoped keys
- Parent: `hadoku_site/src/components/mf-loader.js` - Passes userType/userId props

## Version

Fixed in: `@wolffm/task@2.1.14` (pending release)

## Status

- **Code Changes:** ✅ Complete
- **Build:** ✅ Successful
- **Testing:** ⏳ Pending production deployment
- **Deployment:** ⏳ Pending

---

**Author:** GitHub Copilot  
**Date:** 2025-10-13  
**Related Issue:** Data isolation across different access keys
