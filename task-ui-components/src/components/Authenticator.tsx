import React, { useCallback, useEffect, useState } from 'react'
import { renderSVG } from 'uqr'
import {
  ACCOUNT_STYLES as S,
  AUTHENTICATOR_ON_EVENT,
  errorMessage,
  sessionCall,
  stepUp
} from '../lib/accountApi'
import { CodeInput, isCode } from './CodeInput'

/**
 * The person's own authenticator, and the sign-in link it makes (hadoku_site
 * workers/edge-router/src/authenticator-handlers.ts). Each step unlocks the
 * next: a saved passkey (ConnectedSettings mounts this only then), then the
 * authenticator app, set up with a passkey tap and confirmed with one code,
 * then a one-time link that signs another device in as this person. The link
 * works once, for 15 minutes, and making one cancels the last.
 *
 * Lazy (React.lazy in ConnectedSettings), so the QR encoder costs only someone
 * who has a passkey and opens the Account tab.
 */

interface State {
  passkeys: number
  totp: 'none' | 'pending' | 'active'
}

interface Link {
  link: string
  expiresAt: number
}

const CHALLENGE = '/session/authenticator/challenge'

/** Why a code was refused, in words. */
function refusal(err: unknown): string {
  const m = errorMessage(err)
  if (m === 'wrong') return 'That code is not right'
  if (m === 'replayed') return 'That code was just used; wait for the next one'
  if (m === 'locked') return 'Too many wrong codes; try again later'
  if (m === 'not-enrolled') return 'Set up the authenticator first'
  return m
}

const minutesLeft = (expiresAt: number) =>
  `${Math.max(1, Math.round((expiresAt - Date.now()) / 60_000))} min, works once`

export function Authenticator() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enrol, setEnrol] = useState<{ uri: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [link, setLink] = useState<Link | null>(null)

  const load = useCallback(async () => {
    setState(await sessionCall<State>('/session/authenticator'))
  }, [])

  useEffect(() => {
    load().catch((err: unknown) => setError(errorMessage(err)))
  }, [load])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(refusal(err))
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

  const on = state.totp === 'active'

  return (
    <div style={S.stack}>
      <span style={S.line}>
        <span className="settings-popout__label" style={S.grow}>
          Authenticator
        </span>
        {on ? (
          <span className="settings-popout__hint">On</span>
        ) : (
          !enrol && (
            <button
              type="button"
              className="settings-popout__btn settings-popout__btn--primary"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  setEnrol(
                    await sessionCall<{ uri: string; secret: string }>(
                      '/session/authenticator/start',
                      { assertion: await stepUp(CHALLENGE, 'authenticator') }
                    )
                  )
                }).catch(console.error)
              }}
            >
              Set up
            </button>
          )
        )}
      </span>

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
            <CodeInput value={code} onChange={setCode} />
            <button
              type="button"
              className="settings-popout__btn settings-popout__btn--primary"
              disabled={busy || !isCode(code)}
              onClick={() => {
                run(async () => {
                  await sessionCall('/session/authenticator/confirm', { code })
                  setEnrol(null)
                  setCode('')
                  await load()
                  window.dispatchEvent(new Event(AUTHENTICATOR_ON_EVENT))
                }).catch(console.error)
              }}
            >
              Confirm
            </button>
          </span>
        </div>
      )}

      {on && (
        <span style={S.line}>
          <span className="settings-popout__label" style={S.grow}>
            Sign-in link
          </span>
          <CodeInput value={code} onChange={setCode} />
          <button
            type="button"
            className="settings-popout__btn settings-popout__btn--primary"
            disabled={busy || !isCode(code)}
            onClick={() => {
              run(async () => {
                setLink(await sessionCall<Link>('/session/sign-in-link', { code }))
                setCode('')
              }).catch(console.error)
            }}
          >
            Create Code
          </button>
        </span>
      )}

      {link && (
        <div style={S.stack} aria-label="Sign-in link">
          <span
            role="img"
            aria-label="Sign-in link QR code"
            style={S.qr}
            dangerouslySetInnerHTML={{ __html: renderSVG(link.link) }}
          />
          <span style={S.mono}>{link.link}</span>
          <span style={S.line}>
            <span className="settings-popout__hint" style={S.grow}>
              {minutesLeft(link.expiresAt)}
            </span>
            <button
              type="button"
              className="settings-popout__btn"
              onClick={() => {
                navigator.clipboard.writeText(link.link).catch(console.error)
              }}
            >
              Copy
            </button>
            <button type="button" className="settings-popout__btn" onClick={() => setLink(null)}>
              Hide
            </button>
          </span>
        </div>
      )}

      {error && (
        <span className="settings-popout__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
