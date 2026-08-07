/**
 * ConnectedSettings — the unified per-user settings control for the hadoku
 * ecosystem: a gear button that opens a popout housing everything that is a
 * property of the PERSON (not the app):
 *   - current access tier (read-only, friendly label)
 *   - display name (inline edit → POST /session/name)
 *   - global content-visibility level (tiered pill → PUT /prefs/api/v1/content-level)
 *   - auth key swap (→ POST /session/create, reloads on success)
 *
 * "Connected" (parallel to ConnectedThemePicker): it self-wires to the
 * hadoku.me edge-router via same-origin fetches (see lib/settingsClient), so
 * dropping `<ConnectedSettings />` into any app under hadoku.me needs zero
 * props. Identity is resolved via whoami() unless the host passes `userType` /
 * `name` (avoids a redundant fetch when the app already knows).
 *
 * All of that is resolved AT MOUNT via `prefetchSettings()`, never on
 * gear-click — opening the popout must cost zero requests. See the effect
 * below, and `e2e/settings-prefetch.spec.ts` in hadoku-task, which fails if the
 * fetch moves back behind the click.
 *
 * Mirrors ThemePicker's controlled-popout pattern: owns its own `open` state +
 * a full-viewport overlay for click-outside dismiss. The content pill renders
 * `maxLevel` segments (friend ⇒ 3, admin ⇒ 4) and is hidden for public callers.
 * maxLevel comes from the server so the tier ceiling is never trusted from the
 * client.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsIcon } from './ThemeIcons'
import {
  prefetchSettings,
  setContentLevel,
  setDisplayName,
  swapAuthKey,
  type ContentLevelState,
  type Tier
} from '../lib/settingsClient'
import '../app-header.css'

export interface ConnectedSettingsProps {
  /** Caller's tier. Omit to self-resolve via whoami().
   *
   *  This exists for apps that CANNOT reach `/session/whoami` — conjure sits
   *  behind a path-prefixed shim that serves nothing outside `/conjure`, so
   *  whoami 404s and the tier would fall back to guest. It is an identity
   *  hint, not a way to present a different tier than the edge assigns: every
   *  gate that matters is enforced server-side off the edge-stamped tier. */
  userType?: Tier
  /** Display name. Omit to self-resolve via whoami(). Same rationale. */
  name?: string | null
  /** Notify the host (e.g. a "Signed in as …" label) of a rename. */
  onNameChange?: (name: string | null) => void
  /** App-specific settings rendered as a final section in the same popout, so
   *  an app with its own preferences keeps ONE unified gear instead of a second
   *  control. Shown under an "App preferences" divider.
   *
   *  This slot is deliberately unconstrained — put whatever the app needs in
   *  it. The constraint is only that it lands AFTER the four canonical rows and
   *  cannot change them. */
  children?: React.ReactNode
}

/** Rejection sink for fire-and-forget settings actions. The client helpers
 *  already resolve to null on failure (state reflects it), so this only trips
 *  on truly unexpected throws — log rather than swallow silently. */
function reportErr(err: unknown) {
  // task-ui-components v2 dropped its logger; keep the package dependency-free.
  console.error('[ConnectedSettings] action failed', (err as Error)?.message ?? err)
}

const TIER_LABEL: Record<Tier, string> = {
  admin: 'Administrator',
  wife: 'Wife',
  service: 'Service',
  friend: 'Friend',
  public: 'Guest'
}

