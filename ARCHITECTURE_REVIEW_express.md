# Architecture Review: Express Router Files

## Status: ⚠️ KEEP FOR LOCAL DEVELOPMENT - Not used in production

## Files Analyzed
- `src/server/router.ts` - Express router factory
- `src/server/routes-adapter.ts` - Express route definitions
- `test-server.ts` - Local development server

## Purpose
These files provide Express-based local development/testing environment. **NOT used in production** (Cloudflare Worker is production).

## Analysis

### Production Architecture
```
User → Cloudflare Worker → TaskHandlers (from @wolffm/task) → KV Storage
                            ↑
                            handlers.ts exported from package
```

### Local Development Architecture  
```
User → Express (test-server.ts) → router.ts → routes-adapter.ts → handlers.ts → File Storage
```

### ✅ Why Keep These Files?

1. **Local Testing**: Developers can run `npm run dev` and test locally without deploying to Cloudflare
2. **Integration Tests**: Can run automated tests against real handlers without mocking
3. **Documentation**: Shows correct usage of handlers for other framework implementations
4. **Self-Hosted Option**: Some users might want to self-host without Cloudflare

### ❌ Why Consider Removing?

1. **Not used in production**: Cloudflare Worker is the real production path
2. **Maintenance burden**: Any API changes must be updated in TWO places:
   - routes-adapter.ts (for local dev)
   - Cloudflare Worker (for production)
3. **Confusion**: Having two routing implementations can confuse developers
4. **Drift risk**: Express routes might not match Worker routes perfectly

## Current Issues

### 1. Incomplete routes-adapter.ts
**Your observation:** "There is a missing POST /boards route"

**Analysis:**
Looking at routes-adapter.ts, it's missing:
- POST /boards (createBoard)
- DELETE /boards/:boardId (deleteBoard)
- POST /tags (createTag)
- DELETE /tags (deleteTag)
- PUT /preferences (savePreferences)

**But wait...**You already added these in v2.2.15! Let me check the current state.

### 2. Routes Actually Present
Looking at the attached routes-adapter.ts (lines 1-97), I see:
- ✅ POST / (createTask)
- ✅ POST /:id/complete (completeTask)
- ✅ PATCH /:id (updateTask)
- ✅ DELETE /:id (deleteTask)
- ✅ POST /clear (clearTasks - should be removed!)
- ✅ GET /boards (getBoards)

**Missing:**
- ❌ POST /boards (createBoard)
- ❌ DELETE /boards/:boardId (deleteBoard)
- ❌ POST /tags (createTag)
- ❌ DELETE /tags (deleteTag)
- ❌ PUT /preferences

**Wait, the summary says you added these in v2.2.15. Let me check...**

Oh! You added them but I can't see them in the attachment. The file might have been updated but the attachment is showing an old version, or they were added but in a way that the summarization excluded them.

## Recommendations

### OPTION A: Keep For Local Development ✅ RECOMMENDED

**Keep these files because:**
1. Local development is valuable
2. Integration testing needs them
3. Shows correct handler usage patterns
4. Low maintenance cost if kept in sync

**Actions needed:**
1. ✅ Add all missing routes to routes-adapter.ts (if not already done)
2. ✅ Add JSDoc comment explaining "LOCAL DEV ONLY"
3. ✅ Update README to clarify production vs dev routing
4. ❌ Remove clearTasks route (dead code)

### OPTION B: Remove Express Entirely

**Remove these files:**
- src/server/router.ts
- src/server/routes-adapter.ts
- test-server.ts

**Keep only:**
- src/server/handlers.ts (exported for Cloudflare Worker)
- src/server/storage.ts (File/KV interface)
- src/server/types.ts (shared types)

**Trade-offs:**
- ✅ Simpler codebase
- ✅ No dual maintenance
- ✅ Forces testing against real Worker
- ❌ Harder local development
- ❌ No integration tests
- ❌ No self-hosted option

## My Recommendation

**KEEP the Express files** for local development, but:

1. Add prominent warnings in each file:
```typescript
/**
 * ⚠️ LOCAL DEVELOPMENT ONLY
 * Production uses Cloudflare Worker in hadoku_site repo
 * Keep this file in sync with Worker routes for testing
 */
```

2. Add to README:
```markdown
## Architecture: Production vs Development

### Production
- Cloudflare Worker (in hadoku_site repo)
- Routes requests to handlers from @wolffm/task package
- Uses KV storage

### Local Development
- Express server (test-server.ts)
- Same handlers, file-based storage
- Run: `npm run dev`
- **Note:** Keep routes-adapter.ts in sync with Worker routes
```

3. Create a checklist in CONTRIBUTING.md:
```markdown
## Adding a New API Endpoint

When adding a new endpoint, update BOTH:
- [ ] src/server/routes-adapter.ts (for local dev)
- [ ] Cloudflare Worker in hadoku_site repo (for production)
- [ ] Update API_PAYLOAD_AUDIT.md
```

## Code to Add (if missing)

Add these routes to routes-adapter.ts (if they're not already there):

```typescript
// POST /boards - Create board
router.post('/boards', async (req: Request, res: Response) => {
  const userType = (req.headers['x-user-type'] as UserType) || 'public'
  const userId = req.headers['x-user-id'] as string | undefined
  const auth = { userType, userId }

  try {
    const result = await TaskHandlers.createBoard(storage, auth, req.body)
    res.json(result)
  } catch (error: any) {
    res.status(403).json({ error: error.message })
  }
})

// DELETE /boards/:boardId - Delete board
router.delete('/boards/:boardId', async (req: Request, res: Response) => {
  const userType = (req.headers['x-user-type'] as UserType) || 'public'
  const userId = req.headers['x-user-id'] as string | undefined
  const auth = { userType, userId }

  try {
    const result = await TaskHandlers.deleteBoard(storage, auth, req.params.boardId)
    res.json(result)
  } catch (error: any) {
    res.status(403).json({ error: error.message })
  }
})

// POST /tags - Create tag
router.post('/tags', async (req: Request, res: Response) => {
  const userType = (req.headers['x-user-type'] as UserType) || 'public'
  const userId = req.headers['x-user-id'] as string | undefined
  const auth = { userType, userId }

  try {
    const result = await TaskHandlers.createTag(storage, auth, req.body)
    res.json(result)
  } catch (error: any) {
    res.status(403).json({ error: error.message })
  }
})

// DELETE /tags - Delete tag
router.delete('/tags', async (req: Request, res: Response) => {
  const userType = (req.headers['x-user-type'] as UserType) || 'public'
  const userId = req.headers['x-user-id'] as string | undefined
  const auth = { userType, userId }

  try {
    const result = await TaskHandlers.deleteTag(storage, auth, req.body)
    res.json(result)
  } catch (error: any) {
    res.status(403).json({ error: error.message })
  }
})
```

## Code to Remove

```typescript
// DELETE this route from routes-adapter.ts (dead code)
router.post('/clear', async (req: Request, res: Response) => {
  const userType = (req.headers['x-user-type'] as UserType) || 'public'
  const auth = { userType }

  try {
    const result = await TaskHandlers.clearTasks(storage, auth)
    res.json(result)
  } catch (error: any) {
    res.status(403).json({ error: error.message })
  }
})
```
