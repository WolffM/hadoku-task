# Architecture Review: App.tsx

## Status: ⚠️ NEEDS REFACTORING - Complex, hacky patterns

## Purpose
Main application component - orchestrates all hooks, state, and UI rendering.

## Analysis

### ✅ Strengths
1. **Good hook usage**: Properly delegates to useTasks, useDragAndDrop, useTaskSort
2. **Custom modals**: Not using native dialogs (good UX)
3. **Context menus**: Long-press support for mobile
4. **Theme system**: Clean implementation with data attributes
5. **Accessibility**: aria-labels and aria-pressed attributes

### 🔴 CRITICAL ISSUES

#### 1. Global Window Hacks 🚨
**Location:** Multiple places throughout

```typescript
// Lines 141-143
const pendingIds = (window as any).__pendingTagTaskIds as string[] | undefined
...
delete (window as any).__pendingTagTaskIds

// Lines 169, 377-378
;(window as any).__pendingBoardTaskIds = ids
delete (window as any).__pendingBoardTaskIds

// Lines 439, 582-583
;(window as any).__pendingTagTaskIds = ids
delete (window as any).__pendingTagTaskIds
```

**Problem:**
- Using global window as state storage
- Type-unsafe casts
- **TERRIBLE practice** - globals should be avoided
- Race conditions possible
- Hard to test
- Not React-like at all

**Why it exists:**
User drags tasks onto "+ Add Board/Tag" button. Dialog opens. After user enters name, tasks should be tagged/moved.

**Better approach:**
```typescript
// Use React state!
const [pendingTaskMove, setPendingTaskMove] = useState<{
  type: 'board' | 'tag'
  taskIds: string[]
} | null>(null)

// On drop:
setPendingTaskMove({ type: 'board', taskIds: ids })
setShowNewBoardDialog(true)

// On confirm:
if (pendingTaskMove && pendingTaskMove.type === 'board') {
  await moveTasksToBoard(boardName, pendingTaskMove.taskIds)
}
setPendingTaskMove(null)

// On cancel:
setPendingTaskMove(null)
```

**Impact:** This is the **worst pattern in the entire codebase**. Must fix.

#### 2. Inconsistent API Creation
**Location:** Lines 62-71

```typescript
// Load user preferences (theme) on mount
useEffect(() => {
  const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
  void api.getPreferences().then(prefs => {
    setTheme(prefs.theme)
  })
}, [userType, userId, sessionId])

// Save theme preference when it changes
useEffect(() => {
  const api = createApi(userType as 'public' | 'friend' | 'admin', userId, sessionId)
  void api.savePreferences({ theme })
}, [theme, userType, userId, sessionId])
```

**Problem:**
- Creates API instance in useEffect (inefficient)
- useTasks already creates API with useMemo
- Two different patterns for same thing

**Better approach:**
```typescript
// useTasks should expose preferences methods
const { getPreferences, savePreferences, ... } = useTasks(...)

// Then:
useEffect(() => {
  void getPreferences().then(prefs => setTheme(prefs.theme))
}, [userType, userId])

useEffect(() => {
  void savePreferences({ theme })
}, [theme])
```

Or even better:
```typescript
// Add theme to useTasks hook entirely
const { theme, setTheme, ... } = useTasks(...)
```

#### 3. Type Casting Abuse
**Pattern throughout:**
```typescript
const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
const persistedTags: string[] = (currentBoard as any)?.tags || []
```

**Locations:**
- Line 192: `(currentBoard as any)?.tags`
- Line 212: `(dragAndDrop as any).selectionJustEndedAt`
- Line 317: `(dragAndDrop as any).setDragOverFilter`
- Line 320: `(dragAndDrop as any).setDragOverFilter`
- Line 338: `(dragAndDrop as any).setDragOverFilter`
- Line 341: `(dragAndDrop as any).setDragOverFilter`
- Many more...

