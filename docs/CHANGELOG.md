# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
