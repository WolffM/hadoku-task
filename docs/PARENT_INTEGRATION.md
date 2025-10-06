# Parent Integration Instructions for hadoku_site

## Overview

The task app has been extensively refactored with a new modular architecture. The parent app (`hadoku_site`) needs to integrate both the client (UI) and server (API) components.

## What Gets Deployed

The CI/CD pipeline (`.github/workflows/build.yml`) automatically deploys:

### Client Files → `hadoku_site/public/mf/task/`
- `index.js` (~18.58KB, gzipped: 4.80KB) - React app bundle
- `style.css` (~8.25KB, gzipped: 1.92KB) - Compiled styles

### Server Files → `hadoku_site/api/apps/task/`
- `router.js` - Main Express router (43 lines)
- `package.json` - Dependencies metadata
- `handlers/` - Business logic
  - `data-access.js` - Storage abstraction layer
  - `stats-operations.js` - Pure stats functions
  - `task-operations.js` - Pure task functions
- `routes/` - HTTP endpoints
  - `tasks.js` - GET/POST routes
  - `task-operations.js` - Task action routes

---

## Architecture Changes

### What Changed

**Before (Original Architecture)**:
```
api/apps/task/
├── router.js      # 506 lines, duplicated if/else logic
├── storage.js     # Direct file operations
├── sync-queue.js  # GitHub sync
└── utils.js       # Utilities
```

**After (New Architecture)**:
```
api/apps/task/
├── router.js              # 43 lines (91% reduction!)
├── package.json           # Dependencies
├── handlers/
│   ├── data-access.js    # Unified storage interface
│   ├── stats-operations.js   # Pure functions
│   └── task-operations.js    # Pure functions
└── routes/
    ├── tasks.js          # GET/POST endpoints
    └── task-operations.js    # Action endpoints
```

### Key Improvements

1. **Data Access Layer**: Unified interface eliminates public vs friend/admin duplication
2. **Pure Functions**: Business logic extracted for testability
3. **Route Separation**: Clean HTTP handling separate from business logic
4. **No Breaking Changes**: API endpoints remain identical

---

## Parent App Setup

### 1. Server Integration (Express)

The parent app should import and mount the task router:

**Location**: `hadoku_site/api/server.js` (or wherever you initialize Express)

```javascript
import express from 'express'
import { createTaskRouter } from './apps/task/router.js'

const app = express()

// Middleware
app.use(express.json())

// Mount task router
const taskRouter = createTaskRouter({
  dataPath: './data/task',      // Path to data directory
  environment: 'production'      // 'development' | 'production'
})

app.use('/api/task', taskRouter)

// Other routes...
app.listen(3000)
```

### 2. Data Directory Structure

Ensure the data directory exists and has proper permissions:

```bash
# From hadoku_site root
mkdir -p data/task/friend
mkdir -p data/task/admin
chmod -R 755 data/task
```

**IMPORTANT**: Add `data/task/` to parent app's `.gitignore`:
```gitignore
# Task app data (managed at runtime, not committed to parent)
data/task/
```

**Note**: The child repo (hadoku-task) commits its own task data for backup, but the parent app (hadoku_site) should NOT commit task data - it's managed by the router at runtime

**Expected structure**:
```
hadoku_site/
├── data/
│   └── task/
│       ├── friend/
│       │   ├── tasks.json    # Created automatically on first use
│       │   └── stats.json    # Created automatically on first use
│       └── admin/
│           ├── tasks.json
│           └── stats.json
```

### 3. Client Integration (HTML/Astro)

Mount the task app in your page:

**Option A: Direct HTML**
```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/mf/task/style.css">
</head>
<body>
  <div id="task-app"></div>
  
  <script type="module">
    import { mount } from '/mf/task/index.js'
    
    mount(document.getElementById('task-app'), {
      apiUrl: '/api/task',
      userType: 'friend',     // or 'public' / 'admin'
      environment: 'production'
    })
  </script>
</body>
</html>
```

