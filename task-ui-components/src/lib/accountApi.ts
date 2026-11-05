import type React from 'react'
import { loadSignInClient, type PasskeyAssertion } from './settingsClient'

/**
 * The settings panel's calls to the site's own session routes (service access,
 * the authenticator, the sign-in link): same-origin JSON, the site's `error`
 * thrown as the message.
 */
export async function sessionCall<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

/** A fresh passkey tap from the signed-in person, challenged by `challengePath`. */
export async function stepUp(challengePath?: string, flow?: string): Promise<PasskeyAssertion> {
  const client = await loadSignInClient()
  if (!client?.stepUpPasskey) throw new Error('Passkeys unavailable here')
  return client.stepUpPasskey(challengePath ? { challengePath, flow } : undefined)
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Fired on `window` when the authenticator turns on, so service access (a
 * separate section) shows its mint controls without a reload.
 */
export const AUTHENTICATOR_ON_EVENT = 'hadoku:authenticator-on'

/** The compact layout both sections use inside the 400px panel. */
export const ACCOUNT_STYLES = {
  stack: { display: 'flex', flexDirection: 'column', gap: 8 },
  line: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', wordBreak: 'break-all' },
  code: { width: '7ch', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.1em' },
  qr: { width: 168, height: 168 }
} satisfies Record<string, React.CSSProperties>
