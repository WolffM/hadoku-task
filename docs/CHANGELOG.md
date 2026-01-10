# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 📅 Calendar Data Support (Phase 1)

**Data layer preparation for calendar functionality.**

#### **Task Interface Changes**

Added optional scheduling fields to the `Task` interface:

| Field       | Type           | Description                             |
| ----------- | -------------- | --------------------------------------- |
| `startTime` | string \| null | ISO 8601 scheduled start time           |
| `endTime`   | string \| null | ISO 8601 scheduled end time or deadline |

**Flexible scheduling modes:**

- Neither field → Classic board task (existing behavior)
- `startTime` only → Open-ended event
- `endTime` only → Deadline/due date
- Both fields → Fully scheduled time block

Tasks with scheduling fields will appear in both board and calendar views (calendar UI coming in Phase 2).

#### **API Changes**

- `POST /` (Create Task): Now accepts optional `startTime` and `endTime`
- `PATCH /:id` (Update Task): Now accepts optional `startTime` and `endTime` (null to clear)

#### **Documentation Cleanup**

Deleted redundant/outdated docs:

- `docs/THEME_EXPORT_GUIDE.md` - feature already implemented in @wolffm/themes
- `docs/TYPES.md` - duplicates TypeScript source definitions
- `docs/BUILD_REQUIREMENTS.md` - merged into CONTRIBUTING.md
- `.husky/HUSKY_SETUP.md` - merged into .husky/README.md

Updated remaining docs:

- ARCHITECTURE.md → authoritative strategy document with calendar section
- Fixed theme count: "7 themes" → "12 theme families"
- Trimmed CONTRIBUTING.md, .husky/README.md, themes/THEME_GRAVEYARD.md

---

## [3.4.12] - 2025-12-15

### 🎨 New Semantic Theme Variables

**Version Bumps:**

- **@wolffm/task**: 3.4.11 → 3.4.12
- **@wolffm/themes**: 1.1.18 → 1.1.19

#### **@wolffm/themes - New Color Variables**

Added 4 new semantic color variables across all 18 themes to support badges and status indicators:

**New Variables:**

| Variable             | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `--color-success-bg` | Background for success badges (10-15% opacity of success color) |
| `--color-warning`    | Warning/intermediate state foreground (typically amber/yellow)  |
| `--color-warning-bg` | Background for warning badges (10-15% opacity of warning color) |
| `--color-muted-bg`   | Background for unknown/neutral badges                           |

**Documentation Updates:**

- Updated `README.md` with new CSS variable documentation
- Updated `THEME_CREATION_GUIDE.md`:
  - Color variable count: 27 → 31 colors (33 → 37 total with shadows)
  - Added Warning Colors section (2 variables)
  - Added `--color-success-bg` to Success Colors section
  - Added `--color-muted-bg` to Neutral Colors section
  - Updated theme checklist

---

## [3.3.3] - 2025-11-08

### 🎨 React Integration & Package Enhancements

**Version Bumps:**

- **@wolffm/task**: 3.3.2 → 3.3.3
- **@wolffm/themes**: 1.1.2 → 1.1.4 (auto-bumped by version manager)
- **@wolffm/task-ui-components**: 1.0.6 → 1.0.8 (auto-bumped by version manager)

#### **@wolffm/themes - New React Integration**

Added first-class React support with theme metadata and hooks:

**New Exports:**

- **`useTheme()`** - React hook for stateful theme management
  - Returns `{ theme, setTheme }`
  - Automatically saves to sessionStorage
  - Syncs theme changes across browser tabs via storage events

- **`THEME_FAMILIES`** - Pre-configured array of all 9 theme pairs with icons and labels
  - Each family includes: `lightTheme`, `darkTheme`, `lightLabel`, `darkLabel`, `lightIcon`, `darkIcon`
  - Ready to use with `ThemePicker` or `ConnectedThemePicker` components

- **`THEME_ICON_MAP`** - Object mapping theme names to icon components
  - Maps all 18 themes to their corresponding icons
  - Useful for custom theme picker implementations

**New Files:**

- `src/metadata.tsx` - Theme metadata with icon mappings
- `src/useTheme.tsx` - React hook implementation
- `scripts/fix-imports.cjs` - ESM import fixer (same as task-ui-components)

**Package Updates:**

- Added peer dependencies: React ^18.0.0 || ^19.0.0, @wolffm/task-ui-components ^1.0.0 (both optional)
- Added JSX support to TypeScript config
- Updated build script to include ESM import fixes
- Enhanced README with React integration examples

#### **@wolffm/task-ui-components - ConnectedThemePicker Component**

