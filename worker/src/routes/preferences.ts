/**
 * Preferences Routes
 *
 * Handles user preference management (theme, buttons, experimental flags, layout)
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { badRequest, logRequest, logError, maskKey, maskSessionId } from '@wolffm/worker-utils'
import {
  getPreferencesBySessionId,
  savePreferencesBySessionId,
  type UserPreferences
} from '../session'
import { getSessionIdFromRequest } from '../request-utils'
import { DEFAULT_SESSION_ID, DEFAULT_THEME } from '../constants'
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
    description: `Fetches preferences by sessionId from X-Session-Id header.
Returns all preferences (theme, buttons, experimental flags, layout, etc.)
Falls back to legacy authKey-based prefs if session-based prefs not found.`,
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
    const sessionId = getSessionIdFromRequest(c, auth)

    logRequest('GET', '/task/api/preferences', {
      userType: auth.userType,
      sessionId: maskSessionId(sessionId)
    })

    try {
      const prefs = await getPreferencesBySessionId(c.env.TASKS_KV, sessionId)

      if (prefs) {
        return c.json(prefs, 200)
      }

      const authKey = auth.key || auth.sessionId
      if (authKey && authKey !== sessionId && authKey !== DEFAULT_SESSION_ID) {
        const legacyKey = `prefs:${authKey}`
        const legacyPrefs = await c.env.TASKS_KV.get(legacyKey, 'json')

        if (legacyPrefs) {
          logRequest('GET', '/task/api/preferences', {
            note: 'Found legacy prefs, migrating',
            authKey: maskKey(authKey)
          })

          await savePreferencesBySessionId(c.env.TASKS_KV, sessionId, legacyPrefs)
          await c.env.TASKS_KV.delete(legacyKey)

          return c.json(legacyPrefs, 200)
        }
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
    description: `Saves preferences by sessionId from X-Session-Id header.
Accepts ALL preference fields (theme, buttons, experimental flags, layout, etc.)
Merges with existing preferences.`,
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
    const sessionId = getSessionIdFromRequest(c, auth)

    try {
      const body = c.req.valid('json')

      logRequest('PUT', '/task/api/preferences', {
        userType: auth.userType,
        sessionId: maskSessionId(sessionId),
        fields: Object.keys(body)
      })

      const existing: Partial<UserPreferences> =
        (await getPreferencesBySessionId(c.env.TASKS_KV, sessionId)) || {}

      const updated: UserPreferences = {
        ...existing,
        ...body,
        lastUpdated: new Date().toISOString()
      }

      await savePreferencesBySessionId(c.env.TASKS_KV, sessionId, updated)

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
