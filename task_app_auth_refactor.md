# Refactor Plan: Task App Authentication & Keys

## Current Problems
- **`process.env` references in client bundle** → causes runtime errors (`process is not defined`) when loaded in the browser.
- **Multiple keys and PATs spread across client code** (e.g. `TASK_ADMIN_KEY`, `TASK_GH_PAT`). These leak build/runtime assumptions into the frontend.
- **Child app currently has direct knowledge of secrets**, which is insecure and unnecessary.

## Goals
1. **Remove all direct secret handling from the child app bundle.**
   - Child apps should never know the actual `ADMIN_KEY` or GitHub PAT.
   - Validation of admin/friend/public access happens in the **parent Astro app**.

2. **Pass down only what’s needed.**
   - Parent app resolves `userType` (`admin` | `friend` | `public`) and provides it as a prop or query param to child apps.
   - No raw secret values should appear in child app source.

3. **Handle GitHub persistence server-side.**
   - Live deployment (Astro app or backend function) manages commits to GitHub repos.
   - Child apps make `fetch` calls to parent endpoints, not directly to GitHub.

---

## Refactor Instructions

### Step 1: Remove `process.env` usage in child bundles
- Search for all `process.env.*` calls in `hadoku-task`.
- Replace with **props or query params** passed from the parent.
- If environment-specific behavior is needed (dev vs prod), use `import.meta.env.MODE` (Vite/Astro standard), not `process.env`.

### Step 2: Strip secrets from child apps
- Remove all instances of:
  ```ts
  localStorage.setItem('TASK_ADMIN_KEY', cfg.adminKey)
  localStorage.setItem('TASK_GH_PAT', cfg.pat)
  ```
- Child app should never attempt to store or read admin keys or PATs.
- Replace with a `userType` prop or query param provided by the parent Astro app:
  ```ts
  const userType = new URLSearchParams(window.location.search).get("userType") || "public";
  ```

### Step 3: Replace direct GitHub calls
- Example of old code:
  ```ts
  fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.githubPAT}`
    },
    body: JSON.stringify(body)
  })
  ```
- Refactor so the child app calls a **parent-side API route** (e.g. `/api/task/update`).
- Parent API route adds the PAT securely from server-side env vars and proxies to GitHub.
- Benefit: GitHub PAT never ships to client.

### Step 4: Update parent-to-child interface
- When embedding the task app, parent injects only non-sensitive props:
  ```html
  <iframe src="/mf/task/?userType=admin" />
  ```
- Or via JS bridge if using module federation.

### Step 5: Validate Access in Parent Only
- Parent Astro app validates `?key=...` and determines `userType`.
- Only authorized userTypes get access to certain routes/features.
- Child apps trust `userType` value coming from parent → no extra validation.

---

## Deliverables
- Remove all `process.env` references from `hadoku-task` frontend.
- Delete secret handling (`ADMIN_KEY`, `PAT`) from child app code.
- Introduce parent API endpoints for GitHub commits and data updates.
- Pass only `userType` into child apps via query params/props.
- Verify no secrets appear in built artifacts (`dist/`).

---

## Testing
1. Build and deploy parent + task app.
2. Confirm browser console has no `process is not defined` errors.
3. Confirm `localStorage` does not contain any `*_KEY` or PAT values.
4. Test workflows:
   - Public user → cannot perform admin actions.
   - Admin user → can perform actions, with parent proxying requests to GitHub.
5. Check network tab: no GitHub API requests with PAT directly from browser.