**Problem:**
- Defeats TypeScript safety
- Indicates type definitions are wrong
- Hard to refactor

**Fix:**
- Update Board type to include `tags: string[]` (already in todo #8)
- Export `setDragOverFilter` from useDragAndDrop hook (already exported!)
- Update selectionJustEndedAt usage or remove it

#### 4. Repetitive Theme Button Code
**Location:** Lines 233-282 (50 lines!)

```typescript
<button className={...} onClick={() => { setTheme('light'); ... }}>☀️</button>
<button className={...} onClick={() => { setTheme('dark'); ... }}>🌙</button>
<button className={...} onClick={() => { setTheme('strawberry'); ... }}>🍓</button>
// ... 7 buttons total
```

**Problem:**
- Extremely repetitive
- Hard to add new themes
- 50 lines for what should be 5

**Better approach:**
```typescript
const THEMES: Array<{ name: ThemeName, emoji: string, label: string }> = [
  { name: 'light', emoji: '☀️', label: 'Light theme' },
  { name: 'dark', emoji: '🌙', label: 'Dark theme' },
  { name: 'strawberry', emoji: '🍓', label: 'Strawberry theme' },
  { name: 'ocean', emoji: '🌊', label: 'Ocean theme' },
  { name: 'cyberpunk', emoji: '🤖', label: 'Cyberpunk theme' },
  { name: 'coffee', emoji: '☕', label: 'Coffee theme' },
  { name: 'lavender', emoji: '🪻', label: 'Lavender theme' },
]

// Then:
{THEMES.map(({ name, emoji, label }) => (
  <button
    key={name}
    className={`theme-picker__option ${theme === name ? 'active' : ''}`}
    onClick={() => { setTheme(name); setShowThemePicker(false); }}
    title={label}
  >
    {emoji}
  </button>
))}
```

**Saves:** 40 lines

#### 5. Long-Press Timer Pattern Duplication
**Pattern appears 4+ times:**

```typescript
onTouchStart={(e) => {
  const timer = setTimeout(() => {
    const touch = e.touches[0]
    setContextMenu({ ..., x: touch.clientX, y: touch.clientY })
  }, 500)
  ;(e.currentTarget as any).__longPressTimer = timer
}}
onTouchEnd={(e) => {
  const timer = (e.currentTarget as any).__longPressTimer
  if (timer) {
    clearTimeout(timer)
    ;(e.currentTarget as any).__longPressTimer = null
  }
}}
onTouchMove={(e) => {
  const timer = (e.currentTarget as any).__longPressTimer
  if (timer) {
    clearTimeout(timer)
    ;(e.currentTarget as any).__longPressTimer = null
  }
}}
```

**Locations:**
- Board buttons (lines 305-328)
- Filter tags (lines 414-437)

**Problem:**
- Duplicated 15+ lines each time
- Storing timer on DOM element (hacky)
- Type-unsafe

**Better approach:**
```typescript
// Custom hook
function useLongPress(onLongPress: (e: React.TouchEvent) => void, delay = 500) {
  const timerRef = useRef<number | null>(null)
  
  const start = (e: React.TouchEvent) => {
    timerRef.current = window.setTimeout(() => {
      onLongPress(e)
    }, delay)
  }
  
  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  
  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
  }
}

// Then:
const boardLongPress = useLongPress((e) => {
  const touch = e.touches[0]
  setBoardContextMenu({ boardId: b.id, x: touch.clientX, y: touch.clientY })
})

<button {...boardLongPress}>Board</button>
```

### ⚠️ MEDIUM ISSUES

#### 6. Unused Variables
**Location:** Lines 17-18
```typescript
const [customTags, setCustomTags] = useState<string[]>([])
```

**Analysis:**
- `customTags` is used in line 398: `[...persistedTags, ...derived, ...customTags]`
- `setCustomTags` is **never called**
- Custom tags can't actually be added
- Dead feature

**Recommendation:**
- Remove `customTags` state entirely
- Use only `persistedTags` and `derived`

#### 7. Unused Props
**Location:** Line 15
```typescript
const { basename = '/task', apiUrl, environment, userType = 'public', userId = 'public', sessionId } = props;
```

**Analysis:**
- `basename` - never used
- `apiUrl` - never used
- `environment` - never used
- `isPublic` computed but never used

**Recommendation:**
- Remove unused props from destructuring
- If needed for routing, keep `basename`
- Otherwise delete

#### 8. Confirm/Alert Still Used
**Location:** Lines 647, 678

```typescript
if (confirm(`Delete board "${boardName}"?...`)) {
  // ...
}

if (confirm(`Delete tag "${tagContextMenu.tag}"...`)) {
  // ...
}
```

**Problem:**
- Native dialogs (bad UX)
- Inconsistent with Modal usage elsewhere
- Can be blocked by browser

**Fix:**
- Create `<ConfirmModal>` component
- Use same pattern as `confirmClearTag`

### 🟢 MINOR ISSUES

#### 9. Magic Number: 5 Boards Limit
**Location:** Lines 285, 362

```typescript
{(boards && boards.boards ? boards.boards.slice(0, 5) : ...)}

{(!boards || (boards.boards && boards.boards.length < 5)) && (...)}
```

**Issue:**
- Hard-coded 5
- No explanation why
- Appears in multiple places

**Fix:**
```typescript
const MAX_BOARDS = 5  // UI layout constraint

{boards?.boards.slice(0, MAX_BOARDS).map(...)}
{boards.boards.length < MAX_BOARDS && ...}
```

#### 10. Repetitive Selection Clear
**Pattern:**
```typescript
try { dragAndDrop.clearSelection() } catch {}
```

**Appears 5+ times** throughout drop handlers.

**Better:**
- clearSelection shouldn't throw
- Remove try-catch
- Or create helper: `safeClearSelection()`

## Recommendations

### 🔥 CRITICAL (Do First)

#### 1. Replace Window Globals with React State
**Effort:** 1 hour  
**Impact:** Removes worst anti-pattern in codebase

```typescript
const [pendingTaskOperation, setPendingTaskOperation] = useState<{
  type: 'move-to-board' | 'apply-tag'
  taskIds: string[]
} | null>(null)
```

#### 2. Fix Type Definitions
**Effort:** 30 minutes  
**Impact:** Remove all `as any` casts

Update Board type, export dragOverFilter setter.

#### 3. Extract Theme Buttons to Map
**Effort:** 20 minutes  
**Impact:** -40 lines, easier to add themes

```typescript
const THEMES = [...]
{THEMES.map(theme => <button .../>)}
```

### 🟡 MEDIUM PRIORITY

#### 4. Extract Long-Press Hook
**Effort:** 30 minutes  
**Impact:** Remove duplication

```typescript
function useLongPress(callback, delay) {...}
```

#### 5. Move Theme to useTasks
**Effort:** 1 hour  
**Impact:** Consistency, less API creation

Theme is user preference, should live with other user state.

#### 6. Replace confirm() with Modal
**Effort:** 1 hour  
**Impact:** Better UX, consistency

Use same Modal pattern for board/tag deletion.

### 🟢 LOW PRIORITY

#### 7. Remove Unused State/Props
**Effort:** 10 minutes

Delete `customTags`, `basename`, `apiUrl`, `environment`.

#### 8. Extract MAX_BOARDS Constant
**Effort:** 2 minutes

## Code to Refactor

### 1. Replace Window Globals
```typescript
// Add state
const [pendingTaskOperation, setPendingTaskOperation] = useState<{
  type: 'move-to-board' | 'apply-tag'
  taskIds: string[]
} | null>(null)

// On drop to "+ Add Board":
setPendingTaskOperation({ type: 'move-to-board', taskIds: ids })
setShowNewBoardDialog(true)

// On drop to "+ Add Tag":
setPendingTaskOperation({ type: 'apply-tag', taskIds: ids })
setShowNewTagDialog(true)

// In handleCreateBoard:
if (pendingTaskOperation?.type === 'move-to-board') {
  await moveTasksToBoard(name, pendingTaskOperation.taskIds)
  dragAndDrop.clearSelection()
}
setPendingTaskOperation(null)

// In handleCreateTag:
if (pendingTaskOperation?.type === 'apply-tag') {
  const updates = pendingTaskOperation.taskIds.map(...)
  await bulkUpdateTaskTags(updates)
  dragAndDrop.clearSelection()
}
setPendingTaskOperation(null)

// On modal close:
setPendingTaskOperation(null)
```

### 2. Theme Buttons Map
```typescript
const THEMES: Array<{ name: ThemeName, emoji: string, label: string }> = [
  { name: 'light', emoji: '☀️', label: 'Light theme' },
  { name: 'dark', emoji: '🌙', label: 'Dark theme' },
  { name: 'strawberry', emoji: '🍓', label: 'Strawberry theme' },
  { name: 'ocean', emoji: '🌊', label: 'Ocean theme' },
  { name: 'cyberpunk', emoji: '🤖', label: 'Cyberpunk theme' },
  { name: 'coffee', emoji: '☕', label: 'Coffee theme' },
  { name: 'lavender', emoji: '🪻', label: 'Lavender theme' },
]

const getThemeEmoji = (theme: ThemeName) => 
  THEMES.find(t => t.name === theme)?.emoji || '🌙'

// Header button:
<button ...>{getThemeEmoji(theme)}</button>

// Dropdown:
{showThemePicker && (
  <div className="theme-picker__dropdown">
    {THEMES.map(({ name, emoji, label }) => (
      <button
        key={name}
        className={`theme-picker__option ${theme === name ? 'active' : ''}`}
        onClick={() => { setTheme(name); setShowThemePicker(false); }}
        title={label}
      >
        {emoji}
      </button>
    ))}
  </div>
)}
```

### 3. Long-Press Hook
```typescript
function useLongPress(
  onLongPress: (x: number, y: number) => void,
  delay = 500
) {
  const timerRef = useRef<number | null>(null)
  
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0]
      timerRef.current = window.setTimeout(() => {
        onLongPress(touch.clientX, touch.clientY)
      }, delay)
    },
    onTouchEnd: () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    onTouchMove: () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }
}

// Usage:
const boardLongPress = useLongPress((x, y) => {
  if (b.id === 'main') return
  setBoardContextMenu({ boardId: b.id, x, y })
})

<button {...boardLongPress}>Board</button>
```

## Overall Assessment

**Current state:** Functional but has serious anti-patterns

**Worst issues:**
1. 🚨 Window globals hack (fix immediately!)
2. 🟡 Type casting abuse (fix type defs)
3. 🟡 Repetitive code (theme buttons, long-press)

**After refactoring:**
- ✅ No global hacks
- ✅ Type-safe throughout
- ✅ ~100 fewer lines
- ✅ Much more maintainable

**Estimated cleanup time:** 4-5 hours

**Priority:** HIGH - Contains worst anti-pattern in codebase

---

## File Comparison

| File | Lines | Issues | Priority | Quality |
|------|-------|--------|----------|---------|
| handlers.ts | 560 | Dead code | Medium | ✅ Good |
| localStorageApi.ts | 360 | Duplication | CRITICAL | 🔴 Poor |
| api.ts | 246 | Unused methods | Low | ✅ Good |
| useTasks.ts | 445 | Inconsistency | Medium | ⚠️ Fair |
| useDragAndDrop.ts | 350 | 1 minor bug | Low | ✅ Excellent |
| **App.tsx** | **683** | **Window hacks** | **HIGH** | **🔴 Poor** |

App.tsx is the **2nd worst file** after localStorageApi.ts.
