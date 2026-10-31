import React, { useCallback, useEffect, useState } from 'react'
import { renderSVG } from 'uqr'
import { loadSignInClient, type PasskeyAssertion } from '../lib/settingsClient'

/**
 * Service access: a grantee's own credentials for the service identities the
 * operator granted them (hadoku_site docs/planning/service-grants-2026-10-31.md).
 *
 * Two steps, both behind a fresh passkey tap:
 *   1. enrol an authenticator app once (the QR is shown once, then confirmed
 *      with one code);
 *   2. mint a credential: passkey tap + a current code. The key is shown once
 *      and lives 7 days.
 *
 * Loaded only when opened (React.lazy in ConnectedSettings), so the QR encoder
 * costs a grantee one chunk and everyone else nothing.
 */

const BASE = '/session/service-access'

interface Grant {
  identityUserId: string
  name: string | null
}

interface Credential {
  prefix: string
  identityUserId: string
  name: string | null
  expiresAt: number | null
  lastSeenAt: number
  live: boolean
}

interface State {
  grants: Grant[]
  totp: 'none' | 'pending' | 'active'
  credentials: Credential[]
}

const S = {
  stack: { display: 'flex', flexDirection: 'column', gap: 8 },
  line: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', wordBreak: 'break-all' },
  code: { width: '7ch', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.1em' },
  qr: { width: 168, height: 168 }
} satisfies Record<string, React.CSSProperties>

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

async function stepUp(): Promise<PasskeyAssertion> {
  const client = await loadSignInClient()
  if (!client?.stepUpPasskey) throw new Error('Passkeys unavailable here')
  return client.stepUpPasskey()
}

function left(expiresAt: number | null): string {
  if (expiresAt === null) return ''
  const h = Math.floor((expiresAt - Date.now()) / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d left` : h >= 1 ? `${h}h left` : 'under 1h left'
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function ServiceAccess() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enrol, setEnrol] = useState<{ uri: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [minted, setMinted] = useState<{ key: string; name: string; expiresAt: number } | null>(
    null
  )

  const load = useCallback(async () => {
    setState(await call<State>(''))
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(message(err)))
  }, [load])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <span className="settings-popout__hint" role={error ? 'alert' : undefined}>
        {error ?? '…'}
      </span>
    )
  }

  const codeOk = /^\d{6}$/.test(code)
  const codeInput = (
    <input
      value={code}
      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      aria-label="Authenticator code"
      className="settings-popout__input"
      style={S.code}
    />
  )

  return (
    <div style={S.stack}>
      {state.totp !== 'active' && !enrol && (
        <span style={S.line}>
          <span className="settings-popout__label" style={S.grow}>
            Authenticator
          </span>
          <button
            type="button"
            className="settings-popout__btn settings-popout__btn--primary"
            disabled={busy}
            onClick={() => {
              run(async () => {
                setEnrol(
                  await call<{ uri: string; secret: string }>('/totp/start', {
                    assertion: await stepUp()
                  })
                )
              }).catch(console.error)
            }}
          >
            Set up
          </button>
        </span>
      )}

      {enrol && (
        <div style={S.stack}>
          <span
            role="img"
            aria-label="Authenticator QR code"
            style={S.qr}
            dangerouslySetInnerHTML={{ __html: renderSVG(enrol.uri) }}
          />
          <span style={S.mono}>{enrol.secret}</span>
          <span style={S.line}>
            {codeInput}
            <button
              type="button"
              className="settings-popout__btn settings-popout__btn--primary"
              disabled={busy || !codeOk}
              onClick={() => {
                run(async () => {
                  await call('/totp/confirm', { code })
                  setEnrol(null)
                  setCode('')
                  await load()
                }).catch(console.error)
              }}
            >
              Confirm
            </button>
          </span>
        </div>
      )}

      {minted && (
        <div style={S.stack}>
          <span className="settings-popout__label">
            {minted.name} · shown once · {left(minted.expiresAt)}
          </span>
          <span style={S.mono}>{minted.key}</span>
          <span style={S.line}>
            <button
              type="button"
              className="settings-popout__btn"
              onClick={() => {
                navigator.clipboard.writeText(minted.key).catch(console.error)
              }}
            >
              Copy
            </button>
            <button type="button" className="settings-popout__btn" onClick={() => setMinted(null)}>
              Hide
            </button>
          </span>
        </div>
      )}

      {state.totp === 'active' && (
        <span style={S.line}>
          <span className="settings-popout__label" style={S.grow}>
            Code
          </span>
          {codeInput}
        </span>
      )}

      {state.totp === 'active' &&
        state.grants.map(g => (
          <span key={g.identityUserId} style={S.line}>
            <span className="settings-popout__label" style={{ ...S.grow, ...S.mono }}>
              {g.name ?? g.identityUserId}
            </span>
            <button
              type="button"
              className="settings-popout__btn settings-popout__btn--primary"
              disabled={busy || !codeOk}
              onClick={() => {
                run(async () => {
                  const assertion = await stepUp()
                  const out = await call<{ key: string; name: string; expiresAt: number }>(
                    '/mint',
                    {
                      identityUserId: g.identityUserId,
                      assertion,
                      totp: code
                    }
                  )
                  setCode('')
                  setMinted(out)
                  await load()
                }).catch(console.error)
              }}
            >
              Mint
            </button>
          </span>
        ))}

      {state.credentials
        .filter(c => c.live)
        .map(c => (
          <span key={c.prefix} style={S.line}>
            <span style={{ ...S.grow, ...S.mono }}>
              {c.prefix}… {c.name}
            </span>
            <span className="settings-popout__hint">{left(c.expiresAt)}</span>
            <button
              type="button"
              className="settings-popout__btn"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  await call('/revoke', { prefix: c.prefix })
                  await load()
                }).catch(console.error)
              }}
            >
              Revoke
            </button>
          </span>
        ))}

      {error && (
        <span className="settings-popout__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
