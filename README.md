# hadoku-task-app (starter)

Micro-app for `hadoku.me/task/` with rapid entry, client-side API via Service Worker, and GitHub-backed JSON persistence.

## What you get
- `tasks.json` (live list) and `stats.json` (v2: persistent records)
- `/api/task` and `/api/stats` implemented in the Service Worker
- ULID ids, BroadcastChannel updates, keyboard-first UX

## Run
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
# dist/index.js → import from your controller via registry/import map
```

## Configure (in browser)
In your UI "Settings", call:
```ts
api.configureSW({
  adminKey: 'YOUR_ADMIN_KEY',
  pat: 'YOUR_FINE_GRAINED_GH_PAT',
  repoOwner: 'hadoku',
  repoName: 'hadoku_site',
  branch: 'main', // or your branch
  tasksPath: 'task/data/tasks.json',
  statsPath: 'task/data/stats.json'
})
```
**Note:** PAT is stored client-side (low stakes per your choice). Use a fine-grained token limited to contents:write on the target repo.

## Data files
- `tasks.json` schema:
  ```json
  {
    "version": 1,
    "updatedAt": "2025-09-30T16:58:26Z",
    "tasks": [ /* Task[] */ ]
  }
  ```
- `stats.json` v2 schema (stores persistent task records, including completed/deleted with name/timestamps/state):
  ```json
  {
    "version": 2,
    "updatedAt": "2025-09-30T16:58:26Z",
    "counters": {"created":0,"completed":0,"edited":0,"deleted":0,"sessions":0},
    "timeline": [],
    "tasks": {}
  }
  ```

## Notes
- This is single-user; writes require `X-Admin-Key` header.
- GitHub API rate limits apply; actions are lightweight.
- For stricter privacy later, gate GET endpoints or move the API server-side.
