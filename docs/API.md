# API Reference

Complete endpoint documentation for implementing the Task Manager backend.

> **Note**: This document is for backend implementers. For integration examples, see [README.md](../README.md).

---

## Authentication

**This micro-frontend delegates authentication to your parent application.**

### Your Responsibilities

1. **Validate authentication keys/tokens** in your backend
2. **Provide `userType` and `sessionId`** to the task app via props
3. **Secure all API endpoints** - validate auth headers before processing
4. **Handle user login/logout** in your application

### Request Headers

All authenticated endpoints should include:

```http
X-User-Type: public | friend | admin
X-Session-Id: <unique-session-identifier>
```

---

## Storage Interface

Implement this interface for your storage backend:

```typescript
interface TaskStorage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementations:**

- Cloudflare Workers KV
- Filesystem (Node.js)
- Database (SQL/NoSQL)
- In-memory (testing)

---

## Task Endpoints

### GET `/`

Get all active tasks for a board.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `boardId` (optional): Board ID (default: `main`)

**Response:**

```json
{
  "tasks": [
    {
      "id": "01HQ...",
      "title": "Task title",
      "tag": "work home",
      "state": "Active",
      "createdAt": "2025-10-27T12:00:00Z",
      "updatedAt": "2025-10-27T12:00:00Z",
      "closedAt": null,
      "startTime": "2025-10-27T14:00:00Z",
      "endTime": "2025-10-27T15:00:00Z"
    }
  ]
}
```

**Note:** `startTime` and `endTime` are optional. Tasks without these fields are classic board tasks that won't appear in calendar views.

---

### POST `/`

Create a new task.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "title": "Task title",
  "tag": "work",
  "boardId": "main",
  "startTime": "2025-10-27T14:00:00Z",
  "endTime": "2025-10-27T15:00:00Z"
}
```

| Field       | Type           | Required | Description                               |
| ----------- | -------------- | -------- | ----------------------------------------- |
| `title`     | string         | Yes      | Task title                                |
| `tag`       | string         | No       | Space-separated tags                      |
| `boardId`   | string         | No       | Target board (default: "main")            |
| `startTime` | string \| null | No       | Scheduled start time (ISO 8601)           |
| `endTime`   | string \| null | No       | Scheduled end time or deadline (ISO 8601) |

**Response:**

```json
{
  "id": "01HQ...",
  "title": "Task title",
  "tag": "work",
  "createdAt": "2025-10-27T12:00:00Z",
  "updatedAt": "2025-10-27T12:00:00Z",
  "startTime": "2025-10-27T14:00:00Z",
  "endTime": "2025-10-27T15:00:00Z"
}
```

---

### PATCH `/:id`

Update a task's title, tags, or scheduling.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID (ULID format)

**Body:**

```json
{
  "title": "Updated title",
  "tag": "new-tag",
  "boardId": "main",
  "startTime": "2025-10-27T16:00:00Z",
  "endTime": null
}
```

| Field       | Type           | Required | Description                    |
| ----------- | -------------- | -------- | ------------------------------ |
| `title`     | string         | No       | New task title                 |
| `tag`       | string         | No       | New tags (space-separated)     |
| `boardId`   | string         | No       | Board ID (default: "main")     |
| `startTime` | string \| null | No       | New start time (null to clear) |
| `endTime`   | string \| null | No       | New end time (null to clear)   |

**Response:**

```json
{
  "id": "01HQ...",
  "title": "Updated title",
  "tag": "new-tag",
  "updatedAt": "2025-10-27T12:30:00Z",
  "startTime": "2025-10-27T16:00:00Z",
  "endTime": null
}
```

---

### POST `/:id/complete`

Mark a task as completed (moves to stats graveyard).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID

**Query Parameters:**

- `boardId` (optional): Board ID (default: `main`)

**Example:**

```
POST /task/api/01HQ.../complete?boardId=work
```

**Response:**

```json
{
  "ok": true,
  "message": "Task 01HQ... completed"
}
```

---

### DELETE `/:id`

Permanently delete a task.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID

**Query Parameters:**

- `boardId` (optional): Board ID (default: `main`)

**Example:**

```
DELETE /task/api/01HQ...?boardId=work
```

**Response:**

```json
{
  "ok": true,
  "message": "Task deleted"
}
```

---

## Board Endpoints

### GET `/boards`

Get all boards for the current user.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `sessionId` (optional): Session identifier

**Response:**

```json
{
  "version": 1,
  "updatedAt": "2025-10-27T12:00:00Z",
  "boards": [
    {
      "id": "main",
      "name": "Main Board",
      "tags": ["work", "home"],
      "tasks": [...],
      "stats": {...}
    }
  ]
}
```

---

### POST `/boards`

Create a new board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "id": "project-x",
  "name": "Project X"
}
```

**Response:**

```json
{
  "id": "project-x",
  "name": "Project X",
  "tags": [],
  "tasks": []
}
```

---

### DELETE `/boards/:id`

Delete a board and all its tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Board ID (cannot delete "main")

**Response:**

```json
{
  "success": true
}
```

**Error Response:**

```json
{
  "error": "Cannot delete main board"
}
```

---

## Tag Endpoints

### POST `/boards/:id/tags`

Create a persisted tag on a board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Board ID

**Body:**

```json
{
  "tag": "urgent"
}
```

**Response:**

```json
{
  "success": true,
  "tags": ["urgent", "work", "home"]
}
```

---

### POST `/tags/delete`

Delete a persisted tag from a board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "tag": "urgent"
}
```

**Response:**

```json
{
  "success": true,
  "tags": ["work", "home"]
}
```

---

## Batch Operations

### PATCH `/batch-tag`

