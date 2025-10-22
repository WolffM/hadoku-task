# Changelog

All notable changes to @wolffm/task will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [3.0.34] - 2025-10-21

### 🐛 Fixed - Critical Preferences Persistence Bugs

#### **Fixed Theme & Button Settings Being Wiped on Page Refresh**
- **Issue:** Theme and button visibility settings were reset to defaults on every page refresh
- **Impact:** Users couldn't maintain their preferred theme or button configurations
- **Root Cause:** Two critical bugs in the preferences system were causing data loss

### 🔧 Bug #1: Server Preferences Overwriting Device Settings

#### **Problem:**
The `getPreferences()` API was **overwriting** localStorage with server data, wiping out device-specific settings:

```typescript
// ❌ OLD CODE - Overwrote device settings
async getPreferences() {
  const serverPrefs = await fetch('/task/api/preferences')
  await localStorage.savePreferences(serverPrefs)  // ⚠️ OVERWRITES theme/buttons!
  return serverPrefs  // ⚠️ Missing device-specific settings!
}
```

#### **Solution: Smart Merge Strategy**
```typescript
// ✅ NEW CODE - Preserves device settings
async getPreferences() {
  const localPrefs = await localStorage.getPreferences()  // Get device settings first
  
  try {
    const serverPrefs = await fetch('/task/api/preferences')
    if (response.ok) {
      // Merge server with local, explicitly preserve device settings
      const mergedPrefs = {
        ...localPrefs,  // Keep device-specific settings
        ...serverPrefs, // Override with server preferences
        // Ensure device-specific settings are never overwritten
        theme: localPrefs.theme,
        showCompleteButton: localPrefs.showCompleteButton,
        showDeleteButton: localPrefs.showDeleteButton,
        showTagButton: localPrefs.showTagButton
      }
      await localStorage.savePreferences(mergedPrefs)
      return mergedPrefs  // ✅ Contains ALL settings!
    }
  } catch (err) {
    // Server failed, use local settings
  }
  return localPrefs  // ✅ Always preserves device settings
}
```

### 🔧 Bug #2: localStorage Actively Stripping Theme Data

#### **Problem:**
The localStorage implementation had **legacy code** that was **actively removing** theme and button fields:

```typescript
// ❌ OLD CODE - Stripped theme data!
async getPreferences() {
  const parsed = JSON.parse(stored)
  const { theme, ...prefs } = parsed  // ⚠️ INTENTIONALLY removing theme!
  return prefs  // ⚠️ Theme data lost forever!
}
```

#### **Solution: Return Complete Preferences**
```typescript
// ✅ NEW CODE - Preserves all data
async getPreferences() {
  const parsed = JSON.parse(stored)
  return parsed  // ✅ Return ALL preferences including theme!
}

// ✅ Better defaults with device-specific settings
return {
  version: 1,
  updatedAt: new Date().toISOString(),
  theme: 'light',
  showCompleteButton: true,
  showDeleteButton: true,
  showTagButton: false
}
```

### 📊 Data Flow Comparison

#### **Before (Broken):**
```
1. User sets theme: 'dark' → localStorage ✅
2. Page refresh → getPreferences()
3. Server returns: { experimentalThemes: true }
4. localStorage.savePreferences(serverData) → overwrites theme ❌
5. localStorage strips theme field → lost forever ❌
6. App receives: { experimentalThemes: true } → theme missing ❌
7. UI resets to default theme ❌
```

#### **After (Fixed):**
```
1. User sets theme: 'dark' → localStorage ✅
2. Page refresh → getPreferences()
3. Get local first: { theme: 'dark', showTagButton: true, ... } ✅
4. Get server: { experimentalThemes: true, alwaysVerticalLayout: false }
5. Smart merge: { theme: 'dark', showTagButton: true, experimentalThemes: true, ... } ✅
6. Save merged data → all settings preserved ✅
7. App receives complete preferences → UI maintains settings ✅
```

