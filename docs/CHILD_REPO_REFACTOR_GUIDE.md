# Child Repo Refactor Guide: API Handlers

**Last Updated:** October 11, 2025

This guide outlines how to refactor a child repository (e.g., `hadoku-task`) to export framework-agnostic API handlers. This allows the parent application (`hadoku_site`) to consume the business logic and adapt it for any environment (local Express, production Cloudflare Worker, etc.), promoting a clean separation of concerns.

## 1. Directory Structure

Create a `server/` directory inside your `src/` folder. This will house all server-side logic, alongside your frontend `src/` code but logically separated.

```
hadoku-task/
├── src/
│   ├── App.tsx              # React frontend code
│   ├── components/          # React components
│   ├── hooks/               # React hooks
│   ├── lib/                 # Frontend utilities
│   └── server/              # Framework-agnostic API logic
│       ├── handlers.ts      # Business logic (getTasks, createTask, etc.)
│       ├── storage.ts       # Defines Storage interface + filesystem implementation
│       ├── types.ts         # Core types (Task, AuthContext) - single source of truth
│       ├── utils.ts         # Server utilities (ULID generation, etc.)
│       ├── index.ts         # Main export file for the package
│       ├── router.ts        # Express adapter (optional, for testing)
│       └── routes-adapter.ts # Route factory (optional)
└── tsconfig.server.json     # TypeScript config for server code
```

## 2. Core Types (`src/server/types.ts`)

Define the core data structures for your application. These types will be shared between the server and the frontend via npm link self-import.

```typescript
// src/server/types.ts
export type ULID = string;

export interface Task {
  id: ULID;
  title: string;
  tag?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string; // When completed or deleted
}

export interface TasksFile {
  version: number;
  tasks: Task[]; // Active tasks only
  updatedAt: string;
}

export interface StatsFile {
  version: number;
  counters: {
    created: number;
    completed: number;
    edited: number;
    deleted: number;
  };
  timeline: Array<{ timestamp: string; action: string; taskId: string }>;
  tasks: Record<ULID, StatsTaskRecord>; // Graveyard for completed/deleted tasks
  updatedAt: string;
}

export interface StatsTaskRecord {
  id: ULID;
  title: string;
  tag?: string;
  createdAt: string;
  closedAt: string;
  reason: 'completed' | 'deleted';
}

export type UserType = 'public' | 'friend' | 'admin';

export interface AuthContext {
  userType: UserType;
}

export interface CreateTaskInput {
  title: string;
  tag?: string;
}

export interface UpdateTaskInput {
  title?: string;
  tag?: string;
}
```

## 3. Storage Interface (`src/server/storage.ts`)

Define the contract for data persistence. The handlers will code against this interface, and the parent application can provide their own implementation (e.g., Cloudflare KV, database). The child repo includes a filesystem implementation for self-hosted deployments.

```typescript
// src/server/storage.ts
import { TasksFile, StatsFile, UserType } from './types.js';

/**
 * Storage interface - defines the contract for data persistence
 */
export interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>;
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>;
  getStats(userType: UserType): Promise<StatsFile>;
  saveStats(userType: UserType, stats: StatsFile): Promise<void>;
}

/**
 * Filesystem storage implementation (included for self-hosted)
 * Parent can use this or implement their own (KV, database, etc.)
 */
export function createStorage(dataPath: string): Storage {
  // Implementation details...
  // In-memory Map for public users
  // File system for friend/admin users
  return {
    async getTasks(userType) { /* ... */ },
    async saveTasks(userType, tasks) { /* ... */ },
    async getStats(userType) { /* ... */ },
    async saveStats(userType, stats) { /* ... */ }
  };
}
```

## 4. Business Logic Handlers (`src/server/handlers.ts`)

Implement the core business logic as pure, framework-agnostic functions. These functions should not know about Express, Hono, or any specific server framework. They take `storage` and `auth` as arguments.

```typescript
// src/server/handlers.ts
import type { Storage } from './storage.js';
import type { AuthContext, Task, CreateTaskInput, UpdateTaskInput } from './types.js';
import { generateULID, now } from './utils.js';

// --- Read Operations ---
export async function getTasks(storage: Storage, auth: AuthContext) {
  const tasksFile = await storage.getTasks(auth.userType);
  // Return only active tasks (filter out closed ones)
  return { tasks: tasksFile.tasks.filter(t => !t.closedAt) };
}

export async function getStats(storage: Storage, auth: AuthContext) {
  const statsFile = await storage.getStats(auth.userType);
  return {
    counters: statsFile.counters,
    timeline: statsFile.timeline,
    graveyard: Object.values(statsFile.tasks) // Completed/deleted tasks
  };
}

// --- Write Operations ---
export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput
): Promise<Task> {
  const tasksFile = await storage.getTasks(auth.userType);
  const statsFile = await storage.getStats(auth.userType);
  
  const newTask: Task = {
    id: generateULID(),
    title: input.title,
    tag: input.tag,
    createdAt: now(),
    updatedAt: now()
  };
  
  // Update tasks file
  tasksFile.tasks.push(newTask);
  tasksFile.updatedAt = now();
  await storage.saveTasks(auth.userType, tasksFile);
  
  // Update stats file
  statsFile.counters.created++;
  statsFile.timeline.push({
    timestamp: now(),
    action: 'created',
    taskId: newTask.id
  });
  statsFile.updatedAt = now();
  await storage.saveStats(auth.userType, statsFile);
  
  return newTask;
}

export async function completeTask(
  storage: Storage,
  auth: AuthContext,
  taskId: string
): Promise<Task> {
  const tasksFile = await storage.getTasks(auth.userType);
  const statsFile = await storage.getStats(auth.userType);
  
  const task = tasksFile.tasks.find(t => t.id === taskId);
  if (!task) throw new Error('Task not found');
  
  // Move to graveyard
  task.closedAt = now();
  task.updatedAt = now();
  
  statsFile.tasks[taskId] = {
    id: task.id,
    title: task.title,
    tag: task.tag,
    createdAt: task.createdAt,
    closedAt: task.closedAt,
    reason: 'completed'
  };
  
  // Remove from active tasks
  tasksFile.tasks = tasksFile.tasks.filter(t => t.id !== taskId);
  tasksFile.updatedAt = now();
  
  // Update stats
  statsFile.counters.completed++;
  statsFile.timeline.push({
    timestamp: now(),
    action: 'completed',
    taskId
  });
  statsFile.updatedAt = now();
  
  await storage.saveTasks(auth.userType, tasksFile);
  await storage.saveStats(auth.userType, statsFile);
  
  return task;
}

// ... other handlers (updateTask, deleteTask, etc.)
```

