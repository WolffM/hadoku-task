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