export function ConnectedSettings({
  userType: userTypeProp,
  name: nameProp,
  onNameChange,
  children
}: ConnectedSettingsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Identity — from props if supplied, else resolved lazily via whoami().
  const [userType, setUserType] = useState<Tier>(userTypeProp ?? 'public')
  const [resolvedName, setResolvedName] = useState<string | null>(nameProp ?? null)

  // Name editing
  const [nameDraft, setNameDraft] = useState(resolvedName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [displayName, setLocalName] = useState<string | null>(resolvedName)

  // Key swap
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keySwapping, setKeySwapping] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  // Content level
  const [content, setContent] = useState<ContentLevelState | null>(null)
  const [levelSaving, setLevelSaving] = useState(false)

  // One flag for the whole prefetch, not one per request — the panel body
  // reveals when everything has settled, so nothing pops in a beat late. In
  // practice the user never sees it: the prefetch starts at mount and is long
  // done by the time the gear is clicked. It only shows if they click within
  // the first moments of the page.
  const [resolving, setResolving] = useState(true)

  // Everyone who is SIGNED IN, expressed as "not public" rather than as a list
  // of tiers. The list form (`=== 'admin' || === 'friend' || === 'service'`)
  // is an exact-match allowlist: it silently excluded `wife` the moment that
  // tier existed, which is the failure the rank model is meant to prevent.
  // There is no rank helper in this bundle, but "above public" needs none.
  const showContentPill = userType !== 'public'

  // Keep local identity in sync when the host controls it via props.
  useEffect(() => {
    if (userTypeProp !== undefined) setUserType(userTypeProp)
  }, [userTypeProp])
  useEffect(() => {
    if (nameProp !== undefined) {
      setResolvedName(nameProp)
      setLocalName(nameProp)
      setNameDraft(nameProp ?? '')
    }
  }, [nameProp])

  // Resolve everything the panel shows AT MOUNT — not on open.
  //
  // This used to be gated on `open`, which made the gear the trigger for
  // whoami + content-level (167ms / 186ms on prod, concurrent) — a round trip
  // the user waited out with the panel already on screen and blank. Nothing
  // about that data depends on the click:
  // it's the signed-in user's own identity, settled at boot and unchanged for
  // the life of the page. So it rides along with the app's boot traffic, and
  // clicking the gear costs zero requests. `e2e/settings-prefetch.spec.ts` in
  // hadoku-task pins that.
  //
  // The client memoises across callers, so mounting this in several places (or
  // remounting it) does not multiply requests, and on hadoku.me the identity
  // half is free — it awaits the whoami the shell already had in flight.
  useEffect(() => {
    let live = true
    prefetchSettings({ userType: userTypeProp, name: nameProp })
      .then(({ identity, content: state }) => {
        if (!live) return
        // Props stay authoritative: the host passed them because it can see an
        // identity this component can't resolve for itself.
        if (userTypeProp === undefined) {
          setUserType(identity.userType)
          setResolvedName(identity.name)
          setLocalName(identity.name)
          setNameDraft(identity.name ?? '')
        }
        if (state) setContent(state)
      })
      .catch(reportErr)
      .finally(() => {
        if (live) setResolving(false)
      })
    return () => {
      live = false
    }
    // Hints are read once, on the first mount that gets there — the prefetch is
    // page-scoped and a later prop change cannot un-issue it. Identity changes
    // arrive through the sync effects above, and a key swap reloads the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === displayName) {
      setEditingName(false)
      return
    }
    setNameSaving(true)
    const stored = await setDisplayName(trimmed)
    setNameSaving(false)
    if (stored !== null) {
      setLocalName(stored)
      setNameDraft(stored)
      onNameChange?.(stored)
    }
    setEditingName(false)
  }, [nameDraft, displayName, onNameChange])

  const pickLevel = useCallback(
    async (level: number) => {
      if (!content || level === content.level || levelSaving) return
      const prev = content
      setContent({ ...content, level }) // optimistic
      setLevelSaving(true)
      const result = await setContentLevel(level)
      setLevelSaving(false)
      setContent(result ?? prev) // adopt server truth, or revert
    },
    [content, levelSaving]
  )

  const doKeySwap = useCallback(async () => {
    const key = keyDraft.trim()
    if (!key) return
    setKeySwapping(true)
    setKeyError(null)
    const result = await swapAuthKey(key)
    if (!result) {
      setKeySwapping(false)
      setKeyError('That key was not accepted.')
      return
    }
    // New session established — reload so every surface re-reads identity.
    window.location.reload()
  }, [keyDraft])

  // No caller-supplied class on the root. The four rows below are the
  // platform's, not the app's, and a className here is enough to restyle or
  // hide any of them — which is the drift this component exists to prevent.
  // Apps extend via `children`, never by reaching into this markup.
  return (
    <div className="settings-popout" ref={rootRef}>
      <button
        type="button"
        className="settings-toggle-btn"
        aria-label="User settings"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <SettingsIcon />
      </button>

      {open && <div className="settings-popout__overlay" onClick={() => setOpen(false)} />}

      {open && (
        <div className="settings-popout__panel" role="dialog" aria-label="User settings">
          <div className="settings-popout__header">Settings</div>

          {/* Access tier. While resolving, the state still says 'public' —
              rendering "Guest" there would be a wrong answer that corrects
              itself a moment later, which reads exactly like the lag this
              placeholder exists to remove. */}
          <section className="settings-popout__row">
            <span className="settings-popout__label">Access tier</span>
            {resolving ? (
              <span className="settings-popout__value">…</span>
            ) : (
              <span className={`settings-popout__tier settings-popout__tier--${userType}`}>
                {TIER_LABEL[userType]}
              </span>
            )}
          </section>

          {/* Display name */}
          <section className="settings-popout__row">
            <span className="settings-popout__label">Display name</span>
            {resolving ? (
              <span className="settings-popout__value">…</span>
            ) : editingName ? (
              <span className="settings-popout__inline">
                <input
                  className="settings-popout__input"
                  value={nameDraft}
                  maxLength={64}
                  autoFocus
                  disabled={nameSaving}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      saveName().catch(reportErr)
                    }
                    if (e.key === 'Escape') {
                      setEditingName(false)
                      setNameDraft(displayName ?? '')
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-popout__btn settings-popout__btn--primary"
                  disabled={nameSaving}
                  onClick={() => {
                    saveName().catch(reportErr)
                  }}
                >
                  {nameSaving ? '…' : 'Save'}
                </button>
              </span>
            ) : (
              <span className="settings-popout__inline">
                <span className="settings-popout__value">{displayName || 'Unnamed'}</span>
                <button
                  type="button"
                  className="settings-popout__btn"
                  onClick={() => {
                    setNameDraft(displayName ?? '')
                    setEditingName(true)
                  }}
                >
                  Edit
                </button>
              </span>
            )}
          </section>

          {/* Content visibility level. Held back until the first-open fetch
              settles, so it lands in the same paint as the tier and name
              rather than a round trip behind them. `content` is fetched
              concurrently with whoami(), so by then it is already here. */}
          {!resolving && showContentPill && (
            <section className="settings-popout__row settings-popout__row--stack">
              <span className="settings-popout__label">Content visibility</span>
              {content ? (
                <>
                  <div
                    className="settings-popout__pill"
                    role="radiogroup"
                    aria-label="Content visibility level"
                  >
                    {Array.from({ length: content.maxLevel }, (_, i) => i + 1).map(lvl => (
                      <button
                        key={lvl}
                        type="button"
                        role="radio"
                        aria-checked={lvl === content.level}
                        aria-label={`Level ${lvl}`}
                        className={`settings-popout__seg${
                          lvl <= content.level ? ' settings-popout__seg--filled' : ''
                        }`}
                        disabled={levelSaving}
                        onClick={() => {
                          pickLevel(lvl).catch(reportErr)
                        }}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                  <span className="settings-popout__hint">
                    Higher levels reveal more mature content across apps. Level 1 is
                    safe-for-everyone.
                  </span>
                </>
              ) : (
                // Not "Loading…" — the fetch has already settled by the time
                // this section renders at all, so a null here means it failed.
                <span className="settings-popout__hint">Currently unavailable.</span>
              )}
            </section>
          )}

          {/* Auth key swap */}
          <section className="settings-popout__row settings-popout__row--stack">
            <span className="settings-popout__label">Access key</span>
            {showKeyInput ? (
              <span className="settings-popout__inline">
                <input
                  className="settings-popout__input"
                  type="password"
                  placeholder="New access key"
                  value={keyDraft}
                  autoFocus
                  disabled={keySwapping}
                  onChange={e => setKeyDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      doKeySwap().catch(reportErr)
                    }
                    if (e.key === 'Escape') {
                      setShowKeyInput(false)
                      setKeyDraft('')
                      setKeyError(null)
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-popout__btn settings-popout__btn--primary"
                  disabled={keySwapping}
                  onClick={() => {
                    doKeySwap().catch(reportErr)
                  }}
                >
                  {keySwapping ? '…' : 'Apply'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="settings-popout__btn"
                onClick={() => setShowKeyInput(true)}
              >
                Change key…
              </button>
            )}
            {keyError && <span className="settings-popout__error">{keyError}</span>}
          </section>

          {/* App-specific settings (optional) — same popout, one gear. */}
          {children && (
            <section className="settings-popout__row settings-popout__row--stack settings-popout__app">
              {children}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
