# Task API Reference

Quick reference for integrating the `@wolffm/task` package into your application.

## Installation

```bash
npm install @wolffm/task
```

## Server API Endpoints

### Base Path
All endpoints are relative to your configured base path (e.g., `/task` or `/api/tasks`).

### Authentication
Include the `x-user-type` header with one of: `public`, `admin`, `friend`

---

### GET `/`
Get all active tasks for a board.

**Query Parameters:**
- `userType` (optional): `public` | `admin` | `friend` (default: `public`)
- `boardId` (optional): Board ID (default: `main`)

**Response:**
```json
{
  "tasks": [
    {
      "id": "TASK_ID",
      "title": "Task title",
      "tag": "tag1 tag2",
      "state": "Active",
      "createdAt": 1234567890,
      "completedAt": null
    }
  ]
}
```

---

### GET `/stats`
Get statistics for the current user.

**Query Parameters:**
- `userType` (optional): `public` | `admin` | `friend`
- `boardId` (optional): Board ID

**Response:**
```json
{
  "totalTasks": 10,
  "completedTasks": 5,
  "activeTasks": 5
}
```

---

### POST `/`
Create a new task.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**Body:**
```json
{
  "title": "Task title",
  "tag": "tag1 tag2",
  "boardId": "main"
}
```

**Response:**
```json
{
  "id": "TASK_ID",
  "title": "Task title",
  "tag": "tag1 tag2",
  "state": "Active",
  "createdAt": 1234567890
}
```

---

### POST `/:id/complete`
Mark a task as completed.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**URL Parameters:**
- `id`: Task ID

**Body:**
```json
{
  "boardId": "main"  // Optional, defaults to 'main'
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Task TASK_ID completed"
}
```

---

### PATCH `/:id`
Update a task (title or tags).

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**URL Parameters:**
- `id`: Task ID

**Body:**
```json
{
  "title": "Updated title",
  "tag": "new-tag",
  "boardId": "main"
}
```

**Response:**
```json
{
  "id": "TASK_ID",
  "title": "Updated title",
  "tag": "new-tag"
}
```

---

### DELETE `/:id`
Delete a task permanently.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**URL Parameters:**
- `id`: Task ID

**Body:**
```json
{
  "boardId": "main"  // Optional, defaults to 'main'
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Task deleted"
}
```

---

### POST `/clear`
Clear all completed tasks (public user only).

**Headers:**
- `x-user-type`: Must be `public`

**Response:**
```json
{
  "success": true,
  "deletedCount": 5
}
```

---

## Board Management Endpoints

### GET `/boards`
Get all boards for the current user.

**Query Parameters:**
- `userType` (optional): `public` | `admin` | `friend`

**Response:**
```json
{
  "boards": [
    {
      "id": "main",
      "name": "main",
      "tasks": [...],
      "tags": ["tag1", "tag2"]
    }
  ]
}
```

---

### POST `/boards`
Create a new board.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**Body:**
```json
{
  "boardId": "project-x",
  "name": "Project X"
}
```

**Response:**
```json
{
  "id": "project-x",
  "name": "Project X",
  "tasks": [],
  "tags": []
}
```

---

### DELETE `/boards/:id`
Delete a board and all its tasks.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**URL Parameters:**
- `id`: Board ID (cannot delete "main")

**Response:**
```json
{
  "success": true
}
```

---

### POST `/boards/:id/tags`
Create a persisted tag on a board.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

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
  "tags": ["urgent", "other-tag"]
}
```

---

### POST `/tags/delete`
Delete a persisted tag from a board.

**Headers:**
- `x-user-type`: `public` | `admin` | `friend`

**Body:**
```json
{
  "boardId": "main",
  "tag": "tag-to-delete"
}
```

**Response:**
```json
{
  "success": true,
  "tags": ["remaining-tag"]
}
```

---

## Express Integration Example

```typescript
import express from 'express'
import { createTaskRoutes, FileStorage } from '@wolffm/task/api'

const app = express()
app.use(express.json())

// Initialize storage
const storage = new FileStorage('./data')

// Mount task routes
app.use('/api/tasks', createTaskRoutes(storage))

app.listen(3000)
```

---

## Frontend Components

Import the pre-built frontend application:

```typescript
import { TaskApp } from '@wolffm/task/frontend'
import '@wolffm/task/style.css'

// In your React app:
<TaskApp 
  basename="/task"
  userType="public"
  userId="user-123"
/>
```

**Props:**
- `basename`: Base path for the app (default: `/task`)
- `userType`: User type for API calls (default: `public`)
- `userId`: User identifier (default: `public`)
- `apiUrl`: Override API URL (optional)
- `environment`: Environment name (optional)

---

## Data Storage

The package includes two storage implementations:

### FileStorage
Stores data in JSON files on the filesystem.

```typescript
import { FileStorage } from '@wolffm/task/api'
const storage = new FileStorage('./task-data')
```

### MemoryStorage
Stores data in memory (useful for testing).

```typescript
import { MemoryStorage } from '@wolffm/task/api'
const storage = new MemoryStorage()
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (validation error)
- `403` - Forbidden (permission denied)
- `404` - Not found
- `500` - Server error

---

## Notes

- Task IDs are generated using ULID format
- Timestamps are Unix epoch milliseconds
- Tags are space-separated strings (e.g., `"tag1 tag2 tag3"`)
- The `main` board is created automatically and cannot be deleted
- Public users can only access their own data
- Admin and friend users have additional permissions (if configured)