### 🧪 Added - Debug Logging

#### **Enhanced Preferences Loading Visibility**
```typescript
// Added debug logs to track preferences loading
console.log('[App] Loading preferences...', { userType, userId, sessionId })
console.log('[App] Loaded preferences:', prefs)
console.log('[App] Applied preferences to state')
```

**Benefits:**
- ✅ Easier debugging of preferences issues
- ✅ Visibility into merge operations
- ✅ Clear tracking of data flow

### ✅ Result - Complete Persistence Fix

#### **User Experience Now:**
1. ✅ Set theme to dark mode
2. ✅ Disable complete button  
3. ✅ Enable tag button
4. ✅ **Close browser completely**
5. ✅ **Reopen → all settings preserved!** 🎉

#### **Technical Guarantees:**
- ✅ **Theme persists** across page refreshes
- ✅ **Button visibility settings persist** across page refreshes
- ✅ **Server sync works** for cross-device settings (experimentalThemes, alwaysVerticalLayout)
- ✅ **Device-specific settings** never get wiped by server calls
- ✅ **Merge conflicts resolved** by always preserving device preferences
- ✅ **Offline support** maintains all local settings

### 🏗️ Architecture Improvements

#### **Clear Separation of Concerns:**
```typescript
// Device-specific (localStorage only)
theme: string
showCompleteButton: boolean
showDeleteButton: boolean  
showTagButton: boolean

// Cross-device (localStorage + server sync)
experimentalThemes: boolean
alwaysVerticalLayout: boolean
```

#### **Robust Merge Strategy:**
- **Local-first:** Always start with complete local preferences
- **Server enhancement:** Merge in cross-device settings from server
- **Device protection:** Explicitly preserve device-specific settings
- **Fallback safety:** Works offline when server unavailable

### 📦 Build Output
```
dist/style.css   41.98 kB │ gzip:  6.79 kB
dist/index.js   105.61 kB │ gzip: 23.50 kB
```

---

## [3.0.33] - 2025-10-21

### 🐛 Fixed - Settings Persistence Issue

#### **Fixed Theme & Button Settings Lost on Browser Restart**
- **Issue:** Users reported that theme and button visibility settings were reverted when reopening the app
- **Root Cause:** These settings were stored in `sessionStorage` which is cleared when browser/tab closes
- **Impact:** Only `experimentalThemes` and `alwaysVerticalLayout` persisted (stored in localStorage + server)

**Problem Analysis:**
```typescript
// ❌ Lost on browser close
sessionStorage.setItem('theme', theme)
sessionStorage.setItem('showCompleteButton', 'true')
sessionStorage.setItem('showDeleteButton', 'true') 
sessionStorage.setItem('showTagButton', 'false')

// ✅ Persisted across sessions
localStorage + server sync (experimentalThemes, alwaysVerticalLayout)
```

#### **Solution: Moved to Device-Specific localStorage**
- **Choice:** Moved theme & button settings to `localStorage` while keeping them device-specific
- **Rationale:** These settings should be device-specific (mobile vs desktop) but persistent across sessions
- **Architecture:** Device-specific settings in localStorage, cross-device settings sync to server

### 🏗️ Updated - Storage Architecture

#### **New Unified Preferences System**
**Enhanced UserPreferences Interface:**
```typescript
export interface UserPreferences {
  version: 1
  updatedAt: string
  // Cross-device settings (localStorage + server sync)
  experimentalThemes?: boolean
  alwaysVerticalLayout?: boolean
  // Device-specific settings (localStorage only)
  theme?: string
  showCompleteButton?: boolean
  showDeleteButton?: boolean
  showTagButton?: boolean
}
```

**Storage Strategy:**
| Setting | Storage | Persistence | Cross-Device |
|---------|---------|-------------|--------------|
| **Theme** | `localStorage` | ✅ **Fixed** | ❌ Device-specific |
| **Button Visibility** | `localStorage` | ✅ **Fixed** | ❌ Device-specific |
| **Experimental Themes** | `localStorage + server` | ✅ Persists | ✅ Syncs |
| **Always Vertical Layout** | `localStorage + server` | ✅ Persists | ✅ Syncs |

