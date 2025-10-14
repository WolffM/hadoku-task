# ID Generation Audit - @wolffm/task

## Summary

Audit of all create operations to verify client and server use consistent IDs.

## Results

### ✅ Tasks (FIXED in v2.2.9)

**Previous Issue:**
- Client: Generated ULID with `ulid()` (e.g., `MGPY8SXDPYS9N9HLIZUU5LEU`)
- Server: Generated different ULID with `generateULID()` (e.g., `MGPY8RLQF62QYES5HIWORZ29GF`)
- Result: ID mismatch → "Task not found" errors

**Fix Applied:**
- Updated `CreateTaskInput` to accept optional `id` field
- Client sends its generated ID to server: `{ id: clientId, title, tag, boardId }`
- Server uses client ID if provided: `const id = input.id || generateULID()`
- Result: Single source of truth (client ID)

**Code Changes:**
```typescript
// src/server/types.ts
export interface CreateTaskInput {
  id?: string;  // Client-generated ID
  title: string;
  tag?: string;
}

// src/server/handlers.ts
const id = input.id || generateULID();  // Use client ID if provided

// src/lib/api.ts
fetch('/task/api', {
  method: 'POST',
  body: JSON.stringify({ 
    id: localTask.id,  // Send client ID
    ...data, 
    boardId 
  })
})
```

---

### ✅ Boards (Already Correct)

**How it works:**
- Client provides board ID as parameter: `createBoard(boardId: string)`
- Server expects ID in input: `input: { id: string; name: string }`
- Client sends: `{ boardId }` → Server uses it directly
- No ID generation on either side - user/client chooses the ID

**Code:**
```typescript
// Client
async createBoard(boardId: string) {
  const result = await localStorage.createBoard(boardId)
  fetch('/task/api/boards', {
    method: 'POST',
    body: JSON.stringify({ boardId })  // User-provided ID
  })
}

// Server
export async function createBoard(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: { id: string; name: string }  // Uses provided ID
)
```

**Status:** ✅ No mismatch possible - ID comes from user input

---

### ✅ Tags (No IDs)

**How it works:**
- Tags are just strings, not entities with IDs
- Tag name IS the identifier
- No ID generation on either side

**Code:**
```typescript
// Client
async createTag(tag: string, boardId: string = 'main')

// Server
export async function createTag(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: { boardId: string; tag: string }  // Tag is the string itself
)
```

**Status:** ✅ N/A - No IDs involved

---

## Architecture Pattern

### Client-First ID Generation ✅ (Recommended)

**Benefits:**
- Optimistic UI updates (instant feedback)
- No sync complexity
- Single source of truth (client)
- Works offline

**Implementation:**
1. Client generates ID (ULID for time-sortable uniqueness)
2. Client stores locally with that ID
3. Client sends ID to server in create request
4. Server uses provided ID (or generates if missing for backwards compatibility)

**Example:**
```typescript
// Client
const task = { id: ulid(), title: 'New task', ... }
localStorage.save(task)
api.post('/tasks', task)  // Send with ID

// Server
const id = input.id || generateULID()  // Prefer client ID
```

---

## Migration Notes

### Before (v2.2.8 and earlier)
- ❌ Tasks: Both client and server generated separate IDs → mismatch
- ✅ Boards: Client provided ID, server used it
- ✅ Tags: No IDs

### After (v2.2.9+)
- ✅ Tasks: Client generates, server uses client ID
- ✅ Boards: Client provided ID, server used it (unchanged)
- ✅ Tags: No IDs (unchanged)

---

## Testing Checklist

After deploying v2.2.9:

- [ ] Create task → Check client ID matches server ID in KV
- [ ] Delete task → Should work without "Task not found"
- [ ] Update task → Should work with same ID
- [ ] Move task between boards → ID should remain consistent
- [ ] Multiple tabs → Same task ID visible in all tabs
- [ ] Check worker logs: No "ID mismatch" warnings

---

## Future Considerations

### Option 1: Server-First IDs (Traditional)
- Server generates all IDs
- Client uses temporary IDs (e.g., `temp-${Date.now()}`)
- Server responds with real ID
- Client replaces temp ID with real ID

**Pros:** Server has control, traditional REST pattern
**Cons:** More complex sync, requires ID replacement logic

### Option 2: Client-First IDs (Current)
- Client generates all IDs
- Server accepts and uses client IDs
- No sync needed

**Pros:** Simple, optimistic updates, works offline
**Cons:** Client must generate valid unique IDs (ULID works great)

### Option 3: Hybrid
- Critical entities: Server generates (e.g., user IDs, payment IDs)
- UI entities: Client generates (e.g., tasks, notes, drafts)

**Current Choice:** Option 2 (Client-First) for tasks ✅

---

## Related Issues Fixed

- **"Task not found" errors** - Tasks were created with client ID but server saved with different ID
- **Cross-tab sync failures** - Different tabs had different IDs for same task
- **Delete/update failures** - Operations used client ID but server had different ID

All resolved by ensuring client and server use the same ID from creation.
