# Architecture Review: useDragAndDrop.ts

## Status: ✅ CLEAN - Well-designed, minimal issues

## Purpose
Manages drag-and-drop functionality for tasks (single and multi-select) with marquee selection.

## Analysis

### ✅ Strengths
1. **Excellent UX**: Custom drag image aligned to cursor position
2. **Multi-select**: Marquee selection + Shift+click patterns
3. **Clean separation**: Pure UI logic, delegates updates to useTasks
4. **Good error handling**: Try-catch around DOM operations
5. **Global listeners**: Marquee works across entire viewport
6. **Smart filtering**: Prevents starting marquee on interactive elements
7. **Source tag tracking**: Remembers where drag started for smart tag removal

This is **well-engineered code**. Whoever wrote this knows their stuff! 🎉

### ⚠️ MINOR ISSUES (Nitpicks)

#### 1. Unused State Variable
**Location:** Line 21
```typescript
const [selectionJustEndedAt, setSelectionJustEndedAt] = useState<number | null>(null)
```

**Analysis:**
- Set in `selectionEndHandler()` (line 174)
- Returned from hook (line 355)
- **But never actually used anywhere**

**Recommendation:** 
- Check if this was intended for debouncing click vs drag
- If not used, remove it
- If needed later, keep but add comment explaining future use

#### 2. Empty Catch Blocks
**Pattern throughout file:**
```typescript
try {
  // operation
} catch {}  // ← Silent failure
```

**Locations:**
- Line 31 (setData for custom format)
- Line 96 (drag image setup)
- Line 109 (clone removal)
- Line 244 (getData for source tag)
- Line 285 (clear selection)
- Line 323 (clear selection)
- Many more...

**Analysis:**
- Most are intentional: trying non-standard features that might not work
- Silent failure is usually acceptable for graceful degradation
- **BUT**: Makes debugging harder when something actually fails

**Recommendation:**
```typescript
try {
  e.dataTransfer.setData('application/x-hadoku-task-ids', JSON.stringify(idsToDrag))
} catch (err) {
  // Expected: Some browsers don't support custom MIME types
  console.debug('[useDragAndDrop] Custom drag data not supported:', err)
}
```

Or create a helper:
```typescript
function trySetDragData(transfer: DataTransfer, type: string, data: string) {
  try {
    transfer.setData(type, data)
  } catch (err) {
    console.debug(`[useDragAndDrop] Could not set ${type}:`, err)
  }
}
```

#### 3. Synthetic Event Type Casting
**Location:** Lines 186-200
```typescript
function onDocMouseDown(e: MouseEvent) {
  const fake = { 
    target: e.target, 
    clientX: e.clientX, 
    clientY: e.clientY, 
    button: e.button 
  } as unknown as React.MouseEvent
  try { selectionStartHandler(fake) } catch {}
}
```

**Problem:**
- Creates fake React events from native events
- Type assertion lies to TypeScript
- Could break if React event properties are accessed

**Better approach:**
```typescript
// Extract the actual logic into helpers that accept native events
function handleSelectionStart(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  button: number
) {
  if (button !== 0) return
  // ... actual logic
}

// Then both handlers call the same logic
function selectionStartHandler(e: React.MouseEvent) {
  handleSelectionStart(e.target, e.clientX, e.clientY, e.button)
}

function onDocMouseDown(e: MouseEvent) {
  handleSelectionStart(e.target, e.clientX, e.clientY, e.button)
}
```

**But**: Current approach works fine, this is just a cleaner pattern.

#### 4. Magic Selector String
**Location:** Line 124
```typescript
const interactiveSelector = '.task-app__item, .task-app__controls, button, input, textarea, .task-app__item-actions'
```

**Issue:**
- Hard-coded CSS selectors
- If class names change, marquee breaks
- Hard to test/maintain

**Better approach:**
```typescript
// At top of file
const INTERACTIVE_SELECTORS = [
  '.task-app__item',
  '.task-app__controls',
  '.task-app__item-actions',
  'button',
  'input',
  'textarea',
  'select',
  'a'
].join(', ')

// Then:
if (tg.closest && tg.closest(INTERACTIVE_SELECTORS)) {
  return
}
```

#### 5. onFilterDrop Doesn't Support Multi-Select
**Location:** Lines 306-334

**Analysis:**
```typescript
async function onFilterDrop(e: React.DragEvent, filterTag: string) {
  const taskId = e.dataTransfer.getData('text/plain')  // ← Only gets first ID
  const task = tasks.find(t => t.id === taskId)
  // ... updates single task
}
```

**Inconsistency:**
- `onDrop()` handles multi-task drops
- `onFilterDrop()` only handles single task
- User can multi-select but filter drop only tags one task

