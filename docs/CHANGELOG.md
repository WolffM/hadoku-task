# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.41] - 2025-10-22

### ⚙️ DevOps - Smart Version Management System

#### **Added Automatic Minor Version Rollover**
- **Feature:** Husky pre-commit hook now uses smart versioning
- **Logic:** When patch version reaches `.20`, automatically rolls over to next minor version `.0`
- **Example:** `3.1.20` → `3.2.0` (instead of `3.1.21`)

#### **Implementation**
```javascript
// scripts/version-manager.js
if (patch === 20) {
  newVersion = `${major}.${minor + 1}.0`  // Roll over
} else {
  newVersion = `${major}.${minor}.${patch + 1}`  // Regular increment
}
```

#### **Benefits**
1. **Prevents excessive patch numbers** - No more versions like `3.1.47`
2. **Cleaner version progression** - Logical minor version increments
3. **Automated management** - No manual intervention needed
4. **Consistent releases** - Every 20 patches becomes a minor release

#### **New NPM Scripts**
- `npm run version:smart` - Smart version increment with rollover logic
- `npm run version:patch` - Original patch increment (preserved for manual use)

#### **Husky Integration**
- **Updated:** `.husky/pre-commit` now uses `version:smart` instead of `version:patch`
- **Files modified:** `package.json`, `scripts/version-manager.js`, `.husky/pre-commit`

### 📊 Version History Impact

**Old System:**
```
3.0.38 → 3.0.39 → 3.0.40 → 3.0.41 → ... → 3.0.63 → 3.0.64 ...
```

**New System (from this point forward):**
```
3.0.38 → 3.0.39 → 3.0.40 → ... → 3.0.20 → 3.1.0 → 3.1.1 → ... → 3.1.20 → 3.2.0
```

**Note:** This change applies to future versions only. Existing version history remains unchanged.

---

## [3.0.40] - 2025-10-22

### 🐛 Bug Fix - Theme Picker Click-Outside Detection

#### **Problem: Theme Picker Wouldn't Close When Clicking Outside**
- **Issue:** Clicking outside the theme picker didn't close it properly
- **Root Cause:** Drag selection functionality was capturing mouse events before click-outside detection
- **User Impact:** Theme picker would stay open, requiring manual closing

#### **Solution: Implemented Modal-Style Overlay Pattern**
```typescript
// NEW: Clean overlay approach like other modals
{showThemePicker && (
  <div className="theme-picker__dropdown">
    {/* Theme content */}
  </div>
)}
{showThemePicker && (
  <div 
    className="theme-picker__overlay"    // Full-screen transparent overlay
    onClick={onThemePickerToggle}        // Closes on any outside click
  />
)}
```

#### **Implementation Details**
- **Removed hacky approach:** No more special mouseDown handling in main container
- **Removed useClickOutside:** No longer needed, direct overlay click handling
- **Added overlay CSS:** Full-screen transparent overlay for reliable click detection
- **Proper positioning:** Dropdown positioned relative to button, overlay separate
- **Consistent pattern:** Same click-outside approach as SettingsModal

### ✅ Benefits

1. **Reliable click-outside:** Works regardless of drag selection or other event handlers
2. **Consistent UX:** Same behavior as settings modal and other dropdowns
3. **Cleaner code:** Removed complex event detection logic
4. **Better performance:** Direct click handling instead of document listeners
5. **Proper separation:** Theme picker content and click detection are separate concerns

### 📊 Files Modified (4 files)

- `src/components/AppHeader.tsx` - Implemented overlay pattern
- `src/hooks/useTheme.ts` - Removed themePickerRef (no longer needed)
- `src/app/App.tsx` - Updated props and removed useClickOutside usage
- `src/styles/main.css` - Added overlay CSS styling

### 🔧 Technical Changes

**Removed:**
- ❌ `useClickOutside` hook usage for theme picker
- ❌ `themePickerRef` parameter and ref handling
- ❌ Complex document event listener setup

**Added:**
- ✅ `.theme-picker__overlay` CSS class (fixed positioning)
- ✅ Overlay click handler for reliable outside click detection
- ✅ Proper event stopPropagation on theme picker content

**Build Output:**
```
dist/style.css   43.15 kB │ gzip:  7.08 kB (+0.08 kB)
dist/index.js   108.55 kB │ gzip: 24.71 kB (-0.02 kB)
```

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

## Version History

For versions prior to 3.0.37, please refer to git commit history.

---

**Package:** `@wolffm/task`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
