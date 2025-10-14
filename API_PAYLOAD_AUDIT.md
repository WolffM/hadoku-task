# API Payload Audit - Client vs Server

**Date:** October 13, 2025  
**Version:** v2.2.15

## Summary

Systematic audit of all API endpoints to ensure client payloads match server expectations.

---

## ✅ Endpoints - All Verified

### 1. POST `/task/api` - Create Task
**Client sends:**
```json
{
  "id": "ULID",           // Client-generated ID
  "title": "string",
  "tag": "string?",
  "boardId": "string"
}
```

**Server expects:**
```typescript
createTask(storage, auth, input: CreateTaskInput, boardId: string)
// CreateTaskInput = { id?: string; title: string; tag?: string }
// boardId from query param or route
```

**Status:** ✅ **MATCH** - Server accepts optional `id`, client provides it

---

### 2. PATCH `/task/api/:id` - Update Task
**Client sends:**
```json
{
  "title": "string?",
  "tag": "string?",
  "boardId": "string"
}
```

**Server expects:**
```typescript
updateTask(storage, auth, taskId: ULID, input: UpdateTaskInput, boardId: string)
// UpdateTaskInput = { title?: string; tag?: string }
// boardId from body
```

**Status:** ✅ **MATCH**

---

### 3. POST `/task/api/:id/complete` - Complete Task
**Client sends:**
```json
{
  "boardId": "string"
}
```

**Server expects:**
```typescript
completeTask(storage, auth, taskId: ULID, boardId: string)
// boardId from body
```

**Status:** ✅ **MATCH**

---

### 4. DELETE `/task/api/:id` - Delete Task
**Client sends:**
```json
{
  "boardId": "string"
}
```

**Server expects:**
```typescript
deleteTask(storage, auth, taskId: ULID, boardId: string)
// boardId from body
```

**Status:** ✅ **MATCH**

---

### 5. POST `/task/api/boards` - Create Board
**Client sends (FIXED in v2.2.15):**
```json
{
  "id": "string",
  "name": "string"
}
```

**Server expects:**
```typescript
createBoard(storage, auth, input: { id: string; name: string })
```

**Status:** ✅ **FIXED** - Was sending `{ boardId }`, now sends `{ id, name }`

---

### 6. DELETE `/task/api/boards/:boardId` - Delete Board
**Client sends:**
```
No body, boardId in URL path
```

**Server expects:**
```typescript
deleteBoard(storage, auth, boardId: string)
// boardId from route param
```

**Status:** ✅ **MATCH**

---

### 7. POST `/task/api/tags` - Create Tag
**Client sends:**
```json
{
  "boardId": "string",
  "tag": "string"
}
```

**Server expects:**
```typescript
createTag(storage, auth, input: { boardId: string; tag: string })
```

**Status:** ✅ **MATCH**

---

### 8. DELETE `/task/api/tags` - Delete Tag
**Client sends:**
```json
{
  "boardId": "string",
  "tag": "string"
}
```

**Server expects:**
```typescript
deleteTag(storage, auth, input: { boardId: string; tag: string })
```

**Status:** ✅ **MATCH**

---

### 9. GET `/task/api/boards` - Get Boards
**Client sends:**
```
Query params: ?userType=admin&userId=admin
```

**Server expects:**
```typescript
getBoards(storage, auth: AuthContext & { userId?: string })
// userType and userId from auth context
```

**Status:** ✅ **MATCH**

---

### 10. GET `/task/api/tasks` - Get Tasks
**Client sends:**
```
Query params: ?userType=admin&userId=admin&boardId=main
```

**Server expects:**
```typescript
getBoardTasks(storage, auth, boardId: string)
// boardId from query param
```

**Status:** ✅ **MATCH**

---

### 11. PUT `/task/api/preferences` - Save Preferences (NEW)
**Client sends:**
```json
{
  "theme": "ThemeName"
}
```

**Server expects:**
```typescript
// Handler needs to be implemented
// Should accept: { theme?: ThemeName; ... }
```

**Status:** ⚠️ **NEEDS SERVER HANDLER** - Client implemented, server handler missing

---

## Issues Found

### 🔴 Fixed in v2.2.15
1. **Create Board** - Client was sending `{ boardId }`, server expected `{ id, name }`
   - **Fix:** Changed client to send `{ id: boardId, name: boardId }`

### ⚠️ Pending
1. **Preferences Endpoint** - Server handler not yet implemented
   - Need to add handler for `PUT /task/api/preferences`
   - Should store preferences in KV storage: `preferences:${userType}:${userId}`

---

## Router Mappings Needed

Ensure the router (Cloudflare Worker or Express) maps:
- `POST /task/api/tags` → `createTag()`
- `DELETE /task/api/tags` → `deleteTag()`
- `PUT /task/api/preferences` → `savePreferences()` (needs implementation)

---

## Recommendations

1. ✅ All core task/board operations verified and working
2. ⚠️ Implement server-side preferences handler
3. ✅ Client-server payload contracts now aligned
4. ✅ Future additions should follow this audit pattern

