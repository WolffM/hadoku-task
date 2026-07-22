/**
 * Preferences Routes
 *
 * Handles user preference management (theme, buttons, experimental flags, layout)
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { badRequest, maskSessionId } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import {
  readPreferencesWithRepair,
  savePreferencesBySessionId,
  type UserPreferences
} from '../session'
import { resolvePrefsIdentity } from '../request-utils'
import { DEFAULT_THEME } from '../constants'
import type { AppContext } from '../types'
import {
  GetPreferencesResponseSchema,
  UpdatePreferencesInputSchema,
  UpdatePreferencesResponseSchema,
  ErrorResponseSchema
} from '../schemas'

export function createPreferencesRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Get User Preferences
  const getPreferencesRoute = createRoute({
    method: 'get',
    path: '/preferences',
    tags: ['Preferences'],
    summary: 'Get user preferences',
    description: `Fetches preferences keyed by the stable user identity (edge-injected X-User-Id).
Returns all preferences (theme, buttons, experimental flags, layout, etc.)
Recovers preferences stranded under an ephemeral sessionId or a pre-rotation raw
key by copying them forward into the stable namespace (read-repair).`,
    responses: {
      200: {
        description: 'User preferences',
        content: {
          'application/json': {
            schema: GetPreferencesResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getPreferencesRoute, (async (c: any) => {
    const auth = c.get('authContext')
    const { id, legacyIds } = resolvePrefsIdentity(c, auth)

    logRequest('GET', '/task/api/preferences', {
      userType: auth.userType,
      prefsId: maskSessionId(id)
    })

    try {
      const prefs = await readPreferencesWithRepair(c.env.TASKS_KV, id, legacyIds, auth.key)

      if (prefs) {
        return c.json(prefs, 200)
      }

      const defaultPrefs: UserPreferences = {
        theme: DEFAULT_THEME,
        buttons: {},
        experimentalFlags: {},
        layout: {},
        lastUpdated: new Date().toISOString()
      }

      return c.json(defaultPrefs, 200)
    } catch (error: unknown) {
      logError(
        'GET',
        '/task/api/preferences',
        error instanceof Error ? error : new Error(String(error))
      )

      return c.json(
        {
          theme: DEFAULT_THEME,
          buttons: {},
          experimentalFlags: {},
          layout: {}
        },
        200
      )
    }
  }) as never)

  // Save User Preferences
  const updatePreferencesRoute = createRoute({
    method: 'put',
    path: '/preferences',
    tags: ['Preferences'],
    summary: 'Save user preferences',
    description: `Saves preferences keyed by the stable user identity (edge-injected X-User-Id).
Accepts ALL preference fields (theme, buttons, experimental flags, layout, etc.)
Merges with existing preferences, including any recovered from a legacy namespace.`,
    request: {
      body: {
        content: {
          'application/json': {
            schema: UpdatePreferencesInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Preferences saved successfully',
        content: {
          'application/json': {
            schema: UpdatePreferencesResponseSchema
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(updatePreferencesRoute, (async (c: any) => {
    const auth = c.get('authContext')
    const { id, legacyIds } = resolvePrefsIdentity(c, auth)

    try {
      const body = c.req.valid('json')

      logRequest('PUT', '/task/api/preferences', {
        userType: auth.userType,
        prefsId: maskSessionId(id),
        fields: Object.keys(body)
      })

      // Merge onto the recovered blob, not just whatever sits at `id`. A user
      // whose first write after this fix lands before their first read would
      // otherwise have their stranded preferences overwritten by a partial
      // patch on top of {}.
      const existing: Partial<UserPreferences> =
        (await readPreferencesWithRepair(c.env.TASKS_KV, id, legacyIds, auth.key)) || {}

      const updated: UserPreferences = {
        ...existing,
        ...body,
        lastUpdated: new Date().toISOString()
      }

      await savePreferencesBySessionId(c.env.TASKS_KV, id, updated)

      return c.json({ ok: true as const, message: 'Preferences saved', preferences: updated }, 200)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logError(
        'PUT',
        '/task/api/preferences',
        error instanceof Error ? error : new Error(errorMessage)
      )
      return badRequest(c, `Failed to save preferences: ${errorMessage}`)
    }
  }) as never)

  return app
}
