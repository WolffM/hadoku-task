/**
 * The /health response body.
 *
 * Zod-free on purpose: root answers /health itself (index.ts) so a cold isolate
 * serves it without loading any route group or schema. routes/misc.ts registers
 * the documented route around the same body, which is what the spec describes.
 *
 * Inlined rather than delegated to worker-utils' healthCheck(), which returns a
 * bare Response and so cannot be checked against the route. It derives status
 * from the checks, and the only check passed here is a hardcoded `true`, so it
 * always answered 200/ok.
 */
export function healthBody() {
  return {
    status: 'ok' as const,
    service: 'task-api-adapter' as const,
    timestamp: new Date().toISOString(),
    checks: { kv: true }
  }
}