**Fix:**
```typescript
async function onFilterDrop(e: React.DragEvent, filterTag: string) {
  e.preventDefault()
  setDragOverFilter(null)
  
  // Support multi-task drops (same as onDrop)
  let ids: string[] = []
  try {
    const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
    if (raw) ids = JSON.parse(raw)
  } catch {}
  
  if (ids.length === 0) {
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) ids = [taskId]
  }
  
  if (ids.length === 0) return
  
  // Build updates for all tasks
  const updates: Array<{ taskId: string, tag: string }> = []
  for (const id of ids) {
    const task = tasks.find(t => t.id === id)
    if (!task) continue
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(filterTag)) continue // Skip if already has tag
    
    const updatedTags = [...existingTags, filterTag].join(' ')
    updates.push({ taskId: id, tag: updatedTags })
  }
  
  if (updates.length === 0) return
  
  try {
    await onBulkUpdate(updates)  // Use bulk update
    clearSelection()
  } catch (error) {
    console.error('Failed to add tag via filter drop:', error)
    alert((error as Error).message || 'Failed to add tag')
  }
}
```

### 🟢 POTENTIAL ENHANCEMENTS (Not Issues)

#### 1. Touch Support
Current implementation uses mouse events only. For mobile/tablet:
- `touchstart` → drag start
- `touchmove` → marquee
- `touchend` → drop

**But**: Probably out of scope for now.

#### 2. Keyboard Shortcuts
Could add:
- `Ctrl+A` → Select all tasks
- `Escape` → Clear selection
- `Delete` → Delete selected tasks

**But**: Might be better in App.tsx.

#### 3. Visual Feedback
Current code has CSS class hooks:
- `.dragging` on drag source
- `.selected` on selected items
- `.marquee-selecting` on body

**Great!** CSS can style these appropriately.

## Recommendations

### 🟡 MEDIUM PRIORITY

#### 1. Fix onFilterDrop Multi-Select Bug
**Effort:** 20 minutes  
**Impact:** Consistency, better UX

Users can multi-select tasks but filter drop only tags one. Should support bulk updates like onDrop does.

#### 2. Remove or Document selectionJustEndedAt
**Effort:** 2 minutes  
**Impact:** Code clarity

Either use it or remove it.

### 🟢 LOW PRIORITY

#### 3. Add Debug Logging to Empty Catches
**Effort:** 15 minutes  
**Impact:** Easier debugging

```typescript
} catch (err) {
  console.debug('[useDragAndDrop] Expected failure:', err)
}
```

#### 4. Extract Interactive Selectors Constant
**Effort:** 5 minutes  
**Impact:** Maintainability

```typescript
const INTERACTIVE_SELECTORS = [
  '.task-app__item',
  // ...
].join(', ')
```

#### 5. Refactor Synthetic Event Creation
**Effort:** 30 minutes  
**Impact:** Type safety

Extract logic into helpers that accept primitive values instead of event objects.

## Code to Change

### 1. Fix onFilterDrop Multi-Select
```typescript
async function onFilterDrop(e: React.DragEvent, filterTag: string) {
  e.preventDefault()
  setDragOverFilter(null)
  
  // Support multi-task drops
  let ids: string[] = []
  try {
    const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
    if (raw) ids = JSON.parse(raw)
  } catch {}
  
  if (ids.length === 0) {
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) ids = [taskId]
  }
  
  if (ids.length === 0) return
  
  const updates: Array<{ taskId: string, tag: string }> = []
  for (const id of ids) {
    const task = tasks.find(t => t.id === id)
    if (!task) continue
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(filterTag)) continue
    
    const updatedTags = [...existingTags, filterTag].join(' ')
    updates.push({ taskId: id, tag: updatedTags })
  }
  
  if (updates.length === 0) return
  
  try {
    await onBulkUpdate(updates)
    clearSelection()
  } catch (error) {
    console.error('Failed to add tag via filter drop:', error)
    alert((error as Error).message || 'Failed to add tag')
  }
}
```

### 2. Remove or Document Unused State
```typescript
// Option A: Remove
- const [selectionJustEndedAt, setSelectionJustEndedAt] = useState<number | null>(null)
- try { setSelectionJustEndedAt(Date.now()) } catch {}
- selectionJustEndedAt,

// Option B: Document future use
const [selectionJustEndedAt, setSelectionJustEndedAt] = useState<number | null>(null)
// TODO: Use this to distinguish click vs drag-select for context menu
// (e.g., show context menu only if time since selection ended > 100ms)
```

## Overall Assessment

**This file is excellent!** 🌟

- ✅ Well-architected
- ✅ Good UX patterns
- ✅ Clean separation of concerns
- ✅ Handles edge cases
- ✅ Graceful degradation

**Only real bug:** onFilterDrop doesn't support multi-select (20 min fix)

**Everything else:** Nitpicks and optional enhancements

**Estimated cleanup time:** 1 hour (including multi-select fix)

**Priority:** LOW - This file works great as-is

---

## Comparison with Other Files

| File | Status | Issues | Priority |
|------|--------|--------|----------|
| handlers.ts | ✅ Clean | Dead code | Medium |
| localStorageApi.ts | 🔴 Critical | 200 lines duplication | HIGH |
| api.ts | ✅ Clean | 2 unused methods | Low |
| useTasks.ts | ⚠️ Needs work | Duplication, inconsistency | Medium |
| **useDragAndDrop.ts** | **✅ Excellent** | **1 minor bug** | **Low** |

This is the **best-written file** in the codebase! Use it as a reference for quality. 👏
