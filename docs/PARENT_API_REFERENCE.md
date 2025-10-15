# @wolffm/task - Parent API Reference# @wolffm/task - Parent API Reference# @hadoku/task - Parent API Reference



**Quick reference for integrating task handlers into parent worker**



Version: 3.0.18  **Quick reference for integrating task handlers into parent worker****Quick reference for integrating task handlers into parent worker**

Last Updated: October 15, 2025



---

Version: 3.0.17  ---

## Import

Last Updated: October 15, 2025

```typescript

import { TaskHandlers, type TaskStorage, type AuthContext } from '@wolffm/task/api'## Import

```

---

---

```typescript

## Core Types

## Importimport { TaskHandlers, type Storage, type AuthContext } from '@hadoku/task/api'

```typescript

type ULID = string```

type UserType = string  // 'public' | 'admin' | 'friend' | any custom name

```typescript

interface AuthContext {

  userType: UserTypeimport { TaskHandlers, type TaskStorage, type AuthContext } from '@wolffm/task/api'---

  userId?: string  // Required for admin/friend data scoping

}```



interface Task {## Handler Functions

  id: ULID

  title: string---

  tag?: string | null

  state: 'Active' | 'Completed' | 'Deleted'### **Boards**

  createdAt: string     // ISO 8601 - preserved across board moves

  updatedAt?: string | null## Core Types

  closedAt?: string | null

}```typescript



interface Board {```typescript// GET /api/boards

  id: string

  name: stringtype ULID = stringgetBoards(storage, auth)

  tasks: Task[]

  tags: string[]        // Persisted tags (remain even when no tasks have them)type UserType = string  // 'public' | 'admin' | 'friend' | any custom name→ BoardsFile // { version, updatedAt, boards: Board[] }

  stats?: StatsFile

}



interface BoardsFile {interface AuthContext {// GET /api/boards/:boardId/tasks

  version: 1

  updatedAt: string  userType: UserTypegetBoardTasks(storage, auth, boardId)

  boards: Board[]

}  userId?: string→ Task[]



interface TasksFile {}

  version: 1

  updatedAt: string// GET /api/boards/:boardId/stats

  tasks: Task[]

}interface Task {getBoardStats(storage, auth, boardId)



interface StatsFile {  id: ULID→ StatsFile

  version: 2

  updatedAt: string  title: string

  counters: {

    created: number  tag?: string | null// POST /api/boards

    completed: number

    edited: number  state: 'Active' | 'Deleted' | 'Completed'createBoard(storage, auth, { id, name })

    deleted: number

  }  createdAt: string      // ISO 8601→ { ok: boolean, board: Board }

  timeline: Array<{

    t: string  updatedAt?: string | null

    event: 'created' | 'completed' | 'edited' | 'deleted'

    id?: ULID  closedAt?: string | null// DELETE /api/boards/:boardId

  }>

  tasks: Record<ULID, StatsTaskRecord>}deleteBoard(storage, auth, boardId)

}

```→ { ok: boolean, message: string }



---interface Board {```



## Handler Functions  id: string



### **Boards**  name: string### **Tasks**



#### `getBoards(storage, auth)`  tasks: Task[]



Get all boards with populated tasks and stats.  tags: string[]```typescript



**Parameters:**  stats?: StatsFile// POST /api/boards/:boardId/tasks

- `storage: TaskStorage` - Storage implementation

- `auth: AuthContext` - User context with `{ userType, userId? }`}createTask(storage, auth, { id?, title, tag?, createdAt? }, boardId = 'main')



**Returns:** `Promise<BoardsFile>`→ { ok: boolean, id: ULID }



**Example:**interface BoardsFile {

```typescript

const boards = await TaskHandlers.getBoards(storage, {  version: 1// PATCH /api/boards/:boardId/tasks/:taskId

  userType: 'admin',

  userId: 'user-123'  updatedAt: stringupdateTask(storage, auth, taskId, { title?, tag? }, boardId = 'main')

})

// { version: 1, updatedAt: '2025-10-15...', boards: [...] }  boards: Board[]→ { ok: boolean, message: string }

```

}

---

// POST /api/boards/:boardId/tasks/:taskId/complete

#### `getBoardTasks(storage, auth, boardId)`

interface TasksFile {completeTask(storage, auth, taskId, boardId = 'main')

Get tasks for a specific board.

