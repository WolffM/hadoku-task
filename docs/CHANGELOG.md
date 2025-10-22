# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.39] - 2025-10-22

### 🔧 Refactor - Remove userId, Use sessionId for localStorage Keys

#### **Problem: userId Was Fragile and Redundant**
- **Issue:** Parent app owns `userId` and can change it, breaking localStorage keys
- **Issue:** Three identifiers (`userType`, `userId`, `sessionId`) when two suffice
- **Issue:** `userId` provided no real value over `sessionId`

**Old Architecture (Problematic):**
```typescript
// localStorage keys break when userId changes
"admin-john-doe-main-tasks"      // ❌ Breaks if user changes name
"friend-jane-smith-work-tasks"   // ❌ Parent can change userId anytime

// API client had redundant parameter
createApi(userType, userId, sessionId)  // ❌ userId was redundant
```

#### **Solution: Use sessionId for localStorage Keys**

**New Architecture (Stable):**
```typescript
// localStorage keys are stable across userId changes
"admin-abc-123-xyz-main-tasks"      // ✅ Stable session identifier
"friend-def-456-uvw-work-tasks"     // ✅ Parent controls session lifecycle

// API client simplified
createApi(userType, sessionId)      // ✅ One identifier, clearer intent
```

### 🗑️ Breaking Changes

#### **Removed userId Parameter**
```typescript
// ❌ OLD - userId parameter removed
interface TaskAppProps {
  userType?: string
  userId?: string
  sessionId?: string
}

// ✅ NEW - Only sessionId needed
interface TaskAppProps {
  userType?: string
  sessionId?: string
}
```

#### **Updated API Signatures**
```typescript
// ❌ OLD
createApi(userType, userId, sessionId)
createLocalStorageApi(userType, userId)
usePreferences(userType, userId, sessionId)
useTasks({ userType, userId, sessionId })

// ✅ NEW
createApi(userType, sessionId)
createLocalStorageApi(userType, sessionId)
usePreferences(userType, sessionId)
useTasks({ userType, sessionId })
```

#### **Updated localStorage Key Pattern**
```typescript
// ❌ OLD - Keys used userId
"${userType}-${userId}-${boardId}-tasks"
"admin-john-doe-main-tasks"

// ✅ NEW - Keys use sessionId
"${userType}-${sessionId}-${boardId}-tasks"
"admin-abc-123-xyz-main-tasks"
```

### 📦 Files Modified (22 files)

**Core Storage Layer:**
- `src/api/storage/LocalStorageStorage.ts` - Use sessionId in localStorage keys
- `src/server/storage.ts` - Update Storage interface
- `src/domain/types.ts` - Update AuthContext interface

**API Layer:**
- `src/api/localStorageApi.ts` - Remove userId, use sessionId
- `src/api/client.ts` - Remove userId from headers and keys

**Domain Layer:**
- `src/domain/handlers/handlers-utils.ts` - Use auth.sessionId
- `src/domain/handlers/handlers.ts` - Use auth.sessionId

**React Components:**
- `src/app/App.tsx` - Remove userId parameter
- `src/app/entry.tsx` - Remove userId from TaskAppProps

**Hooks:**
- `src/hooks/usePreferences.ts` - Use sessionId parameter
- `src/hooks/useTasks/index.ts` - Use sessionId parameter
- `src/hooks/useTasks/helpers.ts` - Use sessionId in broadcasts

**Utilities:**
- `src/utils/preferences.ts` - Update cleanupOrphanedKeys to use sessionId

### ✅ Benefits

1. **Stable localStorage keys** - Keys won't break when parent changes userId
2. **Simpler architecture** - Two identifiers instead of three
3. **Clearer intent** - `userType` (behavior) + `sessionId` (identity)
4. **Parent controls lifecycle** - Parent decides when to invalidate session
5. **Less confusion** - One less parameter to pass around
6. **More robust** - No risk of data loss from userId changes

### 🔄 Migration Impact

**For Parent App:**
- ✅ **Action Required:** Stop passing `userId` prop to task app
- ✅ **Action Required:** Ensure `sessionId` is stable and unique per session
- ⚠️ **Data Impact:** Existing localStorage data will not be accessible (uses old keys)

**For Users:**
- ⚠️ **One-time data loss:** Existing tasks/boards will not appear (different localStorage keys)
- ✅ **Benefit:** Data will be stable going forward (no more userId changes breaking keys)

