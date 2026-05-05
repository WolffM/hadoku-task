# hadoku-task

Pnpm monorepo publishing 3 packages to GitHub Packages (@wolffm scope).

## Packages

- @wolffm/task — main package. Frontend (mount/unmount), Worker (createTaskHandler), API handlers, CSS.
- @wolffm/themes — CSS variable themes, metadata, useTheme hook. Workspace dep of task.
- @wolffm/task-ui-components — shared React components (Modal, Toast, ThemePicker, Bento). Workspace dep of task + themes.

## Build

`pnpm run build:all` builds everything in dependency order.
Package build order: task-ui-components -> themes -> task.
Pre-commit hook auto-bumps versions and runs lint:fix + format.

## Exports (what hadoku-site consumes)

- `@wolffm/task/frontend` -> `mount(el, props)`, `unmount(el)` [src/app/entry.tsx]
- `@wolffm/task/worker` -> `createTaskHandler()` [worker/src/index.ts]
- `@wolffm/task/api` -> server handlers [src/server/index.ts]
- `@wolffm/task/style.css` -> CSS bundle [dist/style.css]

## Cross-Repo

- Publishes trigger `packages_updated` dispatch to WolffM/hadoku_site
- Depends on @wolffm/worker-utils (external)
- Sibling: ../hadoku_site/ (consumer of all packages)
- Mobile wrapper: hadoku-task-mobile repo

## Verification Rules

1. Never ask the user to verify — verify yourself first with tests or commands.
2. Never suggest "caching issue" — cache-bust and re-verify programmatically.
3. Do not declare work complete without evidence — grep, curl, or run a test.

## Dev Server

- Serve from correct root so relative paths resolve.
- Use cache-busting query params when debugging.
- For JS-rendered content, verify final DOM output programmatically.

## Does NOT

- Use npm or yarn (pnpm only) — see .npmrc preinstall guard
- Track dist/ in git — all dist/ directories are gitignored (see .gitignore)
- Have unit tests — only E2E tests in e2e/ via Playwright (see playwright.config.ts)
- Use the name createFetchHandler — worker export is createTaskHandler() (see worker/src/index.ts)

## Auth & secrets (hadoku ecosystem)

- **Browser fetches** must hit `hadoku.me/{prefix}/*` via edge-router — NEVER `*.hadoku.me` direct subdomains. The `hadoku_session` cookie (`Domain=.hadoku.me`, 30d sliding) is set on `/auth` and resolved server-side by edge-router into `X-User-Key` for the backend. See `../hadoku_site/CLAUDE.md` for the rule.
- **Secrets**: vault-broker model. Local dev fetches via `.devvault.json` + `node ../hadoku_site/scripts/secrets/dev-vault.mjs -- <cmd>`. Production runtime is wired automatically (PM2 wrappers for tunnel apps; CF Worker secret bindings pushed by `python ../hadoku_site/scripts/administration.py cloudflare-secrets`). NEVER add `.env` files. See `../hadoku_site/docs/operations/SECRETS.md`.
- **Auth model**: 1:1 named user-keys. `/auth` accepts key + name; whoami returns the name. Admin endpoints `GET/POST/DELETE /session/admin/keys` manage the registry. See `../hadoku_site/docs/planning/next-work.md`.

## Vault — what your service-tier key can and can't do

This repo's vault key lives in `.devvault.local.json` at the repo root (gitignored, mode 0600). `dev-vault.mjs` reads it automatically. Per-key ACL is enforced as of 2026-05-04.

CAN do (no operator needed):

- `GET /api/secrets/status` — sealed/unlocked check
- `GET /api/secrets/get/:key` — fetch a value declared in this repo's `.devvault.json`
  (other repos' secrets return 403 — your key is scoped to THIS repo)
- `GET /api/secrets/acl/me` — see what your key is granted
- Verify with: `node ../hadoku_site/scripts/secrets/dev-vault.mjs --check`

CANNOT do (returns `403` — by design):

- Read secrets NOT in this repo's `.devvault.json`
- `POST /api/secrets/admin/set-many` — adding/changing secrets
- `POST /api/secrets/admin/lock` — sealing the vault
- `GET /api/secrets/list` — enumerating every secret name
- `GET /api/secrets/audit` — dead-key report

If your code reads a new `process.env.X` that isn't in `.devvault.json` yet:

1. Add the mapping to `.devvault.json` (commit-safe, no values).
2. Tell the operator: they grant the new entries via `key-acl-sync --repo ../<this-repo> --key <uuid> [--prune]`.
3. Re-run your dev command.

Operator-only operations (set / lock / audit / grant) use `HADOKU_ADMIN_KEY`. Don't try to escalate by writing to `ADMIN_KEYS` — service tier can't write.

Lost or rotating your key? Operator: `python scripts/administration.py key-generate --tier service --repo ../<repo> --name <your-name>-<repo>` then drop the new UUID in `.devvault.local.json`.