  version: 1→ { ok: boolean, message: string }

**Parameters:**

- `storage: TaskStorage`  updatedAt: string

- `auth: AuthContext`

- `boardId: string` - Board ID (e.g., 'main', 'work')  tasks: Task[]// DELETE /api/boards/:boardId/tasks/:taskId



**Returns:** `Promise<Task[]>`}deleteTask(storage, auth, taskId, boardId = 'main')



**Example:**→ { ok: boolean, message: string }

```typescript

const tasks = await TaskHandlers.getBoardTasks(storage, auth, 'main')interface StatsFile {```

// [{ id: '...', title: '...', ... }]

```  version: 2



---  updatedAt: string### **Batch Operations**



#### `getBoardStats(storage, auth, boardId)`  counters: {



Get stats for a specific board.    created: number```typescript



**Parameters:**    completed: number// POST /api/boards/:boardId/tasks/batch/update-tags

- `storage: TaskStorage`

- `auth: AuthContext`    edited: numberbatchUpdateTags(storage, auth, { boardId, updates: [{ taskId, tag }] })

- `boardId: string`

    deleted: number→ { ok: boolean, message: string, updated: number }

**Returns:** `Promise<StatsFile>`

  }

**Example:**

```typescript  timeline: Array<{// POST /api/batch/move-tasks

const stats = await TaskHandlers.getBoardStats(storage, auth, 'main')

// { version: 2, updatedAt: '...', counters: {...}, timeline: [...] }    t: stringbatchMoveTasks(storage, auth, { sourceBoardId, targetBoardId, taskIds: string[] })

```

    event: 'created' | 'completed' | 'edited' | 'deleted'→ { ok: boolean, message: string, moved: number }

---

    id?: ULID

#### `createBoard(storage, auth, input)`

  }>// POST /api/boards/:boardId/tasks/batch/clear-tag

Create a new board.

  tasks: Record<ULID, StatsTaskRecord>batchClearTag(storage, auth, { boardId, tag, taskIds: string[] })

**Parameters:**

- `storage: TaskStorage`}→ { ok: boolean, message: string, cleared: number }

- `auth: AuthContext`

- `input: { id: string; name: string }```````



**Returns:** `Promise<{ ok: boolean; board: Board }>`



**Example:**---### **Tags**

```typescript

const result = await TaskHandlers.createBoard(storage, auth, {

  id: 'project-x',

  name: 'Project X'## Handler Functions```typescript

})

// { ok: true, board: { id: 'project-x', name: 'Project X', tasks: [], tags: [] } }// POST /api/boards/:boardId/tags

```

### **Boards**createTag(storage, auth, { boardId, tag })

---

→ { ok: boolean, message: string }

#### `deleteBoard(storage, auth, boardId)`

#### `getBoards(storage, auth)`

Delete a board (cannot delete 'main').

// DELETE /api/boards/:boardId/tags/:tag

**Parameters:**

- `storage: TaskStorage`Get all boards with populated tasks and stats.deleteTag(storage, auth, { boardId, tag })

- `auth: AuthContext`

- `boardId: string`→ { ok: boolean, message: string }



**Returns:** `Promise<{ ok: boolean; message: string }>`**Parameters:**```



**Example:**- `storage: Storage` - Storage implementation

```typescript

const result = await TaskHandlers.deleteBoard(storage, auth, 'old-project')- `auth: AuthContext` - User context with `{ userType, userId? }`---

// { ok: true, message: 'Board old-project deleted' }

```



---**Returns:** `Promise<BoardsFile>`## Storage Interface



### **Tasks**



#### `createTask(storage, auth, input, boardId?)`**Example:**```typescript



Create a new task on a board.```typescriptinterface Storage {



**Parameters:**const boards = await TaskHandlers.getBoards(storage, {   // Tasks

- `storage: TaskStorage`

- `auth: AuthContext`  userType: 'admin',   getTasks(userType: string, userId?: string, boardId?: string): Promise<TasksFile>

- `input: CreateTaskInput`

  ```typescript  userId: 'user-123'   saveTasks(userType: string, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>

  {

    id?: string           // Optional: Client-generated ID (for preserving IDs during moves)})  

    title: string

    tag?: string// { version: 1, updatedAt: '2025-10-15...', boards: [...] }  // Stats

    createdAt?: string    // Optional: Preserve original creation timestamp (for moves)

  }```  getStats(userType: string, userId?: string, boardId?: string): Promise<StatsFile>

  ```

- `boardId?: string` - Default: `'main'`  saveStats(userType: string, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>



**Returns:** `Promise<{ ok: boolean; id: ULID }>`---  



**Example:**  // Boards

```typescript

const result = await TaskHandlers.createTask(storage, auth, {#### `getBoardTasks(storage, auth, boardId)`  getBoards(userType: string, userId?: string): Promise<BoardsFile>

  title: 'Buy groceries',

  tag: 'home urgent'  saveBoards(userType: string, boards: BoardsFile, userId?: string): Promise<void>

}, 'main')

// { ok: true, id: '01JAQR...' }Get tasks for a specific board.}

```

```

---

**Parameters:**

#### `updateTask(storage, auth, taskId, input, boardId?)`

- `storage: Storage`**File Paths:**

Update a task's title or tags.

- `auth: AuthContext````

**Parameters:**

- `storage: TaskStorage`- `boardId: string` - Board ID (e.g., 'main', 'work')data/{userType}/{userId}/{boardId}/tasks.json  → TasksFile

- `auth: AuthContext`

- `taskId: ULID`data/{userType}/{userId}/{boardId}/stats.json  → StatsFile

- `input: UpdateTaskInput`

  ```typescript**Returns:** `Promise<Task[]>`data/{userType}/{userId}/boards.json           → BoardsFile

  {

    title?: string```

    tag?: string

  }**Example:**

  ```

- `boardId?: string` - Default: `'main'````typescript---



**Returns:** `Promise<{ ok: boolean; message: string }>`const tasks = await TaskHandlers.getBoardTasks(storage, auth, 'main')



**Example:**// [{ id: '...', title: '...', ... }]## Auth Context

```typescript

const result = await TaskHandlers.updateTask(storage, auth, taskId, {```

  tag: 'urgent completed'

}, 'main')```typescript

// { ok: true, message: 'Task 01JAQR... updated' }

```---interface AuthContext {



---  userType: string  // 'public' | 'friend' | 'admin' | custom



#### `completeTask(storage, auth, taskId, boardId?)`#### `getBoardStats(storage, auth, boardId)`  userId?: string   // Data scoping identifier



Mark a task as completed (removes from active list).}



