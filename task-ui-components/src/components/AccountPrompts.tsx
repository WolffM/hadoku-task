/**
 * The two account prompts the settings gear owns (hadoku_site
 * docs/planning/account-journeys-2026-11-18.md, J5 and §4), in a chunk of
 * their own: ConnectedSettings is on every page, and these show for a guest,
 * now and then. ConnectedSettings decides WHEN; this is what they look like.
 *
 *   - VerifyDialog: a guest hit something that needs a verified account.
 *   - KeepAccountBanner: a guest with no passkey, after their first click.
 *
 * Styles are inline for the reason AvatarDialog's are: an app compiles this
 * package's CSS at its own build, so a new rule reaches it only when it
 * rebuilds. Tokens only.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@wolffm/themes'
import { verifyTitle } from '../lib/accountPrompts'
import { sendVerifyRequest, verifyRequestOpen } from '../lib/verifyRequest'
import { addPasskeyHere, switchKeyHref } from '../lib/settingsClient'
import { reportErr } from './settingsShared'

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    // Above the popout's panel (100) and its click-catcher (99).
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    boxSizing: 'border-box',
    padding: '12vh 16px',
    background: 'var(--color-bg-overlay)'
  },
  card: {
    boxSizing: 'border-box',
    width: 'min(400px, 100%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 20,
    borderRadius: 12,
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family)',
    outline: 'none'
  },
  head: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { margin: 0, flex: 1, fontSize: '1.05rem', fontWeight: 600 },
  body: { margin: 0, fontSize: '0.9rem', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  action: { fontSize: '0.85rem', padding: '7px 12px' },
  status: { fontSize: '0.85rem', textAlign: 'center', color: 'var(--color-text-secondary)' },
  later: { alignSelf: 'flex-end', fontSize: '0.85rem', padding: '6px 12px' },
  banner: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    margin: '8px 16px',
    padding: '10px 14px',
    borderRadius: 10,
    background: 'var(--color-primary-bg)',
    color: 'var(--color-on-primary-bg)',
    border: '1px solid var(--color-border)',
    fontSize: '0.9rem'
  },
  bannerFixed: {
    position: 'fixed',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 90,
    maxWidth: 640,
    marginInline: 'auto'
  },
  bannerText: { flex: '1 1 220px', minWidth: 0 },
  bannerActions: { display: 'flex', gap: 8, marginLeft: 'auto' }
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export interface VerifyDialogProps {
  /** What the person was doing ("Saving decks"); titles the dialog. */
  reason?: string
  /** The guest's generated name, "Player 12345". */
  name: string | null
  onClose: () => void
  /** The edge says they are verified already (409): identity has changed. */
  onVerified: () => void
}

type RequestState = 'idle' | 'sending' | 'sent' | 'already' | 'open'

export function VerifyDialog({ reason, name, onClose, onVerified }: VerifyDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [request, setRequest] = useState<RequestState>('idle')
  const [error, setError] = useState<string | null>(null)

  // A request this person already has open shows as Requested, not as a button.
  useEffect(() => {
    let live = true
    verifyRequestOpen()
      .then(open => {
        if (live && open) setRequest(r => (r === 'idle' ? 'open' : r))
      })
      .catch(reportErr)
    return () => {
      live = false
    }
  }, [])

  // Focus starts on the first action and stays inside; Escape closes; focus
  // goes back where it was.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    const card = cardRef.current
    ;(card?.querySelector<HTMLElement>(FOCUSABLE) ?? card)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Not the popout's Escape, nor any other listener's.
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !card) return
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || !card.contains(at))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !card.contains(at))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (back && document.contains(back)) back.focus()
    }
  }, [])

  const ask = useCallback(async () => {
    setRequest('sending')
    setError(null)
    const outcome = await sendVerifyRequest(reason)
    if (outcome.kind === 'verified') {
      onVerified()
      onCloseRef.current()
      return
    }
    if (outcome.kind === 'error') {
      setError(outcome.message)
      setRequest('idle')
      return
    }
    setRequest(outcome.kind)
  }, [reason, onVerified])

  const status =
    request === 'sent'
      ? 'Request sent'
      : request === 'already'
        ? 'Already requested'
        : request === 'open'
          ? 'Requested'
          : null

  return createPortal(
    <div style={S.overlay} onClick={onClose}>
      <div
        ref={cardRef}
        className="verify-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={S.card}
        onClick={e => e.stopPropagation()}
      >
        <div style={S.head}>
          <Icon name="shield" size={20} />
          <h2 id={titleId} style={S.title}>
            {verifyTitle(reason)}
          </h2>
        </div>
        <p id={bodyId} style={S.body}>
          {name ? `You're playing as ${name}.` : "You're playing as a guest."}
        </p>
        <div style={S.actions}>
          <button
            type="button"
            className="settings-popout__btn settings-popout__btn--primary"
            style={S.action}
            onClick={() => window.location.assign(switchKeyHref())}
          >
            I already have an account
          </button>
          {status ? (
            <span style={S.status} role="status">
              {status}
            </span>
          ) : (
            <button
              type="button"
              className="settings-popout__btn"
              style={S.action}
              disabled={request === 'sending'}
              onClick={() => {
                ask().catch(reportErr)
              }}
            >
              {request === 'sending' ? 'Sending…' : 'Ask to be verified'}
            </button>
          )}
          {error && (
            <span className="settings-popout__error" role="alert">
              {error}
            </span>
          )}
        </div>
        <button type="button" className="settings-popout__btn" style={S.later} onClick={onClose}>
          Not now
        </button>
      </div>
    </div>,
    document.body
  )
}

export interface KeepAccountBannerProps {
  name: string | null
  /** Under the AppHeader (its notice slot); null pins it to the viewport. */
  host: HTMLElement | null
  onSaved: () => void
  onLater: () => void
}

export function KeepAccountBanner({ name, host, onSaved, onLater }: KeepAccountBannerProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])

  const save = async () => {
    const c = new AbortController()
    ctl.current = c
    setBusy(true)
    setError(null)
    try {
      if ((await addPasskeyHere(c.signal)) === 'saved') onSaved()
    } catch (err) {
      if (!c.signal.aborted) setError((err as Error)?.message || 'Passkey not saved')
    } finally {
      if (ctl.current === c) ctl.current = null
      setBusy(false)
    }
  }

  const banner = (
    <div
      className="keep-account-banner"
      role="region"
      aria-label="Keep this account"
      style={host ? S.banner : { ...S.banner, ...S.bannerFixed }}
    >
      <Icon name="key" size={18} />
      <span style={S.bannerText}>
        {name
          ? `You're playing as ${name} on this device only.`
          : "You're playing on this device only."}
      </span>
      {error && (
        <span className="settings-popout__error" role="alert">
          {error}
        </span>
      )}
      <span style={S.bannerActions}>
        <button
          type="button"
          className="settings-popout__btn settings-popout__btn--primary"
          style={S.action}
          disabled={busy}
          onClick={() => void save()}
        >
          Save a passkey
        </button>
        <button
          type="button"
          className="settings-popout__btn"
          style={S.action}
          onClick={() => {
            ctl.current?.abort()
            onLater()
          }}
        >
          Later
        </button>
      </span>
    </div>
  )
  return createPortal(banner, host ?? document.body)
}
