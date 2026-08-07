/**
 * Client telemetry relay.
 *
 * WHY A RELAY AND NOT A DIRECT POST
 * ---------------------------------
 * The browser cannot reach monitoring-api's ingest. Its tiers (documented in
 * hadoku_site/workers/monitoring-api/src/index.ts) are:
 *
 *   POST /health/api/telemetry        service tier
 *   POST /health/api/telemetry/batch  admin tier  ("client-side telemetry stays admin")
 *   POST /health/api/telemetry/game   friend, and game-specific by path
 *
 * A browser session is `friend` at best and frequently anonymous, so every
 * client-side event would 403. The alternative — opening a friend/anon write
 * route on the shared monitoring worker — widens the write surface of the
 * monitoring plane for every app at once.
 *
 * So the browser posts HERE instead, to an endpoint that already authenticates
 * it, and this worker forwards with its own service-tier credential. The public
 * write surface is unchanged; the credential never reaches a browser.
 *
 * WHAT IT ACCEPTS
 * ---------------
 * Deliberately narrow. This exists to catch SILENT DEGRADATION — the class of
 * bug where a value is resolved and then quietly discarded for a default,
 * which is what hid both the lost theme normalization and the disabled
 * useThemePrefsMigration. It is not a general log firehose:
 *
 *   - `warn` and `error` only. The client sink's threshold matches.
 *   - at most MAX_EVENTS per request, each message capped, context capped.
 *   - no free-text passthrough beyond the message the app itself authored.
 *
 * FAILURE IS ALWAYS SILENT TO THE CALLER
 * --------------------------------------
 * Telemetry must never be able to break the app that reports it, and a client
 * has no useful response to a rejection: it cannot retry meaningfully and
 * cannot surface an error to the user. So every path returns 204, including an
 * absent credential (the binding is optional — local dev and any deploy without
 * it simply drops events) and a failed upstream call. What went wrong is logged
 * here, where someone can actually see it.
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { logger } from '../logger'
import type { AppContext } from '../types'
import { TelemetryIngestSchema } from '../schemas'

/** Upstream service-tier ingest. One entry per POST is what it accepts. */
const UPSTREAM = 'https://hadoku.me/health/api/telemetry'

/** Caps. Generous enough for real degradation events, tight enough that a
 *  looping client cannot turn this into an amplifier. */
const MAX_EVENTS = 20
const MAX_MESSAGE_CHARS = 300
const MAX_CONTEXT_KEYS = 12
const MAX_CONTEXT_VALUE_CHARS = 200

/** Shrink one context bag to something bounded and JSON-safe. */
function clampContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context).slice(0, MAX_CONTEXT_KEYS)) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
    } else {
      out[k] = String(v).slice(0, MAX_CONTEXT_VALUE_CHARS)
    }
  }
  return out
}

export function createTelemetryRoutes() {
  // The 204-always guarantee has to be enforced at the FRAMEWORK edge, not just
  // in the handler. @hono/zod-openapi validates the declared request body before
  // the handler runs and answers 400 itself, and Hono's JSON parser throws on a
  // malformed body earlier still — so a handler-only guard leaves two paths that
  // hand the client an error.
  //
  // That is not cosmetic. The client sink logs failures, and logging a failure
  // is what produces the next event: a 400 here can feed a post → fail → log →
  // post loop out of the very component that reports problems. Both paths are
  // collapsed to 204 below.
  const app = new OpenAPIHono<AppContext>({
    defaultHook: (result, c) => {
      if (!result.success) {
        logger.warn('[telemetry] rejected client payload at validation', {
          issues: 'error' in result ? result.error.issues.length : 0
        })
        return c.body(null, 204)
      }
      return undefined
    }
  })

  // Malformed JSON never reaches defaultHook — Hono throws while parsing.
  app.onError((err, c) => {
    logger.warn('[telemetry] client payload could not be read', {
      error: err instanceof Error ? err.message : String(err)
    })
    return c.body(null, 204)
  })

  const ingestRoute = createRoute({
    method: 'post',
    path: '/telemetry',
    tags: ['Telemetry'],
    summary: 'Relay client degradation events',
    description:
      'Accepts warn/error client events and forwards them to the monitoring plane with the ' +
      "worker's service credential. Always 204s — telemetry never fails the caller.",
    request: {
      body: {
        content: { 'application/json': { schema: TelemetryIngestSchema } }
      }
    },
    responses: {
      204: { description: 'Accepted (or dropped — the caller cannot tell, by design)' }
    }
  })

  app.openapi(ingestRoute, (async (c: any) => {
    const env = c.env as { MONITORING_INGEST_KEY?: string }

    // Parsed defensively: a malformed body is a dropped event, never a 500 that
    // shows up in the caller's console as an app error.
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.body(null, 204)
    }

    const parsed = TelemetryIngestSchema.safeParse(body)
    if (!parsed.success) {
      logger.warn('[telemetry] rejected malformed client payload', {
        issues: parsed.error.issues.length
      })
      return c.body(null, 204)
    }

    if (!env.MONITORING_INGEST_KEY) {
      // Not an error: local dev and any deploy without the binding simply have
      // nowhere to send. Logged at debug so it does not cry wolf every request.
      logger.debug('[telemetry] no MONITORING_INGEST_KEY binding — dropping events', {
        events: parsed.data.events.length
      })
      return c.body(null, 204)
    }

    const auth = c.get('authContext')
    const events = parsed.data.events.slice(0, MAX_EVENTS)

    // Forwarded one-by-one: the batch endpoint is admin-gated, and this
    // worker's credential is service tier. Volume is bounded by MAX_EVENTS.
    await Promise.all(
      events.map(async ev => {
        try {
          const resp = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Key': env.MONITORING_INGEST_KEY as string
            },
            body: JSON.stringify({
              source: 'browser',
              level: ev.level,
              type: ev.type ?? 'log',
              message: ev.message.slice(0, MAX_MESSAGE_CHARS),
              context: {
                ...clampContext(ev.context),
                // Attribution the client cannot forge: taken from the
                // edge-stamped auth context, not from the payload.
                app: 'task',
                userType: auth?.userType ?? 'public'
              }
            })
          })
          if (!resp.ok) {
            logger.warn('[telemetry] upstream rejected an event', {
              status: resp.status,
              message: ev.message.slice(0, 80)
            })
          }
        } catch (err) {
          logger.warn('[telemetry] upstream post failed', {
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })
    )

    return c.body(null, 204)
  }) as never)

  return app
}