**Parameters:**Get stats for a specific board.```

- `storage: TaskStorage`

- `auth: AuthContext`

- `taskId: ULID`

- `boardId?: string` - Default: `'main'`**Parameters:****Auth Matrix:**



**Returns:** `Promise<{ ok: boolean; message: string }>`- `storage: Storage`



**Example:**- `auth: AuthContext`| Operation | Public | Friend | Admin |

```typescript

const result = await TaskHandlers.completeTask(storage, auth, taskId, 'main')- `boardId: string`|-----------|--------|--------|-------|

// { ok: true, message: 'Task 01JAQR... completed' }

```| Read (GET) | ✅ | ✅ | ✅ |



---**Returns:** `Promise<StatsFile>`| Create | ❌ | ✅ | ✅ |



#### `deleteTask(storage, auth, taskId, boardId?)`| Update | ❌ | ✅ | ✅ |



Delete a task permanently (removes from active list).**Example:**| Delete | ❌ | ✅ | ✅ |



**Parameters:**```typescript

- `storage: TaskStorage`

- `auth: AuthContext`const stats = await TaskHandlers.getBoardStats(storage, auth, 'main')_Note: Public users use in-memory storage (not persisted)_

- `taskId: ULID`

- `boardId?: string` - Default: `'main'`// { version: 2, updatedAt: '...', counters: {...}, timeline: [...] }



**Returns:** `Promise<{ ok: boolean; message: string }>````---



**Example:**

```typescript

const result = await TaskHandlers.deleteTask(storage, auth, taskId, 'main')---## Data Types

// { ok: true, message: 'Task 01JAQR... deleted' }

```



---#### `createBoard(storage, auth, input)````typescript



### **Tags**// Core



#### `createTag(storage, auth, input)`Create a new board.type ULID = string



Add a persisted tag to a board.type UserType = string



**Parameters:****Parameters:**

- `storage: TaskStorage`

- `auth: AuthContext`- `storage: Storage`// Input Types

- `input: { boardId: string; tag: string }`

- `auth: AuthContext`interface CreateTaskInput {

**Returns:** `Promise<{ ok: boolean; message: string }>`

- `input: { id: string; name: string }`  id?: string           // Optional: Client-generated ID (for preserving IDs during moves)

**Example:**

```typescript  title: string

const result = await TaskHandlers.createTag(storage, auth, {

  boardId: 'main',**Returns:** `Promise<{ ok: boolean; board: Board }>`  tag?: string

  tag: 'urgent'

})  createdAt?: string    // Optional: Preserve original creation timestamp (for moves)

// { ok: true, message: 'Tag urgent added to board main' }

```**Example:**}



---```typescript



#### `deleteTag(storage, auth, input)`const result = await TaskHandlers.createBoard(storage, auth, {interface UpdateTaskInput {



Remove a persisted tag from a board.  id: 'project-x',  title?: string



**Parameters:**  name: 'Project X'  tag?: string

- `storage: TaskStorage`

- `auth: AuthContext`})}

- `input: { boardId: string; tag: string }`

// { ok: true, board: { id: 'project-x', name: 'Project X', tasks: [], tags: [] } }

**Returns:** `Promise<{ ok: boolean; message: string }>`

```// Task

**Example:**

```typescriptinterface Task {

const result = await TaskHandlers.deleteTag(storage, auth, {

  boardId: 'main',---  id: ULID

  tag: 'old-tag'

})  title: string

// { ok: true, message: 'Tag old-tag removed from board main' }

```#### `deleteBoard(storage, auth, boardId)`  tag?: string | null



