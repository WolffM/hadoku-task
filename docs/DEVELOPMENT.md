# Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+
- Git

### Installation

```bash
# Clone repository
git clone https://github.com/WolffM/hadoku-task.git
cd hadoku-task

# Install dependencies
npm install

# Start development server
npm run dev
```

### Development Servers

**Option 1: Vite dev server (client only)**
```bash
npm run dev
# Open http://localhost:5173
```

**Option 2: Test server (client + backend)**
```bash
npm run test:server
# Open http://localhost:3001
```

---

## Project Structure

```
hadoku-task/
├── src/                           # Source code
│   ├── App.tsx                   # Main React component (131 lines)
│   ├── entry.tsx                 # Micro-frontend exports
│   ├── components/               # React components
│   │   ├── TaskItem.tsx         # Individual task card (74 lines)
│   │   └── TaskLayout.tsx       # Dynamic grid layout (197 lines)
│   ├── hooks/                    # Custom React hooks
│   │   ├── useTasks.ts          # Task operations & API (200 lines)
│   │   ├── useDragAndDrop.ts    # Drag-and-drop logic (108 lines)
│   │   └── useTaskSort.ts       # Sort logic (60 lines)
│   ├── lib/                      # Utilities & types
│   │   ├── api.ts               # API client
│   │   ├── formatters.ts        # Formatting utilities (22 lines)
│   │   ├── layoutUtils.ts       # Layout calculations (19 lines)
│   │   ├── tagUtils.ts          # Tag parsing & filtering (94 lines)
│   │   ├── types.ts             # TypeScript interfaces
│   │   └── ulid.ts              # ULID generation
│   ├── styles/                   # Modular CSS
│   │   ├── index.css            # Main import file (10 lines)
│   │   ├── variables.css        # Design tokens (74 lines)
│   │   ├── base.css             # Global resets (39 lines)
│   │   ├── buttons.css          # Button styles (126 lines)
│   │   ├── task-items.css       # Item styles (79 lines)
│   │   ├── task-layout.css      # Layout styles (66 lines)
│   │   └── main.css             # App structure (48 lines)
│   └── server/                   # Express backend
│       ├── router.ts            # Main router (43 lines)
│       ├── handlers/            # Business logic
│       │   ├── data-access.ts  # Storage abstraction (77 lines)
│       │   ├── stats-operations.ts  # Stats functions (137 lines)
│       │   └── task-operations.ts   # Task functions (145 lines)
│       └── routes/              # HTTP routes
│           ├── tasks.ts        # GET/POST routes (97 lines)
│           └── task-operations.ts  # Action routes (92 lines)
├── task/data/                    # Data storage (gitignored)
│   ├── friend/                  # Friend user data
│   │   ├── tasks.json          # Active tasks
│   │   └── stats.json          # Statistics
│   └── admin/                   # Admin user data
│       ├── tasks.json
│       └── stats.json
├── dist/                         # Build output (gitignored)
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md          # Architecture details
│   ├── API.md                   # API documentation
│   └── DEVELOPMENT.md           # This file
├── test-server.ts               # Local test server
├── package.json                 # Dependencies & scripts
├── tsconfig.json                # TypeScript config (client)
├── tsconfig.node.json           # TypeScript config (Vite)
├── tsconfig.server.json         # TypeScript config (server)
├── vite.config.ts               # Vite build config
└── README.md                    # Project overview
```

---

## Code Organization Guidelines

### When Adding New Features

| What | Where | Max Lines |
|------|-------|-----------|
| New utility function | `src/lib/[appropriate-file].ts` | 150 |
| New API call | `src/hooks/useTasks.ts` | 250 |
| New UI component | `src/components/` | 200 |
| New styles | `src/styles/[appropriate-file].css` | - |
| New backend operation | `src/server/handlers/[operations].ts` | 200 |
| New route | `src/server/routes/` | 100 |

### File Size Guidelines

Keep files focused and under these limits:
- **Components**: < 200 lines
- **Hooks**: < 250 lines
- **Utilities**: < 150 lines
- **Routes**: < 100 lines per file
- **CSS modules**: < 200 lines (unless design tokens)

**When to split**:
- File exceeds recommended size
- Multiple distinct concerns in one file
- Code is hard to navigate
- Testing becomes difficult

### Design Token Usage

Always use CSS variables from `variables.css`:

**Colors**:
```css
var(--color-primary)      /* Blue for info/tags */
var(--color-success)      /* Green for complete */
var(--color-danger)       /* Red for delete */
var(--color-neutral)      /* Gray for actions */
var(--color-text-primary) /* Main text */
var(--color-text-secondary) /* Secondary text */
var(--color-border)       /* Borders */
var(--color-bg-primary)   /* Main background */
var(--color-bg-secondary) /* Card backgrounds */
```

