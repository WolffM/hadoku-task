# Architecture Review: localStorageApi.ts

## Status: ⚠️ NEEDS REFACTORING - Duplication with handlers.ts

## Purpose
Client-side localStorage operations that mirror server API interface.

## Analysis

### 🔴 CRITICAL ISSUE: Code Duplication with handlers.ts

**Problem:** This file duplicates ~70% of the business logic from `handlers.ts`

#### Duplicated Logic:

1. **Stats Recording** (Lines 76-111 vs handlers.ts lines 21-97)
   - `recordEvent()` here vs `recordCreation/Completion/Update/Deletion()` in handlers
   - Same logic: update counters, timeline, task snapshots
   - **Should be shared, not duplicated**

2. **Task State Management**
   - completeTask: Sets state='Completed', closedAt
   - deleteTask: Sets state='Deleted', closedAt
   - **Identical to handlers.ts logic**

3. **Board/Tag Operations**
   - createBoard: Check exists, add to array
   - deleteBoard: Filter from array
   - createTag: Check exists, append to tags array
   - deleteTag: Filter from tags array
   - **Same validation and mutation logic as handlers.ts**

### 🏗️ Architecture Problem

```
Current (BAD):
┌─────────────────┐
│  handlers.ts    │  Stats recording, board logic, validation
└─────────────────┘
         ↓
┌─────────────────┐
│  storage.ts     │  KV/File persistence
└─────────────────┘

┌─────────────────┐
│ localStorageApi │  DUPLICATES all the same logic! ❌
└─────────────────┘
         ↓
┌─────────────────┐
│  localStorage   │  Browser persistence
└─────────────────┘
```

```
Proposed (GOOD):
┌─────────────────┐
│  handlers.ts    │  ALL business logic (stats, validation, etc)
└─────────────────┘
         ↓
┌─────────────────┴──────────────────┐
│                                     │
┌─────────────────┐      ┌───────────────────┐
│  storage.ts     │      │ localStorageApi   │
│  (KV/File)      │      │ (implements       │
│                 │      │  Storage interface)│
└─────────────────┘      └───────────────────┘
```

### ⚠️ Other Issues

#### 1. Circular Import
**Location:** Line 10
```typescript
import { SESSION_ID } from '../hooks/useTasks'
```

**Problem:**
- localStorageApi imports from useTasks
- useTasks uses localStorageApi
- Creates coupling between layers
- SESSION_ID should be passed as parameter, not imported

#### 2. Tag Persistence Logic Duplication
**Location:** Lines 207-217, 240-250
```typescript
// If tag provided, ensure it's in the persisted boards index for this board
if (data.tag) {
  const index = getBoardsIndex(userType, userId)
  const b = index.boards.find(bb => bb.id === boardId)
  if (b) {
    const existing = (b as any).tags || []
    const toAdd = data.tag.split(' ').filter(Boolean).filter(t => !existing.includes(t))
    // ...
  }
}
```

**Problem:**
- This logic appears in both `createTask` and `patchTask`
- Should be extracted to a helper function
- Logic doesn't exist in handlers.ts (inconsistency)

#### 3. Unsafe Type Casting
**Location:** Throughout file
```typescript
const existing = (b as any).tags || []
(b as any).tags = [...existing, ...toAdd]
```

**Problem:**
- Using `as any` defeats TypeScript safety
- `Board` type should include `tags?: string[]`
- This is a type definition problem

## Recommendations

### 🔥 HIGH PRIORITY

#### 1. Refactor to Shared Business Logic
**Create a localStorage implementation of the Storage interface:**

```typescript
// src/lib/localStorageStorage.ts
export class LocalStorageStorage implements Storage {
  constructor(private userType: string, private userId: string) {}
  
  async getBoards(userType: string, userId?: string): Promise<BoardsFile> {
    // Only localStorage read/write logic
  }
  
  async saveTasks(...): Promise<void> {
    // Only localStorage write logic
  }
  
  // ... etc
}
```

**Then use handlers.ts for ALL business logic:**

```typescript
// src/lib/localStorageApi.ts (NEW approach)
import { LocalStorageStorage } from './localStorageStorage'
import * as TaskHandlers from '../server/handlers'

export function createLocalStorageApi(userType: string, userId: string) {
  const storage = new LocalStorageStorage(userType, userId)
  const auth = { userType, userId }
  
  return {
    async createTask(data, boardId = 'main') {
      return await TaskHandlers.createTask(storage, auth, data, boardId)
    },
    // ... just thin wrappers around handlers
  }
}
```

**Benefits:**
- ✅ Zero duplication
- ✅ Single source of truth for business logic
- ✅ Client and server use identical logic
- ✅ Bugs fixed in one place
- ✅ Easier testing

#### 2. Fix SESSION_ID Circular Import
**Change from:**
```typescript
import { SESSION_ID } from '../hooks/useTasks'
```

**To:**
```typescript
// Pass sessionId as parameter
export function createLocalStorageApi(
  userType: string,
  userId: string,
  sessionId: string
) {
  // use sessionId from parameter
}
```

#### 3. Fix Type Definitions
**In types.ts, update Board interface:**
```typescript
export interface Board {
  id: string
  name: string
  tasks: Task[]
  stats?: StatsFile
  tags: string[]  // Remove optional, always include array
}
```

### 📊 Current vs Proposed Line Count

| Current | Lines | Proposed | Lines | Savings |
|---------|-------|----------|-------|---------|
| handlers.ts | 560 | handlers.ts | 560 | 0 |
| localStorageApi.ts | 360 | localStorageStorage.ts | ~150 | -210 |
| | | localStorageApi.ts (thin) | ~50 | -160 |
| **TOTAL** | **920** | **TOTAL** | **760** | **-160** |

Plus: **Zero duplication** = easier maintenance!

## Code to Remove/Refactor

### REMOVE: Entire stats recording section (lines 76-111)
This logic should come from handlers.ts

### REMOVE: Task state mutation logic
completeTask and deleteTask should just call handlers

### REMOVE: Board/tag validation and mutation
All board/tag operations should use handlers.ts logic

## Migration Strategy

1. **Phase 1:** Create LocalStorageStorage class implementing Storage interface
2. **Phase 2:** Update createLocalStorageApi to use handlers.ts
3. **Phase 3:** Delete duplicated business logic
4. **Phase 4:** Test that client behavior is identical
5. **Phase 5:** Enjoy maintainable codebase! 🎉