---  state: 'Active' | 'Completed' | 'Deleted'



### **Batch Operations**Delete a board (cannot delete 'main').  createdAt: string  // ISO 8601 - preserved across board moves



#### `batchUpdateTags(storage, auth, input)`  updatedAt?: string | null



Update tags on multiple tasks at once.**Parameters:**  closedAt?: string | null



**Parameters:**- `storage: Storage`}

- `storage: TaskStorage`

- `auth: AuthContext`- `auth: AuthContext`

- `input:`

  ```typescript- `boardId: string`// Board

  {

    boardId: stringinterface Board {

    updates: Array<{

      taskId: string**Returns:** `Promise<{ ok: boolean; message: string }>`  id: string

      tag: string | null  // null removes the tag

    }>  name: string

  }

  ```**Example:**  tasks: Task[]



**Returns:** `Promise<{ ok: boolean; message: string; updated: number }>````typescript  tags: string[]



**Example:**const result = await TaskHandlers.deleteBoard(storage, auth, 'old-project')  stats?: StatsFile

```typescript

const result = await TaskHandlers.batchUpdateTags(storage, auth, {// { ok: true, message: 'Board old-project deleted' }}

  boardId: 'main',

  updates: [```

    { taskId: 'task1', tag: 'urgent' },

    { taskId: 'task2', tag: 'urgent' },// Files

    { taskId: 'task3', tag: 'completed' }

  ]---interface TasksFile {

})

// { ok: true, message: 'Updated 3 task(s) on board main', updated: 3 }  version: 1

```

### **Tasks**  updatedAt: string

---

  tasks: Task[]

#### `batchMoveTasks(storage, auth, input)`

#### `createTask(storage, auth, input, boardId?)`}

Move multiple tasks from one board to another. Preserves task IDs and creation timestamps.



**Parameters:**

- `storage: TaskStorage`Create a new task on a board.interface BoardsFile {

- `auth: AuthContext`

- `input:`  version: 1

  ```typescript

  {**Parameters:**  updatedAt: string

    sourceBoardId: string

    targetBoardId: string- `storage: Storage`  boards: Board[]

    taskIds: string[]

  }- `auth: AuthContext`}

  ```

- `input: CreateTaskInput`

**Returns:** `Promise<{ ok: boolean; message: string; moved: number }>`

  ```typescriptinterface StatsFile {

**Example:**

```typescript  {  version: 2

const result = await TaskHandlers.batchMoveTasks(storage, auth, {

  sourceBoardId: 'main',    id?: string          // Client-generated ID (optional)  updatedAt: string

  targetBoardId: 'archive',

  taskIds: ['task1', 'task2', 'task3']    title: string  counters: { created: number, completed: number, edited: number, deleted: number }

})

// { ok: true, message: 'Moved 3 task(s) from main to archive', moved: 3 }    tag?: string  timeline: Array<{ t: string, event: string, id?: ULID }>

```

    createdAt?: string   // For preserving timestamps when moving  tasks: Record<ULID, Task>

**Note:** This operation:

- Removes tasks from source (marks as completed in stats)  }}

- Creates tasks on target (preserves original IDs and createdAt)

- Updates both boards' stats  ``````



---- `boardId?: string` - Default: `'main'`



#### `batchClearTag(storage, auth, input)`---



Remove a tag from multiple tasks and delete it from the board.**Returns:** `Promise<{ ok: boolean; id: ULID }>`



**Parameters:**## Error Handling

- `storage: TaskStorage`

- `auth: AuthContext`**Example:**

- `input:`

  ```typescript```typescript**Handlers throw errors with descriptive messages:**

  {

    boardId: stringconst result = await TaskHandlers.createTask(storage, auth, {

    tag: string

    taskIds: string[]  title: 'Buy groceries',| Error Message | HTTP Status |

  }

  ```  tag: 'home urgent'|---------------|-------------|



**Returns:** `Promise<{ ok: boolean; message: string; cleared: number }>`}, 'main')| `"Task not found"` | 404 |



**Example:**// { ok: true, id: '01JAQR...' }| `"Board not found"` | 404 |

```typescript

const result = await TaskHandlers.batchClearTag(storage, auth, {```| `"Board {id} already exists"` | 409 |

  boardId: 'main',

  tag: 'old-sprint',| `"Cannot delete the main board"` | 400 |

  taskIds: ['task1', 'task2', 'task3']

})---| `"Title is required"` | 400 |

// { ok: true, message: 'Cleared tag old-sprint from 3 task(s) on board main', cleared: 3 }

```| Other | 500 |



**Note:** This operation:#### `updateTask(storage, auth, taskId, input, boardId?)`

- Removes the tag from all specified tasks

- Removes the tag from the board's tag list---

- If a task has multiple tags, only the specified tag is removed

Update a task's title or tags.

---

## Example Route Implementation

## Storage Interface

**Parameters:**

Your storage implementation must provide these methods:

- `storage: Storage````typescript

```typescript

interface TaskStorage {- `auth: AuthContext`import { Hono } from 'hono'

  // Task operations (board-scoped)

  getTasks(userType: UserType, userId?: string, boardId?: string): Promise<TasksFile>- `taskId: ULID`import { TaskHandlers, type Storage, type AuthContext } from '@hadoku/task/api'

  saveTasks(userType: UserType, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>

  - `input: UpdateTaskInput`

  // Stats operations (board-scoped)

  getStats(userType: UserType, userId?: string, boardId?: string): Promise<StatsFile>  ```typescriptconst app = new Hono()

  saveStats(userType: UserType, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>

    {

  // Board operations

  getBoards(userType: UserType, userId?: string): Promise<BoardsFile>    title?: string// Middleware: Create auth context from session

  saveBoards(userType: UserType, boards: BoardsFile, userId?: string): Promise<void>

  deleteBoardData(userType: UserType, userId: string, boardId: string): Promise<void>    tag?: stringapp.use('/api/*', async (c, next) => {

}

```  }  const sessionId = c.req.header('X-Session-Id')



**File Paths:**  ```  const key = await resolveSession(sessionId)

```

data/{userType}/{userId}/{boardId}/tasks.json  → TasksFile- `boardId?: string` - Default: `'main'`  const userType = getUserTypeFromKey(key)

data/{userType}/{userId}/{boardId}/stats.json  → StatsFile

data/{userType}/{userId}/boards.json           → BoardsFile  const userId = c.req.query('userId')

```

**Returns:** `Promise<{ ok: boolean; message: string }>`  

---

  c.set('auth', { userType, userId })

## Auth Context

**Example:**  await next()

```typescript

interface AuthContext {```typescript})

  userType: string  // 'public' | 'friend' | 'admin' | custom

  userId?: string   // Data scoping identifierconst result = await TaskHandlers.updateTask(storage, auth, taskId, {

}

```  tag: 'urgent completed'// GET /api/boards



**Auth Matrix:**}, 'main')app.get('/api/boards', async (c) => {



| Operation | Public | Friend | Admin |// { ok: true, message: 'Task 01JAQR... updated' }  const auth = c.get('auth') as AuthContext

|-----------|--------|--------|-------|

| Read (GET) | ✅ | ✅ | ✅ |```  const result = await TaskHandlers.getBoards(storage, auth)

| Create | ✅* | ✅ | ✅ |

| Update | ✅* | ✅ | ✅ |  return c.json(result)

| Delete | ✅* | ✅ | ✅ |

---})