**Spacing**:
```css
var(--spacing-xs)   /* 4px */
var(--spacing-sm)   /* 8px */
var(--spacing-md)   /* 12px */
var(--spacing-lg)   /* 16px */
var(--spacing-xl)   /* 24px */
var(--spacing-2xl)  /* 32px */
var(--spacing-3xl)  /* 48px */
```

**Other tokens**:
```css
var(--radius-sm)           /* Small radius */
var(--radius-md)           /* Medium radius */
var(--radius-lg)           /* Large radius */
var(--transition-fast)     /* 150ms */
var(--transition-smooth)   /* 300ms */
var(--shadow-sm)           /* Small shadow */
var(--shadow-md)           /* Medium shadow */
```

**Don't use magic numbers**:
```css
/* ❌ Bad */
.my-component {
  padding: 16px;
  color: #2563eb;
}

/* ✅ Good */
.my-component {
  padding: var(--spacing-lg);
  color: var(--color-primary);
}
```

---

## Testing Different User Types

### URL Parameters

Add `?userType=` to the URL:

```
http://localhost:5173?userType=public   # In-memory storage
http://localhost:5173?userType=friend   # File-based storage
http://localhost:5173?userType=admin    # File-based storage
```

### Data Files

Watch these files to see changes:
```bash
# Friend user data
cat task/data/friend/tasks.json
cat task/data/friend/stats.json

# Admin user data
cat task/data/admin/tasks.json
cat task/data/admin/stats.json
```

Files are created automatically on first use.

### Clear Data

```bash
# Remove all data files
rm -rf task/data/friend/ task/data/admin/

# Files will be recreated on next use
```

---

## Build Commands

```bash
# Build client only
npm run build

# Build server only
npm run build:router

# Build both client and server
npm run build:all

# Clean build artifacts
rm -rf dist/
```

### Build Output

```
dist/
├── index.js          # Client bundle (~18.58KB, gzipped: 4.80KB)
├── style.css         # Styles (~8.98KB, gzipped: 2.01KB)
└── server/           # Server code (TypeScript → JavaScript)
    ├── router.js
    ├── handlers/
    │   ├── data-access.js
    │   ├── stats-operations.js
    │   └── task-operations.js
    └── routes/
        ├── tasks.js
        └── task-operations.js
```

---

## TypeScript Configuration

### Three Configs

1. **tsconfig.json** - Client code (`src/*.tsx`, `src/components/`, `src/hooks/`, `src/lib/`)
2. **tsconfig.node.json** - Vite config (`vite.config.ts`)
3. **tsconfig.server.json** - Server code (`src/server/`)

### Type Checking

```bash
# Check client types
npx tsc --noEmit

# Check server types
npx tsc -p tsconfig.server.json --noEmit

# Check all types
npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit
```

---

## Common Tasks

### Add New Component

1. Create file in `src/components/`
2. Add styles to appropriate CSS file
3. Import in parent component
4. Update this documentation

```tsx
// src/components/MyComponent.tsx
import React from 'react'

interface MyComponentProps {
  title: string
}

export function MyComponent({ title }: MyComponentProps) {
  return (
    <div className="task-app__my-component">
      <h2>{title}</h2>
    </div>
  )
}
```

### Add New Hook

1. Create file in `src/hooks/`
2. Export hook function
3. Use in component

```tsx
// src/hooks/useMyFeature.ts
import { useState, useEffect } from 'react'

export function useMyFeature() {
  const [state, setState] = useState(false)
  
  useEffect(() => {
    // Setup
    return () => {
      // Cleanup
    }
  }, [])
  
  return { state, setState }
}
```

### Add New Route

1. Create/update file in `src/server/routes/`
2. Add operation function to `src/server/handlers/` if needed
3. Mount route in `src/server/router.ts`
4. Update `docs/API.md`

```typescript
// src/server/routes/my-routes.ts
import { Router } from 'express'
import type { DataAccess } from '../handlers/data-access'

export function createMyRoutes(dataAccess: DataAccess): Router {
  const router = Router()
  
  router.get('/my-endpoint', async (req, res) => {
    // Handle request
    res.json({ message: 'Hello' })
  })
  
  return router
}

// src/server/router.ts
import { createMyRoutes } from './routes/my-routes'

export function createTaskRouter(config: TaskRouterConfig): Router {
  const dataAccess = new DataAccess(config.dataPath)
  const router = Router()
  
  router.use('/', createTaskRoutes(dataAccess))
  router.use('/', createTaskOperationRoutes(dataAccess))
  router.use('/', createMyRoutes(dataAccess)) // Add here
  
  return router
}
```