**Migration Strategy:**
- No automated migration provided - clean slate approach
- Parent app can implement migration if needed by reading old keys and writing to new pattern

### 📊 Build Output
```
dist/style.css   43.07 kB │ gzip:  7.07 kB  
dist/index.js   108.26 kB │ gzip: 24.69 kB (+0.05 kB)
```

---

## [3.0.38] - 2025-10-22

### 🧹 Refactor - Dead Code Cleanup

#### **Removed Unused Code & Type Definitions**
- **Goal:** Clean up codebase by removing unused exports, functions, and type definitions
- **Impact:** Smaller bundle size, cleaner codebase, easier maintenance
- **Method:** Comprehensive search for unreferenced code across all TypeScript/JavaScript files

### 🗑️ Removed Dead Code

#### **1. Unused Type Definitions (`src/domain/types.ts`)**
Removed 4 server-infrastructure types that were never used:

```typescript
// ❌ REMOVED - Never used in codebase
export interface RouterConfig {
  dataPath: string
  githubConfig?: GitHubConfig
}

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface SyncQueueItem {
  userType: string
  dataType: 'tasks' | 'stats'
  timestamp: number
}

export type DataType = 'tasks' | 'stats'
```

**Analysis:**
- `RouterConfig` & `GitHubConfig`: Leftover from planned server features, never implemented
- `SyncQueueItem`: Unused queue system, not referenced anywhere
- `DataType`: Unused type alias, no references found

#### **2. Unused Utility Function (`src/domain/utils/tags.ts`)**
Removed exclusive tag filtering function that was never called:

```typescript
// ❌ REMOVED - Never called anywhere
export function getTasksByTagExclusive(tasks: Task[], tag: string, topTags: string[]): Task[] {
  return tasks.filter(t => {
    const taskTags = t.tag?.split(' ') || []
    if (!taskTags.includes(tag)) return false
    
    // Only show in the first matching top tag column
    const firstMatchingTag = topTags.find(topTag => taskTags.includes(topTag))
    return firstMatchingTag === tag
  })
}
```

**Analysis:**
- Created for exclusive tag filtering feature that was later simplified
- `getTasksByTag()` is used instead (6 references)
- No imports or calls to this function found

### ✅ Verified Active Code

**Comprehensive search verified all other code is actively used:**

#### **Handler Utilities (10/10 used)**
- ✅ `findTaskOrThrow` - Used 4× in handlers.ts
- ✅ `findBoardOrThrow` - Used 4× in handlers.ts
- ✅ `updateBoardAtIndex` - Used 4× in handlers.ts
- ✅ `recordStatsEvent` - Used 8× in handlers.ts
- ✅ `extractTasksFromBoard` - Used in batchMoveTasks
- ✅ `prepareTasksForBoard` - Used in batchMoveTasks
- ✅ `updateBatchMoveStats` - Used in batchMoveTasks
- ✅ `closeTask` - Used in completeTask & deleteTask
- ✅ `withTaskOperation` - Used 5× in handlers.ts
- ✅ `withBoardOperation` - Used 4× in handlers.ts

#### **Utility Functions (8/8 used)**
- ✅ `validateBoardName` - Used in App.tsx, CreateBoardModal
- ✅ `validateAndChangeKey` - Used in SettingsModal
- ✅ `getTaskIdsFromDragEvent` - Used 3× in drag/drop components
- ✅ `getRandomPlaceholder` - Used in App.tsx
- ✅ `formatAge` - Used in TaskItem
- ✅ `getLayoutConfig` - Used 2× in TaskLayout
- ✅ `cleanupOrphanedKeys` - Used in usePreferences hook
- ✅ `migrateFromSessionStorage` - Used in usePreferences hook

#### **Tag Utilities (5/5 used)**
- ✅ `parseTaskInput` - Used in useTasks hook
- ✅ `getTopTags` - Used in App.tsx
- ✅ `getTasksByTag` - Used 3× in TaskLayout
- ✅ `getRemainingTasks` - Used in TaskLayout
- ✅ `getAllTags` - Used in App.tsx

#### **Internal Helpers (2/2 used)**
- ✅ `deferredBroadcast` - Used 15× in localStorageApi.ts
- ✅ `extractBoardTasks` - Used 6× in useTasks hook

### 📊 Cleanup Results