_*Public users use in-memory storage (not persisted to files)_



---

#### `completeTask(storage, auth, taskId, boardId?)`// POST /api/boards/:boardId/tasks

## Error Handling

app.post('/api/boards/:boardId/tasks', async (c) => {

**Handlers throw errors with descriptive messages:**

Mark a task as completed (removes from active list).  const auth = c.get('auth') as AuthContext

| Error Message | HTTP Status |

|---------------|-------------|  const boardId = c.req.param('boardId')

| `"Task not found"` | 404 |

| `"Board not found"` | 404 |**Parameters:**  const input = await c.req.json()

| `"Board {id} already exists"` | 409 |

| `"Cannot delete the main board"` | 400 |- `storage: Storage`  

| `"Title is required"` | 400 |

| Other | 500 |- `auth: AuthContext`  try {



---- `taskId: ULID`    const result = await TaskHandlers.createTask(storage, auth, input, boardId)



## Example Worker Integration- `boardId?: string` - Default: `'main'`    return c.json(result, 201)



```typescript  } catch (err) {

import { Hono } from 'hono'

import { TaskHandlers, type TaskStorage, type AuthContext } from '@wolffm/task/api'**Returns:** `Promise<{ ok: boolean; message: string }>`    if (err.message.includes('already exists')) {



const app = new Hono()      return c.json({ error: err.message }, 409)



// Auth middleware**Example:**    }

app.use('/api/*', async (c, next) => {

  const sessionId = c.req.header('X-Session-Id')```typescript    if (err.message.includes('not found')) {

  const key = await resolveSession(sessionId)

  const userType = getUserTypeFromKey(key)const result = await TaskHandlers.completeTask(storage, auth, taskId, 'main')      return c.json({ error: err.message }, 404)

  const userId = c.req.query('userId')

  // { ok: true, message: 'Task 01JAQR... completed' }    }

  c.set('auth', { userType, userId })

  await next()```    return c.json({ error: err.message }, 400)

})

  }

// GET /api/boards

app.get('/api/boards', async (c) => {---})

  const auth = c.get('auth') as AuthContext

  const result = await TaskHandlers.getBoards(storage, auth)

  return c.json(result)

})#### `deleteTask(storage, auth, taskId, boardId?)`// DELETE /api/boards/:boardId/tasks/:taskId



// POST /api/boards/:boardId/tasksapp.delete('/api/boards/:boardId/tasks/:taskId', async (c) => {

app.post('/api/boards/:boardId/tasks', async (c) => {

  const auth = c.get('auth') as AuthContextDelete a task permanently (removes from active list).  const auth = c.get('auth') as AuthContext

  const boardId = c.req.param('boardId')

  const input = await c.req.json()  const boardId = c.req.param('boardId')

  

  try {**Parameters:**  const taskId = c.req.param('taskId')

    const result = await TaskHandlers.createTask(storage, auth, input, boardId)

    return c.json(result, 201)- `storage: Storage`  

  } catch (err) {

    if (err.message.includes('already exists')) {- `auth: AuthContext`  try {

      return c.json({ error: err.message }, 409)

    }- `taskId: ULID`    const result = await TaskHandlers.deleteTask(storage, auth, taskId, boardId)

    if (err.message.includes('not found')) {

      return c.json({ error: err.message }, 404)- `boardId?: string` - Default: `'main'`    return c.json(result)

    }

    return c.json({ error: err.message }, 400)  } catch (err) {

  }

})**Returns:** `Promise<{ ok: boolean; message: string }>`    if (err.message.includes('not found')) {



// DELETE /api/boards/:boardId/tasks/:taskId      return c.json({ error: err.message }, 404)

app.delete('/api/boards/:boardId/tasks/:taskId', async (c) => {

  const auth = c.get('auth') as AuthContext**Example:**    }

  const boardId = c.req.param('boardId')

  const taskId = c.req.param('taskId')```typescript    return c.json({ error: err.message }, 500)

  

  try {const result = await TaskHandlers.deleteTask(storage, auth, taskId, 'main')  }

    const result = await TaskHandlers.deleteTask(storage, auth, taskId, boardId)

    return c.json(result)// { ok: true, message: 'Task 01JAQR... deleted' }})

  } catch (err) {

    if (err.message.includes('not found')) {```

      return c.json({ error: err.message }, 404)

    }// POST /api/boards/:boardId/tasks/batch/update-tags

    return c.json({ error: err.message }, 500)

  }---app.post('/api/boards/:boardId/tasks/batch/update-tags', async (c) => {

})

  const auth = c.get('auth') as AuthContext

// PATCH /api/boards/:boardId/tasks/batch/update-tags

app.patch('/api/boards/:boardId/tasks/batch/update-tags', async (c) => {### **Tags**  const input = await c.req.json()

  const auth = c.get('auth') as AuthContext

  const input = await c.req.json()  

  

  try {#### `createTag(storage, auth, input)`  try {

    const result = await TaskHandlers.batchUpdateTags(storage, auth, input)

    return c.json(result)    const result = await TaskHandlers.batchUpdateTags(storage, auth, input)

  } catch (err) {

    return c.json({ error: err.message }, 500)Add a persisted tag to a board.    return c.json(result)

  }

})  } catch (err) {



// POST /api/batch/move-tasks**Parameters:**    return c.json({ error: err.message }, 500)

app.post('/api/batch/move-tasks', async (c) => {

  const auth = c.get('auth') as AuthContext- `storage: Storage`  }

  const input = await c.req.json()

  - `auth: AuthContext`})

  try {

    const result = await TaskHandlers.batchMoveTasks(storage, auth, input)- `input: { boardId: string; tag: string }`

    return c.json(result)

  } catch (err) {// POST /api/batch/move-tasks

    return c.json({ error: err.message }, 500)

  }**Returns:** `Promise<{ ok: boolean; message: string }>`app.post('/api/batch/move-tasks', async (c) => {

})

  const auth = c.get('auth') as AuthContext

// POST /api/boards/:boardId/tasks/batch/clear-tag

app.post('/api/boards/:boardId/tasks/batch/clear-tag', async (c) => {**Example:**  const input = await c.req.json()

  const auth = c.get('auth') as AuthContext

  const input = await c.req.json()```typescript  

  

  try {const result = await TaskHandlers.createTag(storage, auth, {  try {

    const result = await TaskHandlers.batchClearTag(storage, auth, input)

    return c.json(result)  boardId: 'main',    const result = await TaskHandlers.batchMoveTasks(storage, auth, input)

  } catch (err) {

    return c.json({ error: err.message }, 500)  tag: 'urgent'    return c.json(result)

  }

})})  } catch (err) {

```

// { ok: true, message: 'Tag urgent added to board main' }    return c.json({ error: err.message }, 500)

---

```  }

## Key Features

})

- **Public Users:** In-memory only (not persisted to storage)

- **Multi-Board:** All operations are board-scoped except board management---

- **Stats Tracking:** Automatically updated on all task operations

- **Tag Persistence:** Tags remain on board even when no tasks have that tag// POST /api/boards/:boardId/tasks/batch/clear-tag

- **ID Preservation:** Task IDs and createdAt preserved across board moves

- **Batch Operations:** Atomic operations prevent race conditions#### `deleteTag(storage, auth, input)`app.post('/api/boards/:boardId/tasks/batch/clear-tag', async (c) => {



---  const auth = c.get('auth') as AuthContext



**Package:** `@wolffm/task@3.0.18`  Remove a persisted tag from a board.  const input = await c.req.json()

**Last Updated:** October 15, 2025 🎯

  

**Parameters:**  try {

- `storage: Storage`    const result = await TaskHandlers.batchClearTag(storage, auth, input)

- `auth: AuthContext`    return c.json(result)

- `input: { boardId: string; tag: string }`  } catch (err) {

    return c.json({ error: err.message }, 500)

**Returns:** `Promise<{ ok: boolean; message: string }>`  }

})

