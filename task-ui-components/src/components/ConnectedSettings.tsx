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
 * Mirrors ThemePicker's controlled-popout pattern: owns its own `open` state +
 * a full-viewport overlay for click-outside dismiss. The content pill renders
 * `maxLevel` segments (friend ⇒ 3, admin ⇒ 4) and is hidden for public callers.
 * maxLevel comes from the server so the tier ceiling is never trusted from the
 * client.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsIcon } from './ThemeIcons'
import {
  getContentLevel,
  setContentLevel,
  setDisplayName,
  swapAuthKey,
  whoami,
  type ContentLevelState,
  type Tier
} from '../lib/settingsClient'
import '../app-header.css'

export interface ConnectedSettingsProps {
  /** Caller's tier. Omit to self-resolve via whoami(). */
  userType?: Tier
  /** Display name. Omit to self-resolve via whoami(). */
  name?: string | null
  /** Notify the host (e.g. a "Signed in as …" label) of a rename. */
  onNameChange?: (name: string | null) => void
  /** Optional extra class on the root. */
  className?: string
  /** App-specific settings rendered as a final section in the same popout —
   *  so an app with its own preferences keeps ONE unified gear + modal instead
   *  of a second control. Shown under an "App preferences" divider. */
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
  friend: 'Friend',
  service: 'Service',
  public: 'Guest'
}

export function ConnectedSettings({
  userType: userTypeProp,
  name: nameProp,
  onNameChange,
  className = '',
  children
}: ConnectedSettingsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Identity — from props if supplied, else resolved lazily via whoami().
  const [userType, setUserType] = useState<Tier>(userTypeProp ?? 'public')
  const [resolvedName, setResolvedName] = useState<string | null>(nameProp ?? null)
  const identityLoaded = useRef(userTypeProp !== undefined)

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
  const contentLoaded = useRef(false)

  const showContentPill = userType === 'admin' || userType === 'friend' || userType === 'service'

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

  // Lazy-resolve identity the first time the popout opens (only if the host
  // did not supply userType — otherwise props are the source of truth).
  useEffect(() => {
    if (!open || identityLoaded.current) return
    identityLoaded.current = true
    whoami()
      .then(id => {
        setUserType(id.userType)
        setResolvedName(id.name)
        setLocalName(id.name)
        setNameDraft(id.name ?? '')
      })
      .catch(reportErr)
  }, [open])

  // Lazy-load the content level the first time the popout opens.
  useEffect(() => {
    if (!open || contentLoaded.current || !showContentPill) return
    contentLoaded.current = true
    getContentLevel()
      .then(state => {
        if (state) setContent(state)
      })
      .catch(reportErr)
  }, [open, showContentPill])

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

  return (
    <div className={`settings-popout ${className}`.trim()} ref={rootRef}>
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

          {/* Access tier */}
          <section className="settings-popout__row">
            <span className="settings-popout__label">Access tier</span>
            <span className={`settings-popout__tier settings-popout__tier--${userType}`}>
              {TIER_LABEL[userType]}
            </span>
          </section>

          {/* Display name */}
          <section className="settings-popout__row">
            <span className="settings-popout__label">Display name</span>
            {editingName ? (
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

          {/* Content visibility level */}
          {showContentPill && (
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
                <span className="settings-popout__hint">Loading…</span>
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
                  {keySwapping ? '…' : 'Switch'}
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