### Add New Style Module

1. Create file in `src/styles/`
2. Add @import to `src/styles/index.css`
3. Use design tokens from `variables.css`

```css
/* src/styles/my-feature.css */
.task-app__my-feature {
  padding: var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
}
```

```css
/* src/styles/index.css */
@import './variables.css';
@import './base.css';
@import './buttons.css';
@import './task-items.css';
@import './task-layout.css';
@import './main.css';
@import './my-feature.css'; /* Add here */
```

---

## Debugging

### Client Debugging

**Browser DevTools**:
1. Open Chrome DevTools (F12)
2. Go to Sources tab
3. Find `src/` directory
4. Set breakpoints

**React DevTools**:
1. Install React DevTools extension
2. Open Components tab
3. Inspect component props/state

**Console Logging**:
```tsx
// Add temporary logging
console.log('[DEBUG]', { tasks, filters, sort })
```

### Server Debugging

**Console Logging**:
```typescript
// Add to route handlers
console.log('[DEBUG]', req.method, req.path, req.body)
```

**Node Inspector**:
```bash
# Start server with inspector
node --inspect test-server.ts

# Open chrome://inspect in Chrome
```

**VSCode Debugging**:
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Test Server",
      "program": "${workspaceFolder}/test-server.ts",
      "skipFiles": ["<node_internals>/**"],
      "runtimeArgs": ["-r", "ts-node/register"]
    }
  ]
}
```

---

## Performance Optimization

### Client Performance

**Bundle Analysis**:
```bash
npm run build -- --mode production
# Check dist/index.js and dist/style.css sizes
```

**Lazy Loading**:
```tsx
// Lazy load heavy components
const HeavyComponent = React.lazy(() => import('./HeavyComponent'))

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HeavyComponent />
    </Suspense>
  )
}
```

**Memoization**:
```tsx
// Memoize expensive calculations
const sortedTasks = useMemo(() => {
  return tasks.sort(sortFunction)
}, [tasks, sortFunction])

// Memoize callbacks
const handleClick = useCallback(() => {
  // Handle click
}, [dependencies])
```

### Server Performance

**Caching**:
```typescript
// Add simple in-memory cache
const cache = new Map<string, any>()

router.get('/', async (req, res) => {
  const cacheKey = `${userType}-tasks`
  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey))
  }
  
  const tasks = await dataAccess.getTasks(userType)
  cache.set(cacheKey, tasks)
  res.json(tasks)
})
```

**Compression**:
```typescript
import compression from 'compression'
app.use(compression())
```

---

## Troubleshooting

### Build Errors

**TypeScript errors**:
```bash
# Check all type errors
npm run build:all
```

**Missing dependencies**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Runtime Errors

**Tasks not persisting**:
- Check write permissions on `task/data/` directory
- Verify user type is set correctly
- Check browser console for API errors

**Styles not loading**:
- Verify `src/styles/index.css` imports all modules
- Check browser devtools for CSS load errors
- Clear browser cache

**API errors**:
- Check `X-User-Type` header is set
- Verify backend server is running
- Check CORS configuration

---

## Git Workflow

### Branching

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "feat: add my feature"

# Push to remote
git push origin feature/my-feature
```

### Commit Messages

Follow conventional commits:
- `feat: add new feature`
- `fix: fix bug`
- `refactor: restructure code`
- `docs: update documentation`
- `style: format code`
- `test: add tests`

### Pull Requests

1. Create PR from feature branch to main
2. Ensure all builds pass
3. Request review
4. Merge when approved

---

## Deployment

See `README.md` for deployment instructions.

Quick overview:
1. Build: `npm run build:all`
2. Copy `dist/` to parent repository
3. Deploy parent repository

CI/CD handles this automatically on push to main.

---

## Resources

### Project Documentation

- **[Architecture](ARCHITECTURE.md)** - System design, patterns, and data flow
- **[API Reference](API.md)** - Complete endpoint documentation
- **[Child App Template](CHILD_APP_TEMPLATE.md)** - Template for creating new apps
- **[README](../README.md)** - Project overview and quick start

### External Resources

- [React Documentation](https://react.dev)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
- [Vite Documentation](https://vitejs.dev)
- [Express Documentation](https://expressjs.com)
- [MDN Web Docs](https://developer.mozilla.org)

---

## Getting Help

- Check `docs/` folder for detailed documentation
- Review existing code for patterns
- Ask in team chat/Slack
- Create GitHub issue for bugs