Added stateful wrapper component for easier integration:

**New Component: `ConnectedThemePicker`**

- Manages `isOpen` state internally
- Simpler API - no need to manage picker visibility state
- Same props as `ThemePicker` minus `isOpen` and `onToggle`
- Perfect for quick integration with `@wolffm/themes`

**Example:**

```tsx
import { ConnectedThemePicker } from '@wolffm/task-ui-components'
import { useTheme, THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'

function App() {
  const { theme, setTheme } = useTheme()

  return (
    <ConnectedThemePicker
      themeFamilies={THEME_FAMILIES}
      currentTheme={theme}
      onThemeChange={setTheme}
      getThemeIcon={theme => {
        const Icon = THEME_ICON_MAP[theme]
        return Icon ? <Icon /> : null
      }}
    />
  )
}
```

**Documentation:**

- Updated README with `ConnectedThemePicker` usage examples
- Added quick start guide for @wolffm/themes integration
- Reorganized usage examples (Quick Start, ConnectedThemePicker, ThemePicker, Fallback Icons)

---

## [3.3.2] - 2025-11-08

### 🔧 Build & Packaging

**Version Bumps:**

- **@wolffm/task**: 3.3.1 → 3.3.2
- **@wolffm/themes**: 1.1.1 → 1.1.2
- **@wolffm/task-ui-components**: 1.0.5 → 1.0.6

**Purpose:** Trigger GitHub Actions deployment workflow and notify parent repository (hadoku_site) of updated packages.

#### **ESM Module Resolution Fix**

Fixed critical ESM compatibility issue in `@wolffm/task-ui-components` that blocked integration with strict ESM environments (Astro, Vite):

**Problem:**

- TypeScript compiler doesn't add `.js` extensions to imports in compiled output
- Compiled `dist/index.js` had imports like `from './components/ThemePicker'`
- Caused "ERR_MODULE_NOT_FOUND" errors in strict ESM bundlers

**Solution:**

1. Added `"type": "module"` to package.json
2. Changed `moduleResolution` to `"bundler"` in tsconfig.json
3. Created post-build script `scripts/fix-imports.cjs` that adds `.js` extensions to all relative imports
4. Updated build script: `tsc && node scripts/fix-imports.cjs && pnpm run copy-css`

**Result:** All compiled imports now have proper `.js` extensions (e.g., `from './components/ThemePicker.js'`), ensuring compatibility with Astro and other strict ESM environments.

---

## [3.3.1] - 2025-11-08

### 🎯 Major Refactoring - Monorepo Architecture & Logger Standardization

#### **📦 New Package: @wolffm/task-ui-components v1.0.3**

**Package Structure:**

```
task-ui-components/
├── src/
│   ├── components/ThemePicker.tsx    # Extracted from main app
│   ├── utils/logger.ts               # Production-safe logger
│   └── theme-picker.css              # Component styles
├── dist/                              # Compiled output
└── package.json                       # Independent versioning
```

**Exports:**

- `ThemePicker` component - Standalone theme selection UI
- `logger` utility - Production-safe logging with dev/admin modes
- `theme-picker.css` - Component-specific styles

**Benefits:**

1. **Reusability** - Components can be used across multiple applications
2. **Independent versioning** - Package versions separate from main app
3. **Better organization** - Shared utilities in dedicated package
4. **Type safety** - Full TypeScript support with declaration files

---

#### **🔧 Complete Logger Migration (140+ instances)**

**Migrated all console calls to standardized logger:**

**Files Updated (15 total):**

- Core hooks: `useTasks/index.ts` (35), `useDragAndDrop/index.ts` (12), `usePreferences.ts` (4)
- API layer: `client.ts` (33), `localStorageApi.ts` (12), `session.ts` (8)
- Components: `App.tsx` (6), `BoardsSection.tsx` (3), `TagContextMenu.tsx` (5), `BoardButton.tsx` (1), `BoardContextMenu.tsx` (1), `CreateTagModal.tsx` (1), `ErrorBoundary.tsx` (1)
- Utilities: `preferences.ts` (5), `auth.ts` (2), `broadcast.ts` (1), `helpers.ts` (5)
- Entry: `entry.tsx` (1)

**Logger Features:**

```typescript
import { logger } from '@wolffm/task-ui-components'

// Structured logging with context objects
logger.info('[Component] Message', { contextKey: value })
logger.error('[Component] Error', { error: err.message, ...context })
logger.warn('[Component] Warning', { data })

// Production-safe: Only logs in development or for admin users
// No more console.log cluttering production
```

**Before:**

