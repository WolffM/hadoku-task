/**
 * Automation board routes (§5.4, §5.5, §7), mounted at /task/api.
 *
 * The routes live in sibling modules by concern — reads, repo linking,
 * reconcile, activation — and register onto the app this builds. Registering
 * onto a shared app rather than mounting sub-apps keeps every path exactly where
 * it was, so `app.route('/task/api', createAutomationRoutes())` in index.ts is
 * unchanged.
 *
 * The call order below is the order the routes were declared in before the
 * split, which is deliberate: `paths` in the generated OpenAPI document is
 * emitted in registration order, and TenHands codegens from that document.
 * Keeping the order keeps the published spec byte-identical.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { registerPresetsRoute, registerActionableRoute } from './automation-reads'
import { registerSetRepoRoute, registerRepoValidateRoute } from './automation-repo'
import { registerReconcileRoute } from './automation-reconcile'
import { registerActivateRoute, registerDeactivateRoute } from './automation-activation'
import type { AppContext } from '../types'

export function createAutomationRoutes() {
  const app = new OpenAPIHono<AppContext>()

  registerPresetsRoute(app)
  registerSetRepoRoute(app)
  registerActionableRoute(app)
  registerReconcileRoute(app)
  registerRepoValidateRoute(app)
  registerActivateRoute(app)
  registerDeactivateRoute(app)

  return app
}
