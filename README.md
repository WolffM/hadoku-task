# Hadoku Task Manager

**A minimalist task tracking micro-frontend for hadoku.me**

Fast, focused task management with tags, filtering, and multi-user support. Built as a portable micro-frontend that integrates with the parent hadoku_site application.

---

## Quick Start

```bash
# Install and run
npm install
npm run dev
# Open http://localhost:5173?userType=public
```

---

## Features

-  **Quick Task Entry** - Type and press Enter
-  **Tag Support** - Organize with `#tags`
-  **Smart Filtering** - Filter by tag or view all
-  **Drag & Drop** - Move tasks between columns
-  **Multi-User** - Public (in-memory), Friend/Admin (persistent)

---

## Usage

### Creating Tasks
```
Buy groceries [Enter]                    # Plain task
Buy groceries #home [Enter]              # With tag
Fix bug #high priority [Enter]           # Multi-word tag  #high-priority
```

### Actions
- **** Mark complete
- **** Delete task
- **** Edit title
- **+** Add tag
- **Drag** Move between columns

---

## Documentation

 **[Architecture](docs/ARCHITECTURE.md)** - System design, patterns, refactoring details  
 **[API Reference](docs/API.md)** - Complete endpoint documentation  
 **[Development Guide](docs/DEVELOPMENT.md)** - Setup, workflow, contribution guidelines

---

## Build & Deploy

```bash
npm run build          # Client only
npm run build:router   # Server only
npm run build:all      # Both
```

**Output**: `dist/index.js` (~18KB), `dist/style.css` (~8KB), `dist/server/`

**Deploy to**: 
- Client  `hadoku_site/public/mf/task/`
- Server  `hadoku_site/api/apps/task/`

---

## Architecture

### Client (React - 131 lines, 79% reduction)
```
src/
 App.tsx              # Main component
 components/          # TaskItem, TaskLayout
 hooks/               # useTasks, useDragAndDrop, useTaskSort
 lib/                 # Utilities, types
 styles/              # Modular CSS with design tokens
```

### Server (Express - 43 lines, 91% reduction)
```
src/server/
 router.ts            # Main router
 handlers/            # Data access, operations
 routes/              # HTTP endpoints
```

### CSS (7 modular files)
```
src/styles/
 variables.css        # Design tokens
 base.css            # Global resets
 buttons.css         # Button variants
 ...                 # Items, layout, main
```

See **[Architecture docs](docs/ARCHITECTURE.md)** for details.

---

## API

All endpoints at `/api/task`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get all tasks |
| GET | `/stats` | Get statistics |
| POST | `/` | Create task |
| POST | `/:id/complete` | Mark complete |
| PATCH | `/:id` | Update task |
| DELETE | `/:id` | Delete task |
| POST | `/clear` | Clear all (public only) |

See **[API docs](docs/API.md)** for examples.

---

## Integration

### Client
```javascript
import { mount } from '/mf/task/index.js'
mount(document.getElementById('app'), {
  apiUrl: '/api/task',
  userType: 'friend'
})
```

### Server
```typescript
import { createTaskRouter } from './apps/task/router.js'
app.use('/api/task', createTaskRouter({ dataPath: './data/task' }))
```

See **[CHILD_APP_TEMPLATE.md](CHILD_APP_TEMPLATE.md)** for full integration guide.

---

## Development

```bash
npm run dev           # Vite dev server
npm run test:server   # With backend
```

### Adding Features

| Add | Location |
|-----|----------|
| Utility | `src/lib/` |
| API call | `src/hooks/useTasks.ts` |
| Component | `src/components/` |
| Styles | `src/styles/` |
| Operation | `src/server/handlers/` |
| Route | `src/server/routes/` |

**Guidelines**: Keep files <250 lines, use CSS variables, extract reusable logic.

See **[Development docs](docs/DEVELOPMENT.md)** for detailed workflow.

---

## Data Storage

| User Type | Storage | Persistence | Performance | Backup |
|-----------|---------|-------------|-------------|--------|
| Public | In-memory | None | <1ms | None |
| Friend | File + Git | Committed to repo | ~5-10ms | Automatic |
| Admin | File + Git | Committed to repo | ~5-10ms | Automatic |

**Files**: `task/data/friend/`, `task/data/admin/` (committed for backup/sync)

---

## Links

- **Demo**: https://hadoku.me/task
- **Parent**: https://hadoku.me
- **Repo**: https://github.com/WolffM/hadoku-task

---

**Version**: 0.1.0 | **License**: MIT | **Author**: WolffM