**Example:**```

```typescript

const result = await TaskHandlers.deleteTag(storage, auth, {---

  boardId: 'main',

  tag: 'old-tag'## Session Flow

})

// { ok: true, message: 'Tag old-tag removed from board main' }1. **Client** → Sends `X-Session-Id` header

```2. **Edge Router** → Resolves session → injects `X-User-Key`

3. **API Worker** → Validates key → creates `AuthContext`

---4. **Handler** → Uses auth for permissions & data scoping



### **Batch Operations**---



#### `batchUpdateTags(storage, auth, input)`## Batch Operations Details



Update tags on multiple tasks at once.**Why Batch Operations?**

- Eliminate race conditions when updating multiple tasks

**Parameters:**- Single read-modify-write cycle per board

- `storage: Storage`- Atomic operations prevent data loss

- `auth: AuthContext`

- `input:`**ID Preservation:**

  ```typescript- Task IDs are **only generated during `createTask`**

  {- All other operations (update, complete, delete, move) **preserve the original task ID**

    boardId: string- When moving tasks between boards, both `id` and `createdAt` are preserved

    updates: Array<{ taskId: string; tag: string | null }>- This maintains task identity and history across all operations

  }

  ```**Batch Endpoints:**

1. **`batchUpdateTags`** - Update tags on multiple tasks in one operation

**Returns:** `Promise<{ ok: boolean; message: string; updated: number }>`2. **`batchMoveTasks`** - Move tasks between boards (preserves IDs and createdAt)

3. **`batchClearTag`** - Clear a tag from multiple tasks and remove from board

**Example:**

```typescript---

