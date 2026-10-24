/**
 * The route groups, each behind its own `import()`.
 *
 * A group's module builds its zod schemas at module scope, so importing it is
 * most of a cold isolate's CPU. Loading it on first use means a request only
 * pays for the group that serves it — /health pays for none (issue #101).
 * esbuild defers a dynamically imported module's top-level code until the
 * `import()` runs, even unsplit, and that survives hadoku_site's re-bundle.
 *
 * KEY ORDER IS MOUNT ORDER. It is the order the groups were `app.route`d onto
 * one app before they went lazy, so route-manifest.ts (generated in this order)
 * keeps the old match precedence and the merged spec keeps its path order.
 * More specific routes must come before generic ones: tags-batch before tasks,
 * so /batch-tag never matches /:id.
 *
 * This file must stay free of static imports that build schemas — root imports
 * it on every cold start.
 */
import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppContext } from './types'

export const ROUTE_GROUPS = {
  // health, validate-key
  misc: () => import('./routes/misc').then(m => m.createMiscRoutes()),
  session: () => import('./routes/session').then(m => m.createSessionRoutes()),
  preferences: () => import('./routes/preferences').then(m => m.createPreferencesRoutes()),
  boards: () => import('./routes/boards').then(m => m.createBoardRoutes()),
  // Board share management (§7): grant / list / revoke / leave.
  shares: () => import('./routes/shares').then(m => m.createShareRoutes()),
  // A board's calendar (§9) — its dated tasks, as a sub-resource of the board.
  calendar: () => import('./routes/calendar').then(m => m.createCalendarRoutes()),
  // Automation activation (§5.4): owner-only activate / deactivate.
  automation: () => import('./routes/automation').then(m => m.createAutomationRoutes()),
  // Agent claim protocol (§4): claim / heartbeat / set-lane / release / history
  // / change feed.
  agent: () => import('./routes/agent').then(m => m.createAgentRoutes()),
  // Tags and batch operations — MUST come before tasks.
  'tags-batch': () => import('./routes/tags-batch').then(m => m.createTagsBatchRoutes()),
  // Tasks (includes stats) — the generic /:id routes.
  tasks: () => import('./routes/tasks').then(m => m.createTaskRoutes()),
  admin: () => import('./routes/admin').then(m => m.createAdminRoutes()),
  // Hosted theme editor (hadoku.me/task/editor) — read style.css, commit edits to main
  'theme-editor': () => import('./routes/theme-editor').then(m => m.createThemeEditorRoutes())
} satisfies Record<string, () => Promise<OpenAPIHono<AppContext>>>

export type RouteGroup = keyof typeof ROUTE_GROUPS

/** Rows a group registers that root answers itself, so the manifest leaves them
 * out. /health must not load a group: it is what monitoring hits on a cold isolate. */
export const ROOT_SERVED: ReadonlySet<string> = new Set(['GET /task/api/health'])
