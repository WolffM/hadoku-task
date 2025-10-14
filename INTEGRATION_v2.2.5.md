# Integration Guide: @wolffm/task v2.2.5

## Overview

Version 2.2.5 migrates task operation handlers from legacy `TasksFile` storage to the new board-based `BoardsFile` storage. All task operations now require a `boardId` parameter.

---

## Breaking Changes

### Handler Signatures Updated

All task operation handlers now accept `boardId` as a parameter:

```typescript
// Before (v2.2.4 and earlier)
TaskHandlers.createTask(storage, auth, input)
TaskHandlers.updateTask(storage, auth, taskId, input)
TaskHandlers.completeTask(storage, auth, taskId)
TaskHandlers.deleteTask(storage, auth, taskId)

// After (v2.2.5)
TaskHandlers.createTask(storage, auth, input, boardId)
TaskHandlers.updateTask(storage, auth, taskId, input, boardId)
TaskHandlers.completeTask(storage, auth, taskId, boardId)
TaskHandlers.deleteTask(storage, auth, taskId, boardId)
```

**Note:** All handlers default to `boardId = 'main'` if not provided.

---

## Integration Steps for task-api Worker

### 1. Update Package Version

```bash
cd workers/task-api
npm install @wolffm/task@2.2.5
```

### 2. Verify Handler Calls

Your task-api worker should already be passing `boardId` to handlers. Verify these endpoints:

#### POST /task/api - Create Task
```typescript
app.post('/task/api', async (c) => {
    const { storage, auth } = getContext(c);
    const body = await c.req.json();
    const { boardId = 'main', ...input } = body;  // ✅ Extract boardId from body
    const userId = c.req.header('X-User-Id') || c.req.query('userId');
    
    // ✅ Pass boardId as 4th parameter
    const result = await TaskHandlers.createTask(
        storage, 
        { ...auth, userId }, 
        input, 
        boardId  // ← Now required
    );
    
    return c.json(result, 201);
});
```

#### PATCH /task/api/:id - Update Task
```typescript
app.patch('/task/api/:id', async (c) => {
    const { storage, auth } = getContext(c);
    const id = c.req.param('id');
    const body = await c.req.json();
    const { boardId = 'main', ...input } = body;  // ✅ Extract boardId from body
    const userId = c.req.header('X-User-Id') || c.req.query('userId');
    
    // ✅ Pass boardId as 5th parameter
    const result = await TaskHandlers.updateTask(
        storage, 
        { ...auth, userId }, 
        id, 
        input, 
        boardId  // ← Now required
    );
    
    return c.json(result);
});
```

#### POST /task/api/:id/complete - Complete Task
```typescript
app.post('/task/api/:id/complete', async (c) => {
    const { storage, auth } = getContext(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { boardId = 'main' } = body;  // ✅ Extract boardId from body
    const userId = c.req.header('X-User-Id') || c.req.query('userId');
    
    // ✅ Pass boardId as 4th parameter
    const result = await TaskHandlers.completeTask(
        storage, 
        { ...auth, userId }, 
        id, 
        boardId  // ← Now required
    );
    
    return c.json(result);
});
```

#### DELETE /task/api/:id - Delete Task
```typescript
app.delete('/task/api/:id', async (c) => {
    const { storage, auth } = getContext(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { boardId = 'main' } = body;  // ✅ Extract boardId from body
    const userId = c.req.header('X-User-Id') || c.req.query('userId');
    
    // ✅ Pass boardId as 4th parameter
    const result = await TaskHandlers.deleteTask(
        storage, 
        { ...auth, userId }, 
        id, 
        boardId  // ← Now required
    );
    
    return c.json(result);
});
```

---

## What Changed Internally

### Before (v2.2.4)
```typescript
// Handlers used legacy flat storage
const tasks = await storage.getTasks(userType);
tasks.tasks.push(newTask);
await storage.saveTasks(userType, tasks);
```

### After (v2.2.5)
```typescript
// Handlers now use board-based storage
const boards = await storage.getBoards(userType, userId);
const board = boards.boards.find(b => b.id === boardId);
board.tasks.push(newTask);
await storage.saveBoards(userType, boards, userId);
```

---

## Testing Checklist

After updating to v2.2.5, test these operations:

- [ ] **Create Task**: POST /task/api with `{ title, boardId: 'main' }`
- [ ] **Update Task**: PATCH /task/api/:id with `{ title, boardId: 'main' }`
- [ ] **Complete Task**: POST /task/api/:id/complete with `{ boardId: 'main' }`
- [ ] **Delete Task**: DELETE /task/api/:id with `{ boardId: 'main' }`
- [ ] **Multi-board**: Test with different boardId values
- [ ] **Cross-tab sync**: Open two tabs, verify changes sync

---

## Expected Behavior

### ✅ Fixed Issues
- **"Task not found" errors**: Handlers now look in correct board storage
- **Cross-tab sync**: Multiple tabs should now see each other's changes
- **Tag operations**: Should work correctly with board-based storage

### ⚠️ Migration Notes

If you have existing data in old `TasksFile` format:
- The storage layer auto-migrates on first read
- Old tasks are moved to 'main' board
- No data loss during migration

---

## Rollback Plan

If issues arise, rollback to v2.2.4:

```bash
npm install @wolffm/task@2.2.4
```

Then revert handler calls to old signatures (remove boardId parameters).

---

## Support

For issues or questions:
- GitHub: https://github.com/WolffM/hadoku-task/issues
- Package: https://github.com/WolffM/hadoku-task/packages

---

## Version History

- **v2.2.5** - Board-based storage for all task operations
- **v2.2.4** - Added missing board/tag handlers
- **v2.2.3** - Session ID authentication support
- **v2.2.0** - Initial session authentication
- **v2.0.0** - Multi-board support introduced