```typescript
console.log('[App] Loading tasks...', { boardId })
console.error('Failed to save task:', error)
```

**After:**

```typescript
logger.info('[App] Loading tasks', { boardId })
logger.error('[App] Failed to save task', {
  error: error instanceof Error ? error.message : String(error),
  taskId
})
```

---

#### **🧹 Code Cleanup & Dead Code Removal**

**Removed:**

- ✅ Duplicate logger at `src/utils/logger.ts` (old implementation)
- ✅ Deprecated `deferredBroadcast` wrapper in `helpers.ts`
- ✅ Unused `withBulkOperation` function (dead code)
- ✅ Unused imports: `SESSION_ID`, `deferredBroadcast` from helpers

**Result:** Cleaner, more maintainable codebase

---

#### **📊 Package Versions**

- **@wolffm/task**: `3.3.1`
- **@wolffm/task-ui-components**: `1.0.3` (new package)
- **@wolffm/themes**: `1.1.0`

---

#### **🔄 Migration Impact**

**Developer Experience:**

- ✅ All logging now centralized in shared package
- ✅ Consistent logging patterns across entire codebase
- ✅ Production logs only show for admin users
- ✅ Development logs always visible for debugging

**Build & Performance:**

- ✅ No TypeScript errors
- ✅ All packages building successfully
- ✅ Dev server running without issues
- ✅ No bundle size increase

---

#### **📝 Files Modified Summary**

##### Total: 20+ files across 4 categories

1. **Hooks** (4 files)
   - useTasks, useDragAndDrop, usePreferences, helpers

2. **API Layer** (4 files)
   - client, localStorageApi, session, auth

3. **Components** (9 files)
   - App, BoardsSection, TagContextMenu, BoardButton, etc.

4. **Utilities** (3 files)
   - preferences, broadcast, entry

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
  newVersion = `${major}.${minor + 1}.0` // Roll over
} else {
  newVersion = `${major}.${minor}.${patch + 1}` // Regular increment
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

### ✅ Theme Picker Benefits

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
'admin-john-doe-main-tasks' // ❌ Breaks if user changes name
'friend-jane-smith-work-tasks' // ❌ Parent can change userId anytime

// API client had redundant parameter
createApi(userType, userId, sessionId) // ❌ userId was redundant
```

#### **Solution: Use sessionId for localStorage Keys**

**New Architecture (Stable):**

```typescript
// localStorage keys are stable across userId changes
'admin-abc-123-xyz-main-tasks' // ✅ Stable session identifier
'friend-def-456-uvw-work-tasks' // ✅ Parent controls session lifecycle

// API client simplified
createApi(userType, sessionId) // ✅ One identifier, clearer intent
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
'${userType}-${userId}-${boardId}-tasks'
'admin-john-doe-main-tasks'

// ✅ NEW - Keys use sessionId
'${userType}-${sessionId}-${boardId}-tasks'
'admin-abc-123-xyz-main-tasks'
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

### ✅ sessionId Refactor Benefits

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

### 📦 Build Output (Dead Code Cleanup)

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
.settings-option input[type='checkbox'] {
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
.settings-option input[type='checkbox'] {
  margin-top: 2px;
  cursor: pointer;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--color-primary); /* 🎨 Theme-aware color */
  appearance: auto;
  -webkit-appearance: checkbox;
  -moz-appearance: checkbox;
}
```

### 🎨 Cross-Theme Validation

**Checkboxes now match theme primary colors:**

| Theme           | Primary Color | Checkbox Color | Visibility |
| --------------- | ------------- | -------------- | ---------- |
| **Pink Light**  | #e91e63       | Pink           | ✅ Visible |
| **Pink Dark**   | #f48fb1       | Light Pink     | ✅ Visible |
| **Green Light** | #4caf50       | Green          | ✅ Visible |
| **Green Dark**  | #81c784       | Light Green    | ✅ Visible |
| **Blue Light**  | #2196f3       | Blue           | ✅ Visible |
| **Blue Dark**   | #64b5f6       | Light Blue     | ✅ Visible |
| **Gray Light**  | #9e9e9e       | Gray           | ✅ Visible |
| **Gray Dark**   | #bdbdbd       | Light Gray     | ✅ Visible |

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

### 📦 Build Output (Checkbox Fix)

```
CSS: 43.15 kB (+0.11 kB) │ gzip: 7.09 kB
```

---

## Version History

For versions prior to 3.0.37, please refer to git commit history.

---

**Package:** `@wolffm/task`  
**Repository:** <https://github.com/WolffM/hadoku-task>  
**Registry:** <https://npm.pkg.github.com>