**Files Modified:**
- `src/domain/types.ts` - Removed 4 unused type definitions (19 lines)
- `src/domain/utils/tags.ts` - Removed 1 unused function (14 lines)

**Total Lines Removed:** 33 lines of dead code

**Bundle Impact:**
- Cleaner type exports
- Reduced unused utility code
- No impact on functionality (code was never called)

### 🎯 Benefits

- ✅ **Cleaner codebase** - No unused exports cluttering the API surface
- ✅ **Easier maintenance** - Less code to understand and maintain
- ✅ **Better IntelliSense** - Fewer unused options in autocomplete
- ✅ **Verified active code** - Comprehensive search confirms all remaining code is used
- ✅ **No regressions** - Zero functionality impact (removed code was never executed)

### 🔍 Analysis Method

**Comprehensive Dead Code Detection:**
1. ✅ Searched for all export statements across TypeScript files
2. ✅ Verified usage of each exported function/interface
3. ✅ Checked for imports and references in all files
4. ✅ Validated with TypeScript compiler (no new errors)
5. ✅ Confirmed all remaining code has active references

**Tools Used:**
- `grep_search` - Pattern matching across codebase
- `list_code_usages` - Symbol reference checking
- TypeScript compiler validation

### 📦 Build Output
```
No change to bundle sizes (removed code was never imported/bundled)
```

---

## [3.0.37] - 2025-10-21

### 🐛 Fixed - Checkbox Visibility Across Themes

#### **Fixed Black Checkboxes on Light Theme**
- **Issue:** Checkboxes in settings modal were black (browser default), making them invisible or hard to see
- **Impact:** Poor visibility on light themes, inconsistent appearance across themes
- **User Report:** Screenshot showed black checkboxes on light background in settings modal

**Problem:**
```css
/* ❌ Before - No color styling, browser default (black) */
.settings-option input[type="checkbox"] {
  margin-top: 2px;
  cursor: pointer;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
```

#### **Solution: Theme-Aware Checkbox Colors**

```css
/* ✅ After - Uses theme's primary color */
.settings-option input[type="checkbox"] {
  margin-top: 2px;
  cursor: pointer;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--color-primary);  /* 🎨 Theme-aware color */
  appearance: auto;
  -webkit-appearance: checkbox;
  -moz-appearance: checkbox;
}
```

### 🎨 Cross-Theme Validation

**Checkboxes now match theme primary colors:**

| Theme | Primary Color | Checkbox Color | Visibility |
|-------|--------------|----------------|------------|
| **Pink Light** | #e91e63 | Pink | ✅ Visible |
| **Pink Dark** | #f48fb1 | Light Pink | ✅ Visible |
| **Green Light** | #4caf50 | Green | ✅ Visible |
| **Green Dark** | #81c784 | Light Green | ✅ Visible |
| **Blue Light** | #2196f3 | Blue | ✅ Visible |
| **Blue Dark** | #64b5f6 | Light Blue | ✅ Visible |
| **Gray Light** | #9e9e9e | Gray | ✅ Visible |
| **Gray Dark** | #bdbdbd | Light Gray | ✅ Visible |

### 🌐 Browser Support

**Modern Browsers (accent-color support):**
- ✅ Chrome 93+ (September 2021)
- ✅ Firefox 92+ (September 2021)
- ✅ Safari 15.4+ (March 2022)
- ✅ Edge 93+ (September 2021)

**Fallback for Older Browsers:**
- ✅ Native checkbox appearance preserved
- ✅ Maintains functionality
- ✅ Uses system default colors

### ✨ Benefits

- ✅ **Consistent theming** - Checkboxes match app's color scheme
- ✅ **Clear visibility** - Works on all light/dark theme variants
- ✅ **Native feel** - Uses browser's native checkbox appearance
- ✅ **Accessible** - Maintains all native checkbox functionality
- ✅ **No custom styling needed** - Leverages modern CSS standard

### 📦 Build Output
```
CSS: 43.15 kB (+0.11 kB) │ gzip: 7.09 kB
```

---

## [3.0.36] - 2025-10-21

### ✨ Added - Loading Skeleton & Smooth Animations

#### **Modern Loading Experience with Shimmer Effect**
- **Feature:** Professional loading skeleton with shimmer animation
- **User Experience:** Smooth fade-in transition when content loads
- **Visual Polish:** No more jarring pop-in, just elegant transitions

