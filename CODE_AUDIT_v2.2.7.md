# Code Audit Report - @wolffm/task v2.2.7

## Issues Found & Fixed

### ✅ 1. Dead Internal Helper Functions (REMOVED)
**Location:** `src/server/handlers.ts`

**Issue:** Two internal wrapper functions that were never called:
```typescript
// REMOVED - Dead code
async function getTasks(storage, userType) { ... }
async function getStats(storage, userType) { ... }
```

**Why:** After migrating to board-scoped storage, all handlers now call `storage.getTasks(userType, userId, boardId)` directly. The internal wrappers were marked as "used by write operations that haven't been migrated to boards yet" but all operations ARE migrated.

**Impact:** Reduced code size, removed confusion

---

### ✅ 2. Unused Public Utility Functions (REMOVED)
**Location:** `src/server/storage.ts`

**Issue:** Two exported functions that were never used anywhere:
```typescript
// REMOVED - Dead code
export function getPublicData(dataType: DataType) { ... }
export function setPublicData(dataType: DataType, data) { ... }
```

**Why:** These functions were exported but never imported or called by any code. The `publicData` singleton is only accessed internally by `createStorage()`.

**Impact:** Reduced package size, cleaner API surface

---

### ⚠️ 3. Bloat from Express Files (NOT REMOVED - But documented)
**Location:** `src/server/router.ts`, `src/server/routes-adapter.ts`

**Issue:** Express-specific files are compiled and published but not exported in package API:
- `router.ts` - Express router factory
- `routes-adapter.ts` - Express route adapter

**Why not removed:** Used by `test-server.ts` for local development testing

**Current State:** 
- ✅ Not exported from package API (`src/server/index.ts`)
- ✅ Can be used by consumers who want Express integration
- ❌ Adds ~8KB to published package
- ❌ Creates confusion about what's "official" API

**Recommendation:** Consider either:
1. Explicitly export them for Express users
2. Move to separate `@wolffm/task-express` adapter package
3. Delete them and rewrite test-server to use handlers directly

---

### ⚠️ 4. Parameter Order Mismatch (FIXED in v2.2.7)
**Location:** `src/server/storage.ts`, `src/server/handlers.ts`

**Issue:** Storage interface parameter order didn't match task-api implementation

**Wrong (v2.2.6):**
```typescript
saveTasks(userType, tasks, userId, boardId) // ❌ tasks in wrong position
```

**Correct (v2.2.7):**
```typescript
saveTasks(userType, userId, boardId, tasks) // ✅ matches KV storage
```

**Impact:** CRITICAL - caused runtime failures when saving tasks

---

## Code Metrics

### Before Cleanup
- `handlers.ts`: 560 lines (with dead code)
- `storage.ts`: 318 lines (with unused exports)
- Total handlers: 12 exported functions + 2 dead internal functions

### After Cleanup (v2.2.7)
- `handlers.ts`: 538 lines (removed 22 lines of dead code)
- `storage.ts`: 306 lines (removed 12 lines of dead code)
- Total handlers: 12 exported functions (clean)

**Lines removed:** 34 lines of dead code

---

## Remaining Tech Debt

### 1. Express Dependencies (Low Priority)
**Files:** `package.json` devDependencies
```json
"@types/express": "^4.17.21",
"express": "^4.18.2",
"cors": "^2.8.5"
```

**Issue:** Only used by test-server.ts, not needed for package functionality

**Options:**
- Keep: Useful for local development testing
- Remove: Reduce package install size (but breaks `npm run test:server`)

### 2. File-based Storage (Low Priority)
**Location:** `src/server/storage.ts` - `createStorage()` function

**Issue:** The file-based storage implementation doesn't support board-scoped operations:
```typescript
// V2 board-scoped storage not implemented in file-based storage
// This is a legacy implementation for backwards compatibility
```

**Impact:** 
- File-based storage (Express/test-server) uses flat structure
- KV storage (Cloudflare Workers) uses board-scoped structure
- They're incompatible

**Recommendation:** Document that file-based storage is legacy/testing only

### 3. Board.tasks field (Documentation Issue)
**Location:** `src/server/types.ts` - `Board` interface

**Issue:** The `Board` interface has `tasks: Task[]` field, but in v2 architecture, tasks are stored separately:
```typescript
export interface Board {
  id: string;
  name: string;
  tasks: Task[]; // ← This is misleading for KV storage
  tags?: string[];
}
```

**Reality:**
- KV storage: `tasks:userType:userId:boardId` → separate TasksFile
- Board storage: `boards:userType:userId` → BoardsFile without tasks
- Board.tasks is only used in file-based legacy storage

**Recommendation:** 
- Option A: Make `tasks` optional: `tasks?: Task[]`
- Option B: Document that it's for file-based storage only
- Option C: Create separate `BoardMetadata` type without tasks for KV

---

## Architecture Clarity

### What's Clean ✅
- Handlers are pure business logic
- All handlers use board-scoped storage
- Parameter order matches KV implementation
- No duplicate functions
- Clear separation: handlers (logic) vs storage (persistence)

### What's Confusing ⚠️
- Two storage patterns (file-based vs KV board-scoped)
- Board interface has tasks field that's not always used
- Express files exist but aren't part of official API
- Package publishes everything in dist/server even unused files

---

## Recommendations for Next Version

### High Priority
1. ✅ **Parameter order fix** - Done in v2.2.7
2. ✅ **Remove dead code** - Done in v2.2.7

### Medium Priority
3. Document Express files as "optional adapters"
4. Add comment to Board interface about tasks field usage
5. Update ARCHITECTURE.md with v2 storage clarification

### Low Priority
6. Consider separate `@wolffm/task-express` package
7. Consider removing file-based storage entirely
8. Consider making Board.tasks optional

---

## Testing Checklist

Before publishing v2.2.7:
- [ ] Build succeeds: `npm run build:all`
- [ ] TypeScript compiles without errors
- [ ] Test-server still works: `npm run test:server`
- [ ] Integration test with task-api worker
- [ ] Verify parameter order in production

---

## Version History

- **v2.2.7** - Remove dead code, fix parameter order
- **v2.2.6** - Board-scoped storage (had parameter order bug)
- **v2.2.5** - Board-based handlers (tried to use board.tasks - bug)
- **v2.2.4** - Added missing board/tag handlers
- **v2.2.3** - Session authentication
- **v2.0.0** - Multi-board support