**Option B: Astro Component**
```astro
---
// src/pages/task.astro
const userType = Astro.locals.user?.type || 'public'
---

<html>
<head>
  <link rel="stylesheet" href="/mf/task/style.css">
</head>
<body>
  <div id="task-app"></div>
  
  <script type="module" define:vars={{ userType }}>
    import { mount } from '/mf/task/index.js'
    
    mount(document.getElementById('task-app'), {
      apiUrl: '/api/task',
      userType: userType,
      environment: 'production'
    })
  </script>
</body>
</html>
```

### 4. Environment Variables (Optional)

If you want to configure the task app via environment:

```bash
# .env
TASK_DATA_PATH=./data/task
TASK_ENVIRONMENT=production
```

```javascript
// In server.js
const taskRouter = createTaskRouter({
  dataPath: process.env.TASK_DATA_PATH || './data/task',
  environment: process.env.TASK_ENVIRONMENT || 'production'
})
```

---

## API Endpoints (No Changes)

All endpoints remain the same - **no breaking changes**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/task` | Get all tasks |
| GET | `/api/task/stats` | Get statistics |
| POST | `/api/task` | Create task |
| POST | `/api/task/:id/complete` | Mark complete |
| PATCH | `/api/task/:id` | Update task |
| DELETE | `/api/task/:id` | Delete task |
| POST | `/api/task/clear` | Clear all (public only) |

**Authentication**: User type via query param (`?userType=`) or header (`X-User-Type:`)

---

## Verification Checklist

After deployment, verify:

### ✅ Client Deployment
```bash
# From hadoku_site root
ls -lh public/mf/task/
# Should show:
# - index.js (~18KB)
# - style.css (~8KB)
```

### ✅ Server Deployment
```bash
# From hadoku_site root
ls -lh api/apps/task/
# Should show:
# - router.js
# - package.json
# - handlers/ (directory)
# - routes/ (directory)
```

### ✅ Data Directory
```bash
ls -la data/task/
# Should show:
# - friend/ (directory, writable)
# - admin/ (directory, writable)
```

### ✅ Server Running
```bash
# Test API endpoints
curl http://localhost:3000/api/task?userType=public

# Should return:
# {"version":1,"tasks":[],"updatedAt":"..."}
```

### ✅ Client Loading
```bash
# Visit in browser
http://localhost:3000/task?userType=public

# Should show:
# - Task input box
# - No console errors
# - CSS loaded correctly
```

---

## Troubleshooting

### Issue: "Cannot find module './apps/task/router.js'"

**Cause**: Server files not deployed correctly

**Fix**:
```bash
# Check if files exist
ls api/apps/task/router.js

# If missing, manually trigger CI/CD or copy from dist/
```

### Issue: "ENOENT: no such file or directory, open 'data/task/friend/tasks.json'"

**Cause**: Data directory doesn't exist or has wrong permissions

**Fix**:
```bash
# Create directories
mkdir -p data/task/friend data/task/admin

# Set permissions
chmod -R 755 data/task

# Files will be created automatically on first write
```

### Issue: "Module not found: handlers/data-access"

**Cause**: Node.js module resolution issue with new structure

**Fix**:
Ensure `package.json` in `api/apps/task/` has:
```json
{
  "type": "module"
}
```

### Issue: Client loads but styles are wrong

**Cause**: CSS not loaded or cached

**Fix**:
```bash
# Verify CSS exists
ls public/mf/task/style.css

# Clear browser cache
# Or add cache-busting: style.css?v=<hash>
```

### Issue: Tasks not persisting for friend/admin users

**Cause**: Write permissions or wrong data path

**Fix**:
```bash
# Check permissions
ls -la data/task/friend/

# Should be writable by the user running Node.js
chmod -R 755 data/task

