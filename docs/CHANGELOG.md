# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.31] - 2025-10-18

### ✨ Added - Edit Tag Button & Modal

#### **New Edit Tag Button on Task Items**
- Added 🏷️ tag button to task items (between task and complete button)
- Opens modal dialog for editing tags on a task
- Button uses theme-aware SVG icon (proper tag shape with hole)
- Styled to match Complete and Delete buttons (gradient background)
- Uses primary theme color for consistency

**Button Design:**
```tsx
<TagIcon /> // SVG icon with sideways rectangular tag shape
background: linear-gradient(--color-primary → --color-primary-dark)
```

#### **Edit Tags Modal Dialog**

**Features:**
- **Tag Pills:** Clickable pills showing all board tags
  - Active pills highlighted (tags currently on task)
  - Click to toggle tags on/off
  - Sorted alphabetically
- **New Tag Input:** Text field for creating new tags
  - Auto-normalizes: "one tag" → #one-tag
  - Supports multiple: "#two #tags" → #two #tags
  - New tags automatically added to board's persisted tags
- **Clear Instructions:** Two-line hint showing both syntax options

**Modal Structure:**
```
Edit Tags
─────────────────

Select Tags
┌─────────────────┐
│ #new  #ok  #tag │  ← Pills toggle existing
└─────────────────┘

Add New Tag
┌─────────────────┐
│ [input field]   │  ← Only for NEW tags
└─────────────────┘

"one tag" → #one-tag
"#two #tags" → #two #tags

[Cancel] [Save]
```

**Key Behaviors:**
- Tags always display alphabetically (both in pills and on tasks)
- Pills show current task tags as active on open
- Input field separate from pills (only for new tags)
- New tags added to board's tag list immediately
- Modal closes without page reload

### 🎛️ Added - Button Visibility Preferences

#### **Three New Preferences (sessionStorage)**
- **Disable Complete Button:** Hide ✓ button on task items
- **Disable Delete Button:** Hide × button on task items
- **Enable Tag Button:** Show 🏷️ button on desktop

**Default Behavior:**
- Complete Button: ✅ Visible
- Delete Button: ✅ Visible
- Tag Button: ❌ Hidden on desktop, ✅ Always visible on mobile

**Storage:**
```typescript
sessionStorage.setItem('showCompleteButton', 'true')
sessionStorage.setItem('showDeleteButton', 'true')
sessionStorage.setItem('showTagButton', 'false')
```

**Conditional Rendering:**
```tsx
{showCompleteButton && <CompleteButton />}
{showDeleteButton && <DeleteButton />}
{(showTagButton || isMobile) && <TagButton />}
```

### 🎨 Updated - Settings Modal UI

**Preferences Section Now Includes:**
- Experimental Themes
- Always Use Vertical Layout
- Disable Complete Button ← NEW
- Disable Delete Button ← NEW
- Enable Tag Button ← NEW

**All in one unified section** (no separate "Button Visibility" section)

### 🎨 Updated - Icons

#### **SettingsIcon Redesign**
- Changed from abstract design to proper gear wheel
- Circle center with 8 gear teeth around edge
- Standard settings icon appearance
- Clean, recognizable design

#### **TagIcon Design**
- Sideways rectangular shape with pointed right end
- Circular hole on left side (classic price tag)
- 16×16 size matching other action buttons
- Proper vertical alignment

### 🐛 Fixed - Tag Ordering & Management

#### **Alphabetical Tag Display**
- Tags now always display in alphabetical order everywhere
- Applied in: TaskItem display, Edit modal pills, Save operations
- Consistent ordering regardless of application order

#### **Tag Pills Update After Creation**
- New tags immediately appear in pill list when reopening modal
- Fixed: Pills now refresh with board's updated tag list
- Implementation: `createTagOnBoard()` called before applying tags

#### **Clear Tag Input Instructions**
- Updated hint text to show both scenarios clearly
- Two-line display with proper spacing
- Examples: "one tag" → #one-tag | "#two #tags" → #two #tags