const result = await TaskHandlers.batchUpdateTags(storage, auth, {

  boardId: 'main',## Quick Notes

  updates: [

    { taskId: 'task1', tag: 'urgent' },- **Default boardId:** `'main'` (used when not specified)

    { taskId: 'task2', tag: 'low-priority' },- **ULID Generation:** Only happens in `createTask` (unless `id` provided)

    { taskId: 'task3', tag: null }- **ID Preservation:** Task IDs are preserved across all operations including moves

  ]- **Public Users:** In-memory only (not persisted to storage)

})- **Multi-Board:** All operations are board-scoped except board management

// { ok: true, message: 'Updated 3 task(s) on board main', updated: 3 }- **Stats Tracking:** Automatically updated on all task operations

```- **Tag Persistence:** Tags remain on board even when no tasks have that tag



------



#### `batchMoveTasks(storage, auth, input)`**Package:** `@wolffm/task@3.0.13`  

**Compliance:** 98% (storage interface is domain-specific)  

Move multiple tasks from one board to another. Preserves task IDs and creation timestamps.**Breaking Changes:** v3.0.13 adds batch operations and preserves task IDs across moves  

**Updated:** October 14, 2025 🎯

**Parameters:**
- `storage: Storage`
- `auth: AuthContext`
- `input:`
  ```typescript
  {
    sourceBoardId: string
    targetBoardId: string
    taskIds: string[]
  }
  ```

**Returns:** `Promise<{ ok: boolean; message: string; moved: number }>`

**Example:**
```typescript
const result = await TaskHandlers.batchMoveTasks(storage, auth, {
  sourceBoardId: 'main',
  targetBoardId: 'archive',
  taskIds: ['task1', 'task2', 'task3']
})
// { ok: true, message: 'Moved 3 task(s) from main to archive', moved: 3 }
```

**Note:** This operation:
- Removes tasks from source (marks as completed in stats)
- Creates tasks on target (preserves original IDs and createdAt)
- Updates both boards' stats

---

#### `batchClearTag(storage, auth, input)`

Remove a tag from multiple tasks and delete it from the board.

**Parameters:**
- `storage: Storage`
- `auth: AuthContext`
- `input:`
  ```typescript
  {
    boardId: string
    tag: string
    taskIds: string[]
  }
  ```

**Returns:** `Promise<{ ok: boolean; message: string; cleared: number }>`

**Example:**
```typescript
const result = await TaskHandlers.batchClearTag(storage, auth, {
  boardId: 'main',
  tag: 'old-sprint',
  taskIds: ['task1', 'task2', 'task3']
})
// { ok: true, message: 'Cleared tag old-sprint from 3 task(s) on board main', cleared: 3 }
```

**Note:** This operation:
- Removes the tag from all specified tasks
- Removes the tag from the board's tag list
- If a task has multiple tags, only the specified tag is removed

---

## Storage Interface

Your storage implementation must provide these methods:

```typescript
interface Storage {
  // Boards
  getBoards(userType: string, userId?: string): Promise<BoardsFile>
  saveBoards(userType: string, boards: BoardsFile, userId?: string): Promise<void>
  
