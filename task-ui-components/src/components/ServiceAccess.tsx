import React, { useCallback, useEffect, useState } from 'react'
import {
  ACCOUNT_STYLES as S,
  AUTHENTICATOR_ON_EVENT,
  errorMessage as message,
  sessionCall,
  stepUp
} from '../lib/accountApi'
import { CodeInput, isCode } from './CodeInput'

/**
 * Service access: a grantee's own credentials for the service identities the
 * operator granted them (hadoku_site docs/planning/service-grants-2026-10-31.md).
 *
 * A credential takes a passkey tap and a current code from the person's
 * authenticator, which they set up in the Authenticator section above
 * (Authenticator.tsx); until it is on, this section says so. The key is shown
 * once and lives 7 days.
 *
 * Mounted only for a grantee (React.lazy in ConnectedSettings), so the state
 * read costs a grantee one chunk and everyone else nothing.
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

const call = <T,>(path: string, body?: unknown) => sessionCall<T>(`${BASE}${path}`, body)

function left(expiresAt: number | null): string {
  if (expiresAt === null) return ''
  const h = Math.floor((expiresAt - Date.now()) / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d left` : h >= 1 ? `${h}h left` : 'under 1h left'
}

export function ServiceAccess() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [minted, setMinted] = useState<{ key: string; name: string; expiresAt: number } | null>(
    null
  )

  const load = useCallback(async () => {
    setState(await call<State>(''))
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(message(err)))
    // The authenticator section turning on unlocks minting here.
    const reload = () => {
      load().catch((err: unknown) => setError(message(err)))
    }
    window.addEventListener(AUTHENTICATOR_ON_EVENT, reload)
    return () => window.removeEventListener(AUTHENTICATOR_ON_EVENT, reload)
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

  const codeOk = isCode(code)

  return (
    <div style={S.stack}>
      {state.totp !== 'active' && (
        <span className="settings-popout__hint">
          Minting takes the authenticator: set it up above.
        </span>
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
          <CodeInput value={code} onChange={setCode} />
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