**Implementation:**
```tsx
// Loading skeleton shown while preferences load
if (!preferencesLoaded) {
  return (
    <div className="task-app-loading">
      <div className="task-app-loading__skeleton">
        <div className="skeleton-header"></div>      // Header placeholder
        <div className="skeleton-boards">...</div>   // Board tabs
        <div className="skeleton-input"></div>       // Input field
        <div className="skeleton-filters">...</div>  // Tag filters
        <div className="skeleton-tasks">...</div>    // Task items
      </div>
    </div>
  )
}

// Smooth fade-in when content ready
<div className="task-app-container task-app-fade-in">
```

#### **Shimmer Animation**
```css
@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

/* Gradient effect for shimmer */
background: linear-gradient(
  90deg,
  var(--color-bg-alt) 0%,
  var(--color-neutral-light) 50%,
  var(--color-bg-alt) 100%
);
animation: shimmer 2s infinite;
```

#### **Fade-In Transition**
```css
.task-app-fade-in {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

### 🎨 Loading Skeleton Components

**Layout Structure:**
- **Header Block:** 3rem × 200px - "Tasks - user" placeholder
- **Board Buttons:** 3 tabs, 2.5rem × 100px each
- **Input Field:** Full-width, 2.5rem height
- **Filter Pills:** 3 pills, 2rem × 80px each
- **Task Items:** 3 rows, 3rem × full-width

**Design Features:**
- ✅ **Theme-aware:** Uses theme colors for dark/light modes
- ✅ **Layout-matching:** Mirrors actual UI structure
- ✅ **Smooth shimmer:** Professional sliding gradient effect
- ✅ **Responsive:** Adapts to mobile/desktop layouts
- ✅ **Seamless transition:** Skeleton → content fade is smooth

### 🎯 User Experience Timeline

```
1. Page loads → Loading skeleton appears immediately ✨
2. Shimmer animation starts (2s loop) 
3. Preferences load from localStorage (~10-50ms)
4. Content fades in smoothly (300ms fade) ✨
5. No jarring transitions - just smooth loading! 🎉
```

**Before:**
```
Page load → White screen → Sudden content pop-in ❌
```

**After:**
```
Page load → Skeleton shimmer → Smooth fade to content ✅
```

### 📦 Build Output
```
CSS: 43.04 kB (+1.06 kB) │ gzip:  7.06 kB
JS:  106.82 kB (+1.17 kB) │ gzip: 23.64 kB
```

---

## [3.0.35] - 2025-10-21

### 🐛 Fixed - Theme Flash on Page Load

#### **Eliminated White Flash Before Theme Loads**
- **Issue:** Unpleasant flash of light theme before correct theme (e.g., pink-dark) was applied
- **User Experience:** Users briefly saw light theme on every page load, even with dark theme selected
- **Root Cause:** Component rendered immediately with default theme while preferences loaded asynchronously

**Problem Timeline:**
```typescript
1. Component renders with default theme: 'light' ⚡ (visible flash!)
2. API call starts (async)
3. User sees light theme for ~50-100ms
4. Preferences load: theme: 'pink-dark'
5. Component re-renders with correct theme
```

#### **Solution: Wait for Preferences Before Rendering**

**Implementation:**
```typescript
// Added loading state to prevent premature render
const [preferencesLoaded, setPreferencesLoaded] = useState(false)

// Mark as loaded after preferences are fetched
useEffect(() => {
  const loadPreferences = async () => {
    const prefs = await api.getPreferences()
    if (prefs) setPreferences(prefs)
    setPreferencesLoaded(true)  // ✅ Ready to render
  }
  void loadPreferences()
}, [userType, userId, sessionId])

// Don't render until preferences are loaded
if (!preferencesLoaded) {
  return null  // Prevents theme flash
}
```

**Benefits:**
- ✅ **No theme flash** - component waits for correct theme before rendering
- ✅ **Fast loading** - preferences load from localStorage (nearly instant)
- ✅ **Smooth UX** - user sees correct theme immediately on first render
- ✅ **Works with all themes** - light, dark, pink, green, etc.

### 📦 Build Output
```
dist/style.css   41.98 kB │ gzip:  6.79 kB
dist/index.js   105.65 kB │ gzip: 23.53 kB
```

---

## Version History

For versions prior to 3.0.35, please refer to git commit history.

---

**Package:** `@wolffm/task`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
