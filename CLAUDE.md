# hadoku-task

Pnpm monorepo publishing 3 packages to GitHub Packages (@wolffm scope).

## Packages

- @wolffm/task — main package. Frontend (mount/unmount), Worker (createTaskHandler), API handlers, CSS.
- @wolffm/themes — CSS variable themes, metadata, useTheme hook. Workspace dep of task.
- @wolffm/task-ui-components — shared React components (Modal, Toast, ThemePicker, Bento). Workspace dep of task + themes.

## Build

`pnpm run build:all` builds everything in dependency order.
Package build order: task-ui-components -> themes -> task.

Pre-commit hook runs typecheck, lint-staged, and the CSS/theme gate, then bumps the version of every publishable package whose files are staged (`scripts/version-bump.mjs`), so a push to main already carries a publishable version. CI's bump in `publish.yml` is only a backstop, for what a local hook can't cover: bot commits, `--no-verify`, and a version taken on the registry since.

## Worktrees — bootstrap them, or the hook silently does nothing

Create one with **`node scripts/new-worktree.mjs <name>`**, never a bare `git worktree add`.

`core.hooksPath` is `.husky/_`, which husky generates during `pnpm install` and self-ignores (`.husky/_/.gitignore` is `*`). Only `.husky/pre-commit` is tracked, so a fresh worktree has no hook directory: git runs no hook and prints nothing. Every gate is skipped and no version is bumped, so CI's backstop writes the `chore(release)` commit on main that the hook exists to prevent.

`pnpm install` in the worktree fixes both halves — husky's `prepare` regenerates `.husky/_`, and the gates get their `node_modules`. Symlinking or resolving up to the main checkout's `node_modules` is NOT enough; it produces no `.husky/_`. The script does the install and then verifies the hook is actually live.

Known and deliberate: `git commit --amend` **with staged changes to a publishable path** bumps a second time (3.4.155 → 3.4.156). The guard in version-bump.mjs can't see an amend — HEAD is still the commit being amended, so its version already equals the working tree. A bare `--amend --no-edit` is safe, because nothing is staged and no package matches. A skipped patch number is harmless: CI rolls forward to a free version.

## Colors

Read `themes/THEME_USAGE_GUIDE.md` before writing any styles. The rules:

- **A token names a semantic role, not a hue.** Light/dark is automatic — never branch on theme mode or `[data-theme]`.
- `<f>` ∈ `primary | success | warning | danger | neutral`. Every family has exactly six tokens: `--color-<f>`, `-dark`, `-bg`, `-hover`, `--color-on-<f>`, `--color-on-<f>-bg`. If a name isn't in that shape, it doesn't exist.
- **Filled button** → `bg-<f>` + `text-on-<f>`. **Tint badge** → `bg-<f>-bg` + `text-on-<f>-bg` (NOT `text-<f>` — that fails AA in most themes). **Body text** → `text-text`. **Card** → `bg-bg-card`. **Border** → `border-border`.
- **Never** `var(--color-x, #hex)` fallbacks, `text-white`/hex literals on a filled bg, or a hand-written `@theme` color block — import `@wolffm/themes/tailwind-colors.css` instead. Import `style.css` **unlayered** or every color resolves to nothing.
- Verify with `pnpm run lint:css` (runs the token/contrast/usage gates). Contracts: `docs/THEME_SYSTEM_RULES.md`.

## Exports (what hadoku-site consumes)

- `@wolffm/task/frontend` -> `mount(el, props)`, `unmount(el)` [src/app/entry.tsx]
- `@wolffm/task/worker` -> `createTaskHandler()` [worker/src/index.ts]
- `@wolffm/task/api` -> server handlers [src/server/index.ts]
- `@wolffm/task/style.css` -> CSS bundle [dist/style.css]

## Profiling / performance

- Cold-load profiler: `pnpm run profile` (authenticated, measures timing + API waterfall + duplicate requests, writes `.profiler/latest.json`).
- Full method, deeper techniques (CDP initiator stacks, render counts, simulated-KV server timing), regression guards, and the current baseline: `docs/PROFILING.md`. Start there whenever the ask is "profile" / "perf" / "why is it slow".

## MCP (agent task/calendar management)

- Remote, stateless Streamable-HTTP MCP at `/task/api/mcp` (live: `https://hadoku.me/task/api/mcp`).
- Source: `worker/src/mcp/` — `tools.ts` (transport-agnostic tool defs) + `handler.ts` (JSON-RPC handler), mounted in `worker/src/index.ts`.
- Tools wrap the in-process `TaskHandlers`; scoped by `X-User-Key` (same auth as `/task/api/*`). Add a tool = add to `TOOLS` in `tools.ts`.
- Full docs: `docs/MCP.md`.

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

- `pnpm run dev:api` runs the REAL worker on :3001 (what vite proxies `/task/api` to) behind an
  edge-router shim, a stub automation-preset provider on :3002, and the REAL prefs-api worker on
  :3003 against a real sqlite D1. Needed by any e2e spec that exercises the server path — those
  specs skip themselves when it isn't up.

- **Prefs are not mocked.** `@wolffm/prefs-client` defaults to `https://hadoku.me/prefs`; specs
  point it at :3003 via `pointPrefsAtLocalStack()` (`e2e/helpers/prefs.ts`), which sets the
  `__HADOKU_PREFS_API_BASE__` global that `resolvePrefsApiBase()` in @wolffm/themes reads. Route
  mocking `/prefs/api/v1/*` is what hid the `useThemePrefsMigration` bug for months — the mock
  answered 404 for an unset row where the real worker answers 200 with `merged:{}`, and only the
  `task` row was ever mocked, so the `portfolio` row escaped to production. Don't reintroduce it.

- :3003 comes from `../hadoku_site/workers/prefs-api` (imported across the repo boundary on
  purpose — a vendored copy would drift). Without that sibling checkout the prefs server is
  skipped with a warning and prefs-backed specs skip themselves.

- Test isolation is per-DEVICE: the SDK mints `hadoku_device_id` into localStorage, and each
  Playwright context is a fresh browser, so device-scoped prefs (theme, themeMode) can't collide
  across tests. USER-scoped values (experimentalThemes) are shared for the whole run.

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

Operator-only operations (set / lock / audit / grant) use `HADOKU_ADMIN_KEY`. Don't try to escalate: service tier can't write, and there is no key list to add yourself to — auth resolves from the edge-router key registry, which only an admin can write.

Lost or rotating your key? Operator: `python scripts/administration.py key-generate --tier service --repo ../<repo> --name <your-name>-<repo>` then drop the new UUID in `.devvault.local.json`.
