# API Documentation

All endpoints are relative to `/api/task`.

## Authentication

User type is determined by:
- **Query parameter**: `?userType=public|friend|admin` (GET requests)
- **Header**: `X-User-Type: public|friend|admin` (POST/PATCH/DELETE requests)

**User Types**:
- `public` - In-memory storage (ephemeral)
- `friend` - File-based storage (persistent)
- `admin` - File-based storage (persistent)

---

## Endpoints

### Get Tasks

**Endpoint**: `GET /`

**Query Parameters**:
- `userType` (required): `public` | `friend` | `admin`

**Response**:
```json
{
  "version": 1,
  "tasks": [
    {
      "id": "01HQXXX...",
      "title": "Buy groceries",
      "tag": "home",
      "createdAt": "2025-10-06T10:00:00.000Z",
      "updatedAt": "2025-10-06T10:00:00.000Z"
    }
  ],
  "updatedAt": "2025-10-06T10:00:00.000Z"
}
```

**Example**:
```bash
curl http://localhost:3001/api/task?userType=friend
```

---

### Get Statistics

**Endpoint**: `GET /stats`

**Query Parameters**:
- `userType` (required): `public` | `friend` | `admin`

**Response**:
```json
{
  "version": 2,
  "counters": {
    "totalCreated": 42,
    "totalCompleted": 35,
    "totalDeleted": 5,
    "totalUpdated": 12
  },
  "timeline": [
    {
      "timestamp": "2025-10-06T10:00:00.000Z",
      "action": "created",
      "taskId": "01HQXXX...",
      "tag": "home"
    }
  ]
}
```

**Example**:
```bash
curl http://localhost:3001/api/task/stats?userType=friend
```

---

### Create Task

**Endpoint**: `POST /`

**Headers**:
- `Content-Type: application/json`
- `X-User-Type: public|friend|admin` (required)

**Body**:
```json
{
  "title": "Buy groceries",
  "tag": "home"  // optional
}
```

**Response**:
```json
{
  "id": "01HQXXX...",
  "title": "Buy groceries",
  "tag": "home",
  "createdAt": "2025-10-06T10:00:00.000Z",
  "updatedAt": "2025-10-06T10:00:00.000Z"
}
```

**Example**:
```bash
curl -X POST http://localhost:3001/api/task \
  -H "Content-Type: application/json" \
  -H "X-User-Type: friend" \
  -d '{"title":"Buy groceries","tag":"home"}'
```

---

### Complete Task

**Endpoint**: `POST /:id/complete`

**Headers**:
- `X-User-Type: public|friend|admin` (required)

**Response**:
```json
{
  "id": "01HQXXX...",
  "title": "Buy groceries",
  "tag": "home",
  "createdAt": "2025-10-06T10:00:00.000Z",
  "updatedAt": "2025-10-06T10:00:00.000Z"
}
```

**Note**: Task is removed from active tasks list.

**Example**:
```bash
curl -X POST http://localhost:3001/api/task/01HQXXX.../complete \
  -H "X-User-Type: friend"
```

---

### Update Task

**Endpoint**: `PATCH /:id`

**Headers**:
- `Content-Type: application/json`
- `X-User-Type: public|friend|admin` (required)

**Body**:
```json
{
  "title": "Buy groceries and milk",  // optional
  "tag": "urgent"                      // optional
}
```

**Response**:
```json
{
  "id": "01HQXXX...",
  "title": "Buy groceries and milk",
  "tag": "urgent",
  "createdAt": "2025-10-06T10:00:00.000Z",
  "updatedAt": "2025-10-06T10:30:00.000Z"
}
```

**Example**:
```bash
curl -X PATCH http://localhost:3001/api/task/01HQXXX... \
  -H "Content-Type: application/json" \
  -H "X-User-Type: friend" \
  -d '{"title":"Buy groceries and milk","tag":"urgent"}'
```

---

### Delete Task

**Endpoint**: `DELETE /:id`

**Headers**:
- `X-User-Type: public|friend|admin` (required)

**Response**:
```json
{
  "id": "01HQXXX...",
  "title": "Buy groceries",
  "tag": "home",
  "createdAt": "2025-10-06T10:00:00.000Z",
  "updatedAt": "2025-10-06T10:00:00.000Z"
}
```

**Example**:
```bash
curl -X DELETE http://localhost:3001/api/task/01HQXXX... \
  -H "X-User-Type: friend"
```

---

### Clear All Tasks

**Endpoint**: `POST /clear`

**Headers**:
- `X-User-Type: public` (required, only public users can clear)

**Response**:
```json
{
  "message": "All tasks cleared"
}
```

**Example**:
```bash
curl -X POST http://localhost:3001/api/task/clear \
  -H "X-User-Type: public"
```

**Note**: Only available for public users. Friend/admin users cannot clear all tasks.

---

## Error Responses

### 400 Bad Request

**Missing user type**:
```json
{
  "error": "Missing X-User-Type header"
}
```

**Missing required field**:
```json
{
  "error": "Missing required field: title"
}
```

### 403 Forbidden

**Clear not allowed**:
```json
{
  "error": "Clear operation only available for public users"
}
```

### 404 Not Found

**Task not found**:
```json
{
  "error": "Task not found"
}
```

### 500 Internal Server Error

**Server error**:
```json
{
  "error": "Failed to save tasks"
}
```

---

## Rate Limiting

Currently no rate limiting is implemented. Consider adding rate limiting in production:

```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
})

app.use('/api/task', limiter, taskRouter)
```

---

## CORS

CORS is configured to allow requests from:
- `http://localhost:4321` (development)
- `https://hadoku.me` (production)

Add additional origins as needed:

```typescript
app.use(cors({
  origin: ['http://localhost:4321', 'https://hadoku.me'],
  credentials: true
}))
```

---

## Data Validation

Consider adding request validation with Zod:

```typescript
import { z } from 'zod'

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  tag: z.string().min(1).max(50).optional()
})

// In route handler
const body = createTaskSchema.parse(req.body)
```

---

## Performance

### Response Times

- **Public users**: < 1ms (in-memory)
- **Friend/Admin users**: ~5-10ms (file I/O)

### Payload Sizes

- **Task**: ~100-200 bytes
- **Task list**: ~1-10KB (depends on count)
- **Stats**: ~500 bytes - 5KB (depends on timeline)

### Optimization Tips

1. **Pagination**: Add limit/offset for large task lists
2. **Filtering**: Add server-side filtering by date/tag
3. **Caching**: Add Redis for public user sessions
4. **Compression**: Enable gzip compression in Express
5. **CDN**: Serve static assets from CDN

---