### 📦 Build Output
```
dist/style.css   41.98 kB │ gzip:  6.79 kB
dist/index.js   104.11 kB │ gzip: 23.10 kB
```

---

## [3.0.30] - 2025-10-18

### 🔧 Fixed - UserId Management

#### **Removed Page Reload on UserId Change**
- **Before:** Changing userId added it to URL params and reloaded the entire page
- **After:** UserId change is API-only, no reload, updates sessionStorage for display

**Why:** userId is primarily for display and validation. If you see your userId, your key loaded correctly and is mapped to both a sessionId and userId. The parent app manages the backend mapping (key → sessionId + userId).

**Changes:**
```typescript
// entry.tsx
const userId = props.userId || 'test-admin'  // From parent only, not URL params

// App.tsx - handleUserIdChange
const result = await api.setUserId(newUserId.trim())
if (result.ok) {
  sessionStorage.setItem('displayUserId', newUserId.trim())
  setShowSettingsModal(false)  // No page reload
}
```

#### **Sync Button Animation & Timeout**
- Added spinning animation that continues while syncing
- 5-second timeout protection prevents infinite spinning
- Button disables during sync operation
- Hover animation (single rotation) on idle state
- Proper error handling for 4xx/5xx responses and network failures

**Implementation:**
```typescript
// Hover: Single rotation
.sync-btn:hover svg {
  animation: spin 0.6s ease-in-out;
}

// Active syncing: Continuous rotation
.sync-btn.spinning svg {
  animation: spin 1s linear infinite;
}

// Timeout protection (5 seconds)
await Promise.race([initialLoad(), timeoutPromise])
```

### 📝 Documentation Updates

**API.md:**
- Clarified userId is for display/validation, not security
- Added note that `setUserId` does NOT reload the page

**PARENT_API_REFERENCE.md:**
- Added purpose statement for User Management endpoints
- Explained userId is primarily for display and key validation

---

## [3.0.29] - 2025-10-18

### 🎨 Added - User Management UI

#### **Settings Modal with User Management**
- Added comprehensive settings modal accessible via header click or theme picker
- New user management section with userId and session key controls
- Automatic input/button disabling and spinner during operations
- Enter key support for userId and key validation
- Browser autofill support for session key field

**Features:**
- **Change User ID:** Input field with validation, disabled for public users
- **Enter New Key:** Password field with validation and enter key support
- **Loading States:** Spinners and disabled states during async operations
- **Public User Protection:** userId input disabled when userType is 'public'

**UI Components:**
```typescript
// Settings Modal Structure
- User Management Section
  - Current User ID (disabled for public)
  - Enter New Key (with validation)
- Preferences Section
  - Experimental Themes toggle
  - Always Vertical Layout toggle
```

### ✨ Added - New API Endpoints

#### **User Management APIs**

**`validateKey(key: string): Promise<boolean>`**
- Validates a session key without changing the current session
- Returns `true` if valid, `false` if invalid
- Used when user enters a new key in settings

**Endpoint:** `POST /task/api/validate-key`
```typescript
Headers: {
  'X-User-Type': string
  'X-User-Id': string
  'X-Session-Id': string  // The key to validate
}
Response: { valid: boolean }
```

**`setUserId(newUserId: string): Promise<{ ok: boolean; message?: string }>`**
- Updates the user ID for the current session
- Server-side implementation required

**Endpoint:** `POST /task/api/user/set-id`
```typescript
Headers: {
  'X-User-Type': string
  'X-Session-Id': string
}
Body: { newUserId: string }
Response: { ok: boolean, message?: string }
```

### 🔧 Fixed - Preferences Server Sync

#### **getPreferences() Now Syncs from Server**
- **Before:** Only read from localStorage, never synced from server
- **After:** Fetches from server on load for non-public users

**Impact:** Preferences now persist across devices and browsers

**Implementation:**
```typescript
async getPreferences() {
  // Try to sync from server (we're in non-public mode here)
  try {
    const response = await fetch('/task/api/preferences', {
      headers: adminHeaders(userType, userId, sessionId)
    })
    if (response.ok) {
      const serverPrefs = await response.json()
      await localStorage.savePreferences(serverPrefs)
      return serverPrefs
    }
  } catch (err) {
    console.warn('[api] Failed to fetch preferences from server, using localStorage:', err)
  }
  // Fallback to localStorage
  return await localStorage.getPreferences()
}
```