# Check router config
# dataPath should point to correct directory
```

---

## Migration from Old Architecture

If you're currently running the old router (506 lines), here's how to migrate:

### 1. Backup Current Data
```bash
# Backup existing data
cp -r data/task data/task.backup
```

### 2. No Code Changes Required
The new router is **100% API compatible** - no changes needed in parent app.

### 3. Deploy New Files
Let CI/CD run, or manually:
```bash
# In hadoku-task repo
npm run build:all

# Copy to parent
cp -r dist/server/* ../hadoku_site/api/apps/task/
cp -r dist/index.js dist/style.css ../hadoku_site/public/mf/task/
```

### 4. Restart Server
```bash
# In hadoku_site
npm restart
# or
pm2 restart hadoku-site
```

### 5. Verify
```bash
# Test API
curl http://localhost:3000/api/task?userType=friend

# Should return existing tasks (data preserved)
```

---

## Performance Notes

### Response Times

| User Type | Storage | Response Time |
|-----------|---------|---------------|
| Public | In-memory | < 1ms |
| Friend | File system | ~5-10ms |
| Admin | File system | ~5-10ms |

### Bundle Sizes

| File | Size | Gzipped | Load Time (3G) |
|------|------|---------|----------------|
| index.js | 18.58KB | 4.80KB | ~50ms |
| style.css | 8.25KB | 1.92KB | ~20ms |

### Recommendations

1. **Enable gzip** compression in Express:
```javascript
import compression from 'compression'
app.use(compression())
```

2. **Set cache headers** for static files:
```javascript
app.use('/mf', express.static('public/mf', {
  maxAge: '1d',
  etag: true
}))
```

3. **Consider CDN** for static assets in production

---

## CI/CD Integration

The build pipeline automatically:

1. ✅ Builds client and server (`npm run build:all`)
2. ✅ Verifies build output exists and is valid
3. ✅ Clones parent repository
4. ✅ Copies files to correct locations
5. ✅ Commits and pushes changes
6. ✅ Triggers parent deployment

**Triggered by**:
- Push to `main` branch
- Changes to `src/`, `package.json`, `vite.config.ts`, `tsconfig.json`
- Manual workflow dispatch

**Required Secret**: `HADOKU_SITE_TOKEN` with `repo` scope

---

## Testing in Parent App

### Local Testing

```bash
# 1. Build task app
cd hadoku-task
npm run build:all

# 2. Copy to parent
cp -r dist/server/* ../hadoku_site/api/apps/task/
cp dist/index.js dist/style.css ../hadoku_site/public/mf/task/

# 3. Start parent server
cd ../hadoku_site
npm run dev

# 4. Test in browser
open http://localhost:3000/task?userType=public
```

### Production Testing

```bash
# Test API endpoints
curl https://hadoku.me/api/task?userType=public
curl https://hadoku.me/api/task/stats?userType=friend

# Test client
open https://hadoku.me/task?userType=friend
```

---

## Support

For issues or questions:

1. Check [Architecture docs](https://github.com/WolffM/hadoku-task/blob/main/docs/ARCHITECTURE.md)
2. Check [API docs](https://github.com/WolffM/hadoku-task/blob/main/docs/API.md)
3. Check [Development docs](https://github.com/WolffM/hadoku-task/blob/main/docs/DEVELOPMENT.md)
4. Review build logs in GitHub Actions
5. Check parent app server logs

---

## Summary

**What You Need to Do**:

1. ✅ Ensure `data/task/friend` and `data/task/admin` directories exist with write permissions
2. ✅ Import and mount router: `app.use('/api/task', createTaskRouter({ dataPath: './data/task' }))`
3. ✅ Load client with: `<script type="module">import { mount } from '/mf/task/index.js'`
4. ✅ Verify deployment after CI/CD runs

**What's Automatic**:

1. ✅ Build and deploy on push to main
2. ✅ File structure creation
3. ✅ Data file creation (on first use)
4. ✅ API compatibility (no breaking changes)

**Benefits**:

- 🚀 91% smaller router code (506 → 43 lines)
- 🧪 Testable pure functions
- 📦 Modular architecture
- ⚡ Same or better performance
- 🔄 No breaking changes