Update tags for multiple tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "updates": [
    { "taskId": "01HQ...", "tag": "urgent" },
    { "taskId": "01HR...", "tag": null }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "updated": 2
}
```

---

### POST `/batch-move`

Move multiple tasks between boards.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "sourceBoardId": "main",
  "targetBoardId": "archive",
  "taskIds": ["01HQ...", "01HR..."]
}
```

**Response:**

```json
{
  "success": true,
  "moved": 2
}
```

---

### POST `/batch-clear-tag`

Remove a specific tag from multiple tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "tag": "urgent",
  "taskIds": ["01HQ...", "01HR..."]
}
```

**Response:**

```json
{
  "success": true,
  "updated": 2
}
```

---

## Preferences Endpoints

### GET `/preferences`

Get user preferences (synced for non-public users).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Response:**

```json
{
  "version": 1,
  "updatedAt": "2025-10-27T12:00:00Z",
  "experimentalThemes": false,
  "alwaysVerticalLayout": false
}
```

> **Note**: Theme is NOT included - it's stored per-device in sessionStorage.

---

### PUT `/preferences`

Save user preferences (syncs for non-public users).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "experimentalThemes": true,
  "alwaysVerticalLayout": false
}
```

**Response:**

```json
{
  "ok": true
}
```

---

## Session & Authentication Endpoints

### POST `/validate-key`

Validate an authentication key.

> **Note**: Implement your own key validation logic. This endpoint is called when users enter a key in the settings modal.

**Headers:**

```http
X-User-Key: user-provided-key
```

**Response (valid):**

```json
{
  "valid": true
}
```

**Response (invalid):**

```json
{
  "valid": false
}
```

---

### POST `/session/create`

Create a new authenticated session after key validation.

> **Note**: Called after successful key validation. Should create a server-side session and return session details.

**Headers:**

```http
X-User-Key: validated-key
```

**Response:**

```json
{
  "sessionId": "unique-session-identifier",
  "userType": "friend",
  "valid": true
}
```

The frontend stores `sessionId` and `userType` in localStorage for subsequent requests.

---

### POST `/session/handshake`

Establish or migrate a session on page load (for authenticated users).

> **Note**: Called on page load for non-public users. Used to migrate preferences from old sessions and establish the current session.

**Headers:**

```http
X-User-Type: friend | admin
X-Session-Id: current-session-id
```

**Body:**

```json
{
  "newSessionId": "current-session-id",
  "oldSessionId": "previous-session-id-or-null"
}
```

**Response:**

```json
{
  "success": true,
  "sessionId": "current-session-id",
  "userType": "friend",
  "migrated": false,
  "preferences": {
    "experimentalThemes": false,
    "alwaysVerticalLayout": false
  }
}
```

> **Important - Session Expiration**: The `userType` field in the response reflects the server's determined user type based on the current session state. If the server session has expired (e.g., KV TTL exceeded), the server will return `userType: "public"` even if the client sent `X-User-Type: friend`. The client must check for this mismatch and handle session expiration appropriately (show re-authentication prompt, reload page).

---

## Statistics Endpoint

### GET `/stats`

Get task statistics for a board.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `boardId` (optional): Board ID (default: `main`)

**Response:**

```json
{
  "version": 2,
  "counters": {
    "totalCreated": 150,
    "totalCompleted": 120,
    "totalDeleted": 10,
    "totalUpdated": 200
  },
  "graveyard": [
    {
      "id": "01HQ...",
      "title": "Completed task",
      "tag": "work",
      "createdAt": "2025-10-20T10:00:00Z",
      "closedAt": "2025-10-27T12:00:00Z",
      "reason": "completed"
    }
  ]
}
```

---

## Error Responses

All endpoints return errors in this format:

**HTTP Status Codes:**

- `200` - Success
- `400` - Bad request (validation error)
- `403` - Forbidden (permission denied)
- `404` - Not found
- `500` - Server error

**Error Response:**

```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Data Types

### Task

```typescript
interface Task {
  id: string // ULID format
  title: string
  tag?: string | null // Space-separated tags
  state: 'Active' | 'Deleted' | 'Completed'
  createdAt: string // ISO 8601
  updatedAt?: string | null // ISO 8601
  closedAt?: string | null // ISO 8601 (when completed/deleted)
  // Calendar scheduling (see docs/MCP.md for the model)
  date?: string | null // canonical day "YYYY-MM-DD" (UTC); date-only = all-day task
  startTime?: string | null // ISO 8601 — timed event start
  endTime?: string | null // ISO 8601 — timed event end
  // External provider origin (calendar integrations) + arbitrary detail
  source?: string | null // e.g. "contact", "admin-mail"
  sourceId?: string | null // event id within that provider
  metadata?: Record<string, unknown> | null
}
```

`POST /` and `PATCH /:id` accept `date`, `startTime`, `endTime`, `source`, `sourceId`,
and `metadata` alongside `title`/`tag`. `date` is persisted as the UTC day and derived
from `startTime` when omitted. Agents can drive all of this through the
[MCP server](MCP.md).

### Board

```typescript
interface Board {
  id: string
  name: string
  tags: string[] // Persisted tags
  tasks: Task[]
  stats: StatsFile
}
```

### StatsFile

```typescript
interface StatsFile {
  version: number
  counters: {
    totalCreated: number
    totalCompleted: number
    totalDeleted: number
    totalUpdated: number
  }
  graveyard: StatsTaskRecord[]
}
```

---

## Implementation Examples

For complete integration examples with Express, Hono, and Cloudflare Workers, see:

- [README.md - Installation](../README.md#installation)
- [ARCHITECTURE.md - Server Architecture](ARCHITECTURE.md#server-architecture)

---

**Related Documentation:**

- [Architecture Overview](ARCHITECTURE.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