## 5. Main Export File (`src/server/index.ts`)

Create a single entry point to export all parts of your API package. This is what the parent will import from `@hadoku/task/api`.

```typescript
// src/server/index.ts
/**
 * Task API - Framework-agnostic business logic
 * 
 * This package exports pure functions that handle all task operations.
 * These functions can be used with any web framework (Express, Hono, Cloudflare Workers, etc.)
 * by providing a Storage implementation.
 */

export * as TaskHandlers from './handlers.js';
export * as TaskUtils from './utils.js';
export type { Storage as TaskStorage } from './storage.js';
export type {
  Task,
  TasksFile,
  StatsFile,
  StatsTaskRecord,
  UserType,
  AuthContext,
  CreateTaskInput,
  UpdateTaskInput,
  ULID
} from './types.js';
```

## 6. TypeScript Configuration (`tsconfig.server.json`)

Create a dedicated `tsconfig.json` for the server code to compile to JavaScript for the parent app to use.

```json
// tsconfig.server.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2022",
    "outDir": "./dist/server",
    "rootDir": "./src/server",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/server/**/*"],
  "exclude": ["src/server/**/*.test.ts"]
}
```

## 7. `package.json` Configuration

Update the child repo's `package.json` to add build scripts and define the package exports.

```json
// package.json
{
  "name": "@hadoku/task",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./api": "./src/server/index.ts",
    "./api/types": "./src/server/types.ts"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:router": "tsc -p tsconfig.server.json --moduleResolution bundler",
    "build:all": "npm run build && npm run build:router",
    "preview": "vite preview",
    "test:server": "tsx test-server.ts"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "express": "^4.18.2",
    "tsx": "^4.7.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.0"
  }
}
```

**Key Points**:
- **`./api` export** points to TypeScript source (`./src/server/index.ts`) - parent will compile this
- **`./api/types` export** enables npm link self-import for the frontend
- **`build:router`** compiles handlers to JavaScript (for self-hosted parent deployments)
- **`build:all`** builds both frontend bundle and server handlers

## 8. `.npmignore` (Optional - if publishing to npm)

If you plan to publish this package to npm (not required for GitHub-based child repos), create a `.npmignore` file to ensure the published package is lean.

```
# .npmignore
.vscode/
.github/
node_modules/
test-server.ts
vite.config.ts
*.log

# Keep dist/ and src/server/ for parent consumption
# Exclude local data
task/data/
```

**Note**: For GitHub-based child repos that use GitHub Actions to push builds to the parent, you typically don't need `.npmignore` since you're not publishing to npm.

## Workflow Summary

### Local Development

1.  **Develop:** Make changes to your frontend (`src/App.tsx`, `src/components/`, etc.) and handlers (`src/server/`).
2.  **Dev Server:** Run `npm run dev` to test the frontend.
3.  **Test Server:** Run `npm run test:server` to test handlers with Express adapter.
4.  **Link (Local Dev):**
    -   In child repo: `npm link`
    -   In parent repo: `npm link @hadoku/task`
    -   This enables:
      - Frontend imports types via `@hadoku/task/api/types`
      - Parent imports handlers via `@hadoku/task/api`

### Deployment (GitHub Actions)

1.  **Push to main:** Commit and push changes to the child repo.
2.  **GitHub Actions builds:**
    -   Client: `dist/index.js`, `dist/style.css`
    -   Handlers: `dist/server/*.js`
3.  **GitHub Actions deploys to parent:**
    -   Client → `hadoku_site/public/mf/task/`
    -   Handlers → `hadoku_site/api/apps/task/` (self-hosted)
    -   Handlers → `hadoku_site/functions/task/lib/` (Cloudflare Workers)
4.  **Parent consumes:**
    -   Self-hosted: `import { createTaskRouter } from './apps/task/router.js'`
    -   Cloudflare Workers: `import { TaskHandlers, TaskStorage } from '@hadoku/task/api'`

### Alternative: npm Publish (Optional)

If you want to publish to npm instead of using GitHub Actions:

1.  **Build:** Run `npm run build:all`
2.  **Publish:** `npm publish`
3.  **Parent installs:** `npm install @hadoku/task`
4.  **Parent imports:** `import { TaskHandlers, TaskStorage } from '@hadoku/task/api'`
