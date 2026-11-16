# Task: contributing

How to run, change and ship Task. What it does for a user is in
[features.md](features.md). The rules every change must keep — the pre-commit
hook, versioning, dialogs, icons, worker route loading, the vault, and far
more — are in the repo's [`AGENTS.md`](../../AGENTS.md); read that first.

## Run it locally

Create a worktree with `node scripts/new-worktree.mjs <name>`, never a bare
`git worktree add` — this repo's hook directory is not checked out by git, so
an un-bootstrapped worktree silently skips every gate. The script installs
dependencies, verifies the hook is live, and builds the two workspace
packages the pre-commit typecheck resolves against.

```sh
pnpm install                  # or use new-worktree.mjs, which also bootstraps
pnpm run dev                  # builds the packages, then the Vite dev server
pnpm run dev:api              # the real worker on :3001, a preset stub, a real prefs worker
pnpm run build:all            # client, worker, server handlers — everything the package ships
```

The web app needs no backend to try: `pnpm run dev` and open it at
`?userType=public` for the browser-only mode. Media routes and anything
tier-gated need the edge's identity headers, which only exist in production;
locally, tests inject them instead (see "Dev Server" in `AGENTS.md`).

## Architecture

```
browser ──► hadoku.me/task/* ──► edge (sign-in, tier, X-Hadoku-Tier) ──► Cloudflare Worker (this repo)
Kate editor ──► same hosted API                                            │
agent (MCP) ──► same hosted API, X-User-Key                                │
                                                                     worker/src/routes/*.ts
                                                                     one route group per concern,
                                                                     lazily imported on first use
```

- **The Universal Adapter Pattern** keeps business logic framework-free:
  pure handlers (`src/server/`, `worker/src/`) take a `TaskStorage`
  implementation and an `AuthContext`, and never import Express, Hono or any
  framework type. The same handlers run in the Cloudflare Worker, a Node
  server, or a test. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) is the
  full design record.
- **Route groups load lazily.** `worker/src/index.ts` mounts nothing at
  startup; each route group is `import()`-ed on its first request, because a
  cold Worker isolate's first cost used to be building every zod schema at
  module scope. Changing a route or a schema needs
  `pnpm run gen:worker`, which regenerates the routing table and the OpenAPI
  spec the e2e suite and TenHands both depend on.
- **Sync is one-directional.** On load, the server's data always overwrites
  `localStorage` — never the reverse — so a stale or corrupted local copy can
  never resurrect deleted server data.
- **Trackers** (`worker/src/routes/trackers.ts`): wife tier and up, checked on
  the caller on every route; a board's trackers have no `localStorage`
  mirror, so a write from elsewhere shows up on next read.
- **Automation boards** (`worker/src/routes/automation*.ts`,
  `board-automation.ts`): a board's tag vocabulary becomes a provider's fixed
  lane contract on activation; the worker enforces who may write which lane,
  never the policy behind it.
- **The theme editor** (`worker/src/routes/theme-editor.ts`): service tier,
  reads and writes `themes/src/style.css` on `main` through the platform's
  management API using this worker's own service key, re-running the same
  contract check `lint:css` runs before it commits.
- **MCP** (`worker/src/mcp/`): a stateless Streamable-HTTP JSON-RPC handler
  wrapping the same in-process task handlers; see [`docs/MCP.md`](../MCP.md).

## Kate plugin

`plugins/kate/` is a native `KTextEditor::Plugin` (C++/CMake), invisible to
pnpm: it has its own build and its own CI job
(`.github/workflows/kate-plugin.yml`). It talks to the hosted API exactly as
the web app does. Building it needs the KF6/Qt6 dev toolchain; see
[`plugins/kate/README.md`](../../plugins/kate/README.md) for the exact
packages and the install path.

## Tests and gates

```sh
pnpm run typecheck
pnpm run lint          # eslint, plus lint:icons
pnpm run lint:css      # stylelint + the theme contract
pnpm run test:worker   # worker handlers against a real SQLite D1
pnpm exec playwright test   # ~220 e2e specs against the real local stack, own free ports
```

- **The pre-commit hook** runs typecheck, lint-staged and the CSS/theme gate —
  not the e2e suite; run that yourself before pushing a frontend change.
- **CI** (`ci.yml`) runs typecheck, lint, worker-tests and the full e2e suite
  on every pull request _and_ on every push to `main`, because work here lands
  by direct push at least as often as by PR. On a push, CI is detection, not
  prevention: the commit has already landed, so a red run is a red `main` to
  fix forward, not a block.
- **Never edit a version number.** `publish.yml`'s `Version` step sets each
  changed package's version at publish time, one patch above the registry's
  newest; the committed `version` fields are stale by design. A committed
  version _above_ the registry's newest publishes as-is — the one way to make
  a deliberate minor or major bump.

## How it deploys

A push to `main` that changes a package runs `publish.yml`, which versions,
builds and publishes `@wolffm/task`, `@wolffm/themes` and
`@wolffm/task-ui-components` to GitHub Packages, then notifies the platform's
site repo (`packages_updated`) so it can pick up the new versions. The Kate
plugin has no cloud deploy at all — `kate-plugin.yml` only compile-checks it;
installing it is always a local `cmake --install` on the user's own machine.

## Trivia

A worktree made with a bare `git worktree add` checks out no pre-commit hook
at all — `core.hooksPath` points at a directory husky generates and
self-ignores — so every gate silently skipped until the hooks moved into a
tracked directory (`755a535`) and `scripts/new-worktree.mjs` started
bootstrapping and verifying them itself (`af0bd52`).