### 🔄 Changed - Function Naming

#### **Renamed `clearTasksByTag` → `deleteTag`**
- **Reason:** Original name was misleading (sounded like deleting tasks, not the tag)
- **Behavior:** Removes tag from all tasks, then deletes the tag from board
- **Consistency:** Aligns with `deleteTask`, `deleteBoard`, `deleteTagOnBoard`

**Updated Files:**
- `src/hooks/useTasks/index.ts`
- `src/app/App.tsx`
- `src/components/TaskLayout.tsx`

### 🗑️ Removed - Dead Code

#### **Removed `clearRemainingTasks` Function**
- **Reason:** Function was never called anywhere in the codebase
- **Type:** Legacy dead code
- **Impact:** No functionality change, cleaner codebase

**Removed from:**
- `src/hooks/useTasks/index.ts`
- `src/app/App.tsx`
- `src/components/TaskLayout.tsx`

#### **Removed Unused Import**
- Removed unused `SESSION_ID` import from `src/app/App.tsx`
- `SESSION_ID` is still used internally by the hooks, just not in App component

### 📚 Updated - Documentation

#### **API.md**
- Added User Management section
- Documented `POST /validate-key` endpoint
- Documented `POST /user/set-id` endpoint

#### **PARENT_API_REFERENCE.md**
- Added User Management handler signatures
- Added clarifying note for `batchClearTag` behavior
- Updated example code for new endpoints

### 🎨 Added - UI Styling

#### **Settings Modal Styles**
```css
.settings-text-input:disabled {
  background: var(--color-bg-alt);
  color: var(--color-text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

.settings-field-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
```

### ✅ Verified - Architecture

#### **Session ID Flow**
- Confirmed `sessionId` flows correctly: parent → entry → App → useTasks → createApi → all HTTP requests
- Verified all 15+ API endpoints include `X-Session-Id` header when available
- Confirmed `SESSION_ID` (for cross-tab sync) is separate from `sessionId` (for server auth)

#### **Storage Architecture**
- **Theme:** sessionStorage only (per browser tab, not synced)
- **Preferences:** localStorage + server sync (cross-device)
- Legacy protection ensures theme is never accidentally synced to server

### 📋 Complete API Inventory

**Read Operations:**
- `getBoards()` - ✅ Server sync via `syncFromApi()`
- `getPreferences()` - ✅ **NOW SYNCS FROM SERVER**

**Write Operations (All use optimistic localStorage + background server sync):**
- `createTask()`
- `createTag()`
- `deleteTag()` (renamed from `clearTasksByTag`)
- `patchTask()`
- `completeTask()`
- `deleteTask()`
- `createBoard()`
- `deleteBoard()`
- `savePreferences()`
- `batchUpdateTags()`
- `batchMoveTasks()`
- `batchClearTag()`

**New User Management:**
- `validateKey()` - ✅ NEW
- `setUserId()` - ✅ NEW

### 🔐 Server Implementation Required

The following endpoints need to be implemented in the parent API (hadoku-site):

```typescript
// Preferences (now actually needed for sync on load)
GET  /task/api/preferences

// User Management (new endpoints)
POST /task/api/validate-key
POST /task/api/user/set-id
```

### 📦 Build Output
```
✓ 29 modules transformed.
dist/style.css  40.24 kB │ gzip:  6.63 kB
dist/index.js   94.56 kB │ gzip: 21.53 kB
✓ built in 301ms
```

---

## [3.0.25] - 2025-10-15

### ⚠️ Breaking Changes

- Tag deletion endpoint changed from `DELETE /task/api/tags` to `POST /task/api/tags/delete`
- Body now required: `{ boardId: string, tag: string }`

---

## Version History

For versions prior to 3.0.25, please refer to git commit history.

---

**Package:** `@wolffm/task`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