#### **Smart Server Sync Filtering**
- **Device-specific settings:** Stay local, don't sync to server
- **Cross-device settings:** Sync to server for consistency across devices

**Implementation:**
```typescript
async savePreferences(prefs) {
  // Always save locally (includes device-specific)
  await localStorage.savePreferences(prefs)
  
  // Filter out device-specific settings for server sync
  const { theme, showCompleteButton, showDeleteButton, showTagButton, ...serverPrefs } = prefs
  
  // Only sync cross-device settings to server
  if (Object.keys(serverPrefs).length > 0) {
    fetch('/task/api/preferences', { body: JSON.stringify(serverPrefs) })
  }
}
```

### 🔄 Added - Migration System

#### **Automatic sessionStorage → localStorage Migration**
- **Feature:** One-time migration of existing settings from sessionStorage
- **Safety:** Only migrates if localStorage doesn't already have the setting
- **Cleanup:** Removes old sessionStorage entries after successful migration

**Migration Logic:**
```typescript
useEffect(() => {
  const migrateFromSessionStorage = () => {
    const sessionTheme = sessionStorage.getItem('theme')
    const sessionComplete = sessionStorage.getItem('showCompleteButton')
    const sessionDelete = sessionStorage.getItem('showDeleteButton')
    const sessionTag = sessionStorage.getItem('showTagButton')
    
    const migrations = {}
    if (sessionTheme && !preferences.theme) migrations.theme = sessionTheme
    if (sessionComplete !== null && preferences.showCompleteButton === undefined) {
      migrations.showCompleteButton = sessionComplete === 'true'
    }
    // ... migrate other settings
    
    if (Object.keys(migrations).length > 0) {
      console.log('[App] Migrating settings from sessionStorage to localStorage')
      setPreferences({ ...preferences, ...migrations })
      // Clean up old sessionStorage
      sessionStorage.removeItem('theme')
      sessionStorage.removeItem('showCompleteButton')
      // ...
    }
  }
  migrateFromSessionStorage()
}, [preferences.theme, preferences.showCompleteButton, ...])
```

### 🎯 Updated - Settings UI Integration

#### **Unified Settings Handlers**
- **Before:** Direct state setters + sessionStorage writes
- **After:** All settings use `savePreferences()` for consistency

**Theme Picker:**
```typescript
// ✅ Now uses unified system
const setTheme = (newTheme: ThemeName) => savePreferences({ theme: newTheme })
onClick={() => setTheme(family.lightTheme)}
```

**Button Visibility Settings:**
```typescript
// ✅ Now uses unified system
onChange={(e) => savePreferences({ showCompleteButton: !e.target.checked })}
onChange={(e) => savePreferences({ showDeleteButton: !e.target.checked })}
onChange={(e) => savePreferences({ showTagButton: e.target.checked })}
```

### ✅ Result - User Experience Fixed

**What Users Experience Now:**
1. ✅ Open app
2. ✅ Change theme color (e.g., light → dark)
3. ✅ Disable complete button
4. ✅ Enable tag button  
5. ✅ Close browser completely
6. ✅ **Reopen app → all settings preserved!** 🎉

**Benefits:**
- ✅ **Persistent:** Settings survive browser restarts
- ✅ **Device-specific:** Different settings on mobile vs desktop
- ✅ **Consistent:** All settings use same unified system
- ✅ **Backwards compatible:** Automatic migration from old system

### 📦 Build Output
```
dist/style.css   41.98 kB │ gzip:  6.79 kB
dist/index.js   104.87 kB │ gzip: 23.31 kB
```

---

## Version History

For versions prior to 3.0.33, please refer to git commit history.

---

**Package:** `@wolffm/task`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
