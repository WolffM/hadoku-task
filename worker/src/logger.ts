/**
 * Single logging entrypoint for the task worker.
 *
 * The whole worker logs through `@wolffm/logger` (the consolidated logger) —
 * NOT `@wolffm/worker-utils`' embedded `cloudflareWorkerLogger` fork, and not
 * raw `console.*`. This module is the only place that touches the logger.
 *
 * `logRequest` / `logError` keep the exact signatures of their
 * `@wolffm/worker-utils` namesakes so route files only need to repoint their
 * import here — no call-site rewrites.
 *
 * NOTE: do NOT collapse these to re-exports of `@wolffm/worker-utils/logging`.
 * As of worker-utils 1.2.10 those helpers DO delegate to `@wolffm/logger`, but
 * with a hardcoded `service: 'worker'` tag. This shim deliberately tags
 * `service: 'task-api'` (shared with the `logger` export below, used in
 * index.ts / session.ts), so re-exporting upstream would regress the service
 * tag and split the worker's log identity.
 */
import { createWorkerLogger } from '@wolffm/logger/worker'

export const logger = createWorkerLogger({ service: 'task-api' })

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Structured request log. Mirrors worker-utils' logRequest(method, path, context, level). */
export function logRequest(
  method: string,
  path: string,
  context?: Record<string, unknown>,
  level: LogLevel = 'info'
): void {
  logger[level](`${method} ${path}`, context)
}

/** Structured error log. Mirrors worker-utils' logError(method, path, error, context). */
export function logError(
  method: string,
  path: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  logger.error(`${method} ${path}`, {
    ...context,
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
  })
}
