# Contributing to Hadoku Task Manager

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/hadoku-task.git
cd hadoku-task
pnpm install
pnpm run dev
```

## Development Workflow

1. **Get a worktree**: `node scripts/new-worktree.mjs <name>` — never a bare
   `git worktree add`, and never work in the main checkout. The script installs
   and builds, because an un-bootstrapped worktree runs no pre-commit hook and
   cannot pass the gates it does run. See the worktree section in `CLAUDE.md`.
2. **Make changes** following guidelines below
3. **Build**: `pnpm run build:all`
4. **Test** — see [Testing](#testing). Manual clicking is not the bar.
5. **Commit** - pre-commit hooks auto-lint and bump versions (see `.husky/README.md`)
6. **Land it.** Work reaches `main` by direct push (`git push origin HEAD:main`)
   as often as by PR. CI (`typecheck`, `lint`, `worker-tests`) runs on **both**,
   so either way a failure shows up — but on a push it lands first and goes red
   after, so run the gates locally before pushing.

## Testing

There are no unit tests. Two suites cover the code:

```bash
pnpm run test:worker                 # worker verify harnesses (real SQLite D1)
pnpm run dev:api                     # required by server-backed e2e specs
pnpm exec playwright test            # ~110 e2e specs
```

- **`pnpm run dev:api` is not optional.** Without it ~33 specs skip themselves,
  and prefs-backed specs need the sibling `../hadoku_site` checkout for the real
  prefs-api on :3003. A skipped spec is not a passing one — check the counts.
- **CI does NOT run Playwright.** Only `typecheck`, `lint` and `worker-tests`.
  Green CI is not evidence the e2e suite passes; run it yourself.
- **Don't mock a backend you can run.** The prefs specs used to intercept
  `/prefs/api/v1/*`, and the mock hid a real bug for months by answering 404
  where the real worker answers 200. See the Dev Server notes in `CLAUDE.md`.

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Provide proper type definitions, avoid `any`

### File Organization

- Keep files under 250 lines
- Components in `src/components/`
- Utilities in `src/utils/` or `src/domain/utils/`

### Styling

- Use CSS custom properties for colors/spacing
- Add styles to appropriate CSS file (`base.css`, `main.css`, `buttons.css`, etc.)

## Adding Features

### New Theme

1. Add definition in `themes/src/style.css` (41 tokens — `pnpm run lint:css`
   enforces the symmetric set and WCAG contrast for every pair)
2. Update `THEMES` array in `themes/src/index.ts`
3. Add the family entry to `THEME_FAMILIES` in `themes/src/metadata.tsx` — this
   is what the picker renders, and it is the platform's list, not an app's
4. Run `pnpm run lint:css`. It gates tokens, contrast, the Tailwind mapping and
   the usage guide, and it will fail on a missing token rather than ship a
   theme that renders half-styled

### New API Endpoint

The live API is the **worker**; `src/server/` is the framework-agnostic handler
export consumed elsewhere. A new endpoint usually means both.

1. Add the route in `worker/src/routes/` and mount it in `worker/src/index.ts`
2. Add request/response schemas in `worker/src/schemas.ts` (routes are
   `@hono/zod-openapi` — the schema is the contract _and_ the docs)
3. Add handler in `src/domain/handlers/handlers.ts` and export from
   `src/server/index.ts` if the endpoint belongs to that surface too
4. Update types in `src/domain/types.ts`
5. Add a `worker/test/*-verify.ts` harness — these run in CI on every push,
   which the e2e suite does not
6. Document in `docs/API.md`

## Code Style

- 2 space indentation
- Semicolons, single quotes, trailing commas

## Critical Build Files

Some manually-maintained files must be committed despite `.gitignore` patterns:

- `src/app/entry.d.ts` - Public API type definitions
- `themes/src/style.css` - Theme CSS source
- CSS files in `task-ui-components/src/` — all six: `app-header.css`,
  `bento.css`, `context-menu.css`, `modal.css`, `theme-picker.css`,
  `toaster.css`. The build copies each into `dist/`, so a missing one is a
  broken published package rather than a local error

If CI fails with "file missing" errors, check these files exist and are committed.

## License

MIT License
