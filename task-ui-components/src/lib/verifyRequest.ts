/**
 * "Ask to be verified" (J7): the guest's own request row on the edge.
 *
 *   GET  /session/verify-request → { tier, requested, requestedAt }
 *   POST /session/verify-request { reason } → { requested: true, fresh, requestedAt }
 *                                              409 when already verified
 *
 * Same-origin and cookie-authed, like every /session route the settings use.
 * Imported only by the dialog's lazy chunk.
 */
import { verifyRequestOutcome, type VerifyRequestOutcome } from './accountPrompts'

const VERIFY_REQUEST = '/session/verify-request'

/** Whether this person already has a request open; false when it cannot be read. */
export async function verifyRequestOpen(): Promise<boolean> {
  const res = await fetch(VERIFY_REQUEST, { credentials: 'same-origin' })
  if (!res.ok) return false
  const body = (await res.json()) as { requested?: unknown }
  return body.requested === true
}

export async function sendVerifyRequest(reason?: string): Promise<VerifyRequestOutcome> {
  let res: Response
  try {
    res = await fetch(VERIFY_REQUEST, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
  } catch {
    return { kind: 'error', message: 'Not sent: no connection' }
  }
  const body: unknown = await res.json().catch(() => null)
  return verifyRequestOutcome(res.status, body)
}