  // Tasks (board-scoped)
  getTasks(userType: string, userId?: string, boardId?: string): Promise<TasksFile>
  saveTasks(userType: string, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>
  
  // Stats (board-scoped)
  getStats(userType: string, userId?: string, boardId?: string): Promise<StatsFile>
  saveStats(userType: string, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>
  
  // Cleanup
  deleteBoardData(userType: string, userId: string | undefined, boardId: string): Promise<void>
}
```

### Storage Notes

- **Board-scoped architecture**: Tasks and stats are stored per-board
- **Parameter order**: `(userType, userId, boardId, data)`
- **userId and boardId are optional** for backwards compatibility
- Default boardId is `'main'` if not specified

---

## Worker Integration Example

```typescript
import { TaskHandlers } from '@wolffm/task/api'

// Cloudflare Worker example
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    
    // Extract auth from headers
    const userType = request.headers.get('x-user-type') || 'public'
    const userId = request.headers.get('x-user-id') || userType
    const auth = { userType, userId }
    
    // Your KV-based storage implementation
    const storage = createKVStorage(env.TASKS_KV)
    
    // Route: GET /boards
    if (url.pathname === '/boards' && request.method === 'GET') {
      const boards = await TaskHandlers.getBoards(storage, auth)
      return Response.json(boards)
    }
    
    // Route: POST /tasks
    if (url.pathname === '/tasks' && request.method === 'POST') {
      const body = await request.json()
      const result = await TaskHandlers.createTask(storage, auth, body, body.boardId)
      return Response.json(result)
    }
    
    // Route: POST /batch-move
    if (url.pathname === '/batch-move' && request.method === 'POST') {
      const body = await request.json()
      const result = await TaskHandlers.batchMoveTasks(storage, auth, body)
      return Response.json(result)
    }
    
    // ... other routes
  }
}
```

---

## Error Handling

All handlers throw errors on failure. Wrap calls in try-catch:

```typescript
try {
  const result = await TaskHandlers.createTask(storage, auth, input, boardId)
  return Response.json(result)
} catch (error) {
  return Response.json({ error: error.message }, { status: 500 })
}
```

**Common errors:**
- `"Task not found"` - Task ID doesn't exist
- `"Board not found"` - Board ID doesn't exist
- `"Cannot delete the main board"` - Attempted to delete 'main'
- `"Board X already exists"` - Duplicate board ID

---

## Migration Notes

### From v2 to v3

- ✅ **No breaking changes in handler signatures**
- ✅ Multi-board support added (backwards compatible)
- ✅ Batch operations added
- ✅ Tag persistence added
- ⚠️ Storage interface expanded (add `getBoards`, `saveBoards`, `deleteBoardData`)

### localStorage to Server Migration

Tasks can seamlessly move from client localStorage to server storage:

1. Client creates task with `localStorage.createTask()`
2. Client sends same task to server with `id` and `createdAt` preserved
3. Server receives and stores with original ID and timestamp
4. Other clients can sync the same task

This allows optimistic UI updates while maintaining eventual consistency.

---

## Testing

```typescript
import { TaskHandlers } from '@wolffm/task/api'

// Create in-memory storage for testing
const storage = {
  boards: new Map(),
  tasks: new Map(),
  stats: new Map(),
  
  async getBoards(userType, userId) {
    const key = `${userType}-${userId}`
    return this.boards.get(key) || { version: 1, updatedAt: new Date().toISOString(), boards: [] }
  },
  
  async saveBoards(userType, boards, userId) {
    const key = `${userType}-${userId}`
    this.boards.set(key, boards)
  },
  
  // ... implement other methods
}

// Test
const auth = { userType: 'test', userId: 'test-user' }
const result = await TaskHandlers.createBoard(storage, auth, { id: 'test', name: 'Test' })
console.log(result) // { ok: true, board: {...} }
```

---

## Support

- **Package:** `@wolffm/task`
- **Version:** 3.0.17
- **Repository:** https://github.com/WolffM/hadoku-task
- **Issues:** https://github.com/WolffM/hadoku-task/issues
