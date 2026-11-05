/**
 * The site's own settings tabs — Profile, Content and Account — split out of
 * ConnectedSettings into a chunk of their own (#111). The gear, the prefetch,
 * the tab strip and the app's tabs stay in ConnectedSettings, which every page
 * of every app loads; this body is fetched when the popout first opens (and
 * preloaded on the gear's hover/focus), so a page view that never opens
 * settings never downloads it.
 *
 * Mounted for as long as the popout is open, whichever tab shows, so a draft
 * or a passkey prompt survives a trip to an app tab. Closing the popout
 * unmounts it, and that abandons an open passkey prompt quietly.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { NAME_EVENT, type NameEventDetail } from '../lib/nameEvent'
import {
  deleteOwnAccount,
  setContentLevel,
  setDisplayName,
  loadSignIn,
  loadSignInClient,
  passkeyHref,
  passkeysSupported,
  switchKeyHref,
  type ContentLevelState,
  type Tier
} from '../lib/settingsClient'
import { PASSKEY_PULSE_CLASS, reportErr } from './settingsShared'

// The authenticator, and a grantee's own service credentials (with a QR
// encoder for TOTP enrolment): each its own chunk, fetched only when shown.
const Authenticator = React.lazy(() =>
  import('./Authenticator').then(m => ({ default: m.Authenticator }))
)
const ServiceAccess = React.lazy(() =>
  import('./ServiceAccess').then(m => ({ default: m.ServiceAccess }))
)
// The avatar builder (with AvatarPicker and the whole cosmetics catalogue) and
// the linked-accounts row are opened now and then, so each is its own chunk too:
// the dialog's is fetched on the first hover/focus/click of Change, the linked
// accounts' when the Account tab shows.
const loadAvatarDialog = () => import('./AvatarDialog')
const AvatarDialog = React.lazy(() => loadAvatarDialog().then(m => ({ default: m.AvatarDialog })))
const LinkedAccounts = React.lazy(() =>
  import('./LinkedAccounts').then(m => ({ default: m.LinkedAccounts }))
)

/** Rejects once `signal` aborts, so a call that ignores the signal (an older
 *  site client, a prompt that never settles) still lets the UI go. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error('cancelled'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

/** Abort reason when the popout closes: a dismissal, not an error to show. */
const CLOSED = 'closed'

const TIER_LABEL: Record<Tier, string> = {
  admin: 'Administrator',
  wife: 'Wife',
  service: 'Service',
  friend: 'Friend',
  member: 'Member',
  public: 'Guest'
}

/** A member the operator made or verified reads as such; every other tier is verified by rank. */
function tierLabel(tier: Tier, verified: boolean): string {
  return tier === 'member' && verified ? 'Member-verified' : TIER_LABEL[tier]
}

export interface SettingsSiteTabsProps {
  /** The popout's active tab; this renders only for profile, content, account. */
  activeTab: string
  /** The mount-time prefetch has not settled yet. */
  resolving: boolean
  userType: Tier
  /** The operator verified this person (whoami.verified). */
  verified: boolean
  displayName: string | null
  /** A rename was saved; the shell keeps the name across opens. */
  onNameSaved: (name: string | null) => void
  onNameChange?: (name: string | null) => void
  content: ContentLevelState | null
  setContent: (state: ContentLevelState) => void
  /** Signed in with no passkey: Save passkey leads and pulses. */
  needsPasskey: boolean
  /** How many passkeys sign this person in, from whoami; null = unknown. */
  passkeyCount: number | null
  passkeySaved: boolean
  onPasskeySaved: () => void
  serviceGrants: number
  /** The Switch key form is open; outlives a close of the popout. */
  keyFormOpen: boolean
  setKeyFormOpen: (open: boolean) => void
  /** The avatar dialog is the shell's to know about: its Escape is not the popout's. */
  avatarOpen: boolean
  setAvatarOpen: (open: boolean) => void
}

export function SettingsSiteTabs({
  activeTab,
  resolving,
  userType,
  verified,
  displayName,
  onNameSaved,
  onNameChange,
  content,
  setContent,
  needsPasskey,
  passkeyCount,
  passkeySaved,
  onPasskeySaved,
  serviceGrants,
  keyFormOpen,
  setKeyFormOpen,
  avatarOpen,
  setAvatarOpen
}: SettingsSiteTabsProps) {
  // Name editing
  const [nameDraft, setNameDraft] = useState(displayName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Key swap. The draft lives only in this state and the input: it is never
  // logged, stored or sent anywhere but the site's sign-in client. Whether the
  // form is open is the shell's, so it is still open when the popout reopens.
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  // Passkeys, through the same site client: save one while signed in, or
  // sign in with one from the key form. One prompt at a time, and always
  // cancellable: a password manager can dismiss the browser's prompt without
  // ever answering it, so Cancel, closing the popout and the site client's own
  // time limit each end the wait.
  const [passkeyMode, setPasskeyMode] = useState<'save' | 'signin' | null>(null)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  // Delete account: one click arms it, a second, separate button confirms.
  const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const passkeyCtl = useRef<AbortController | null>(null)
  const cancelPasskey = useCallback((reason?: string) => passkeyCtl.current?.abort(reason), [])

  const avatarBtn = useRef<HTMLButtonElement>(null)
  const [levelSaving, setLevelSaving] = useState(false)

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === displayName) {
      setEditingName(false)
      return
    }
    setNameSaving(true)
    const result = await setDisplayName(trimmed)
    setNameSaving(false)
    // A refusal keeps the editor open on the draft, saying why.
    if (!result.ok) {
      setNameError(result.error)
      return
    }
    setNameError(null)
    onNameSaved(result.name)
    setNameDraft(result.name ?? '')
    if (result.name !== null) {
      onNameChange?.(result.name)
      window.dispatchEvent(
        new window.CustomEvent<NameEventDetail>(NAME_EVENT, { detail: { name: result.name } })
      )
    }
    setEditingName(false)
  }, [nameDraft, displayName, onNameChange, onNameSaved])

  // Open the form AND start loading the site's sign-in client, which begins its
  // fingerprint collection as it evaluates — so it is ready by submit. Where the
  // client cannot load at all (not on hadoku.me), the page-level /auth flow is
  // the only way to sign in, so go there.
  const openKeyForm = useCallback(() => {
    setKeyFormOpen(true)
    setKeyError(null)
    loadSignIn()
      .then(signIn => {
        if (!signIn) window.location.assign(switchKeyHref())
      })
      .catch(reportErr)
  }, [setKeyFormOpen])

  const submitKey = useCallback(async () => {
    setKeyBusy(true)
    setKeyError(null)
    const signIn = await loadSignIn()
    if (!signIn) {
      window.location.assign(switchKeyHref())
      return
    }
    try {
      await signIn(keyDraft)
    } catch (err) {
      // A refused key is an inline error, never a redirect.
      setKeyError((err as Error)?.message || 'Invalid key')
      setKeyBusy(false)
      return
    }
    // The page now acts for a different identity: everything must re-mount.
    // Busy stays on through the reload so the form can't be resubmitted.
    window.location.reload()
  }, [keyDraft])

  const savePasskey = useCallback(async () => {
    const ctl = new AbortController()
    passkeyCtl.current = ctl
    setPasskeyMode('save')
    setPasskeyError(null)
    try {
      const client = await Promise.race([loadSignInClient(), untilAborted(ctl.signal)])
      if (!client?.addPasskey) {
        window.location.assign(passkeyHref('add'))
        return
      }
      await Promise.race([client.addPasskey({ signal: ctl.signal }), untilAborted(ctl.signal)])
      onPasskeySaved()
    } catch (err) {
      if (ctl.signal.reason !== CLOSED) {
        setPasskeyError(
          ctl.signal.aborted ? 'Passkey not saved' : (err as Error)?.message || 'Passkey not saved'
        )
      }
    } finally {
      if (passkeyCtl.current === ctl) passkeyCtl.current = null
      setPasskeyMode(null)
    }
  }, [onPasskeySaved])

  const signInWithPasskey = useCallback(async () => {
    const ctl = new AbortController()
    passkeyCtl.current = ctl
    setPasskeyMode('signin')
    setKeyBusy(true)
    setKeyError(null)
    let leaving = false
    try {
      const client = await Promise.race([loadSignInClient(), untilAborted(ctl.signal)])
      if (!client?.signInWithPasskey) {
        leaving = true
        window.location.assign(passkeyHref('signin'))
        return
      }
      await Promise.race([
        client.signInWithPasskey({ signal: ctl.signal }),
        untilAborted(ctl.signal)
      ])
      // The page now acts for a different identity: everything must re-mount.
      // Busy stays on through the reload so nothing can be resubmitted.
      leaving = true
      window.location.reload()
    } catch (err) {
      if (ctl.signal.reason !== CLOSED) {
        setKeyError(
          ctl.signal.aborted
            ? 'Passkey sign-in cancelled'
            : (err as Error)?.message || 'Passkey sign-in cancelled'
        )
      }
    } finally {
      if (passkeyCtl.current === ctl) passkeyCtl.current = null
      if (!leaving) {
        setPasskeyMode(null)
        setKeyBusy(false)
      }
    }
  }, [])

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
    [content, levelSaving, setContent]
  )

  // Closing the popout (or leaving the page) unmounts this, and abandons an
  // open prompt.
  useEffect(() => () => cancelPasskey(CLOSED), [cancelPasskey])

  return (
    <>
      {activeTab === 'profile' && (
        <>
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
                {tierLabel(userType, verified)}
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
                  aria-invalid={nameError !== null}
                  aria-describedby={nameError ? 'settings-popout-name-error' : undefined}
                  onChange={e => {
                    setNameDraft(e.target.value)
                    setNameError(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      saveName().catch(reportErr)
                    }
                    if (e.key === 'Escape') {
                      // The edit's Escape, not the popout's (window listener).
                      e.stopPropagation()
                      setEditingName(false)
                      setNameError(null)
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
                {nameError && (
                  <span
                    id="settings-popout-name-error"
                    className="settings-popout__error"
                    role="alert"
                  >
                    {nameError}
                  </span>
                )}
              </span>
            ) : (
              <button
                type="button"
                className="settings-popout__value settings-popout__value--editable"
                aria-label="Edit display name"
                onClick={() => {
                  setNameDraft(displayName ?? '')
                  setEditingName(true)
                }}
              >
                {displayName || 'Unnamed'}
              </button>
            )}
          </section>

          {/* Avatar: picture and character, chosen in a dialog (AvatarDialog).
              Nothing loads until Change, so opening the gear costs no request and
              no page load reads the avatar. Hidden for public callers, like the
              content pill: an avatar needs a session. */}
          {!resolving && userType !== 'public' && (
            <section className="settings-popout__row settings-popout__row--stack">
              <span className="settings-popout__inline">
                <span className="settings-popout__label settings-popout__label--grow">Avatar</span>
                <button
                  ref={avatarBtn}
                  type="button"
                  className="settings-popout__btn"
                  aria-haspopup="dialog"
                  aria-expanded={avatarOpen}
                  onPointerEnter={() => loadAvatarDialog().catch(reportErr)}
                  onFocus={() => loadAvatarDialog().catch(reportErr)}
                  onClick={() => setAvatarOpen(true)}
                >
                  Change
                </button>
              </span>
              {/* Mounted only while open: closing unmounts it, which is
                      what returns focus to Change (AvatarDialog's cleanup). */}
              {avatarOpen && (
                <React.Suspense fallback={null}>
                  <AvatarDialog
                    open
                    onClose={() => setAvatarOpen(false)}
                    returnFocus={avatarBtn}
                    name={displayName}
                    isAdmin={userType === 'admin'}
                  />
                </React.Suspense>
              )}
            </section>
          )}
        </>
      )}

      {/* Content visibility level. Held back until the first-open fetch
              settles, so it lands in the same paint as the tier and name
              rather than a round trip behind them. `content` is fetched
              concurrently with whoami(), so by then it is already here. */}
      {activeTab === 'content' && (
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
                Higher levels reveal more mature content across apps. Level 1 is safe-for-everyone.
              </span>
            </>
          ) : (
            // Not "Loading…" — the fetch has already settled by the time
            // this section renders at all, so a null here means it failed.
            <span className="settings-popout__hint">Currently unavailable.</span>
          )}
        </section>
      )}

      {/* Switch key. Signs in inline through the SITE's sign-in client
              (the /auth page's own code path), never a post of ours. A real
              <form> with a username + current-password pair, so password
              managers offer and save the key. */}
      {activeTab === 'account' && (
        <>
          {keyFormOpen ? (
            <section className="settings-popout__row settings-popout__row--stack">
              <form
                className="settings-popout__key-form"
                onSubmit={e => {
                  e.preventDefault()
                  submitKey().catch(reportErr)
                }}
              >
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value="hadoku"
                  readOnly
                  hidden
                />
                <label className="settings-popout__label" htmlFor="settings-popout-key">
                  Access key
                </label>
                <span className="settings-popout__inline">
                  <input
                    id="settings-popout-key"
                    className="settings-popout__input"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={keyDraft}
                    disabled={keyBusy}
                    aria-invalid={keyError !== null}
                    aria-describedby={keyError ? 'settings-popout-key-error' : undefined}
                    onChange={e => setKeyDraft(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="settings-popout__btn settings-popout__btn--primary"
                    disabled={keyBusy}
                  >
                    {keyBusy ? 'Signing in…' : 'Sign in'}
                  </button>
                </span>
                {passkeysSupported() && (
                  <span className="settings-popout__inline">
                    <button
                      type="button"
                      className="settings-popout__btn"
                      disabled={keyBusy}
                      onClick={() => {
                        signInWithPasskey().catch(reportErr)
                      }}
                    >
                      {passkeyMode === 'signin' ? 'Waiting for passkey…' : 'Use a passkey'}
                    </button>
                  </span>
                )}
                {/* Cancel on a line of its own: in the row it would slide under
                    the pointer, and a double click would cancel what it started. */}
                {passkeyMode === 'signin' && (
                  <span className="settings-popout__inline">
                    <button
                      type="button"
                      className="settings-popout__btn"
                      onClick={() => cancelPasskey()}
                    >
                      Cancel
                    </button>
                  </span>
                )}
                {keyError && (
                  <span
                    id="settings-popout-key-error"
                    className="settings-popout__error"
                    role="alert"
                  >
                    {keyError}
                  </span>
                )}
              </form>
            </section>
          ) : (
            <section className="settings-popout__row settings-popout__row--stack">
              <span className="settings-popout__inline">
                <span className="settings-popout__label settings-popout__label--grow">
                  Access key
                </span>
                {/* Signed-in people only: the site refuses to save one for anyone else. */}
                {!resolving && userType !== 'public' && passkeysSupported() && (
                  <button
                    type="button"
                    className={`settings-popout__btn${needsPasskey ? ` settings-popout__btn--primary ${PASSKEY_PULSE_CLASS}` : ''}`}
                    disabled={passkeyMode !== null || passkeySaved}
                    onClick={() => {
                      savePasskey().catch(reportErr)
                    }}
                  >
                    {passkeySaved
                      ? 'Passkey saved'
                      : passkeyMode === 'save'
                        ? 'Saving…'
                        : 'Save passkey'}
                  </button>
                )}
                <button
                  type="button"
                  className="settings-popout__btn"
                  disabled={passkeyMode === 'save'}
                  onClick={openKeyForm}
                >
                  Switch key
                </button>
              </span>
              {/* Its own line, so nothing moves under a double click. */}
              {passkeyMode === 'save' && (
                <span className="settings-popout__inline">
                  <button
                    type="button"
                    className="settings-popout__btn"
                    onClick={() => cancelPasskey()}
                  >
                    Cancel
                  </button>
                </span>
              )}
              {passkeyError && (
                <span className="settings-popout__error" role="alert">
                  {passkeyError}
                </span>
              )}
            </section>
          )}

          {/* The authenticator, and the sign-in link it makes: offered only
              once a passkey is saved, since setting one up takes a passkey tap. */}
          {!resolving && userType !== 'public' && ((passkeyCount ?? 0) > 0 || passkeySaved) && (
            <section
              className="settings-popout__row settings-popout__row--stack"
              aria-label="Authenticator"
            >
              <React.Suspense fallback={<span className="settings-popout__hint">…</span>}>
                <Authenticator />
              </React.Suspense>
            </section>
          )}

          {/* Discord and Steam: linked here, so their pictures can be chosen in
              the avatar dialog. Mounted with the Account tab: the read can refresh
              a linked picture, which opening the gear on another tab must not cost. */}
          {!resolving && userType !== 'public' && (
            <section className="settings-popout__row settings-popout__row--stack">
              <span className="settings-popout__label">Linked accounts</span>
              <React.Suspense fallback={<span className="settings-popout__hint">…</span>}>
                <LinkedAccounts />
              </React.Suspense>
            </section>
          )}

          {/* Service access: only for someone the operator granted a
              service identity. No heading of its own: its lines (the code, a
              Mint per identity) say what it is. */}
          {!resolving && serviceGrants > 0 && (
            <section
              className="settings-popout__row settings-popout__row--stack"
              aria-label="Service access"
            >
              <React.Suspense fallback={<span className="settings-popout__hint">…</span>}>
                <ServiceAccess />
              </React.Suspense>
            </section>
          )}

          {/* A self-made account (member) can delete itself. The confirm is a
              separate button on its own line, so a double click on Delete
              never confirms. */}
          {!resolving && userType === 'member' && (
            <section className="settings-popout__row settings-popout__row--stack">
              <span className="settings-popout__inline">
                <span className="settings-popout__label settings-popout__label--grow">Account</span>
                {deleteStage === 'idle' ? (
                  <button
                    type="button"
                    className="settings-popout__btn"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteStage('confirm')
                    }}
                  >
                    Delete account
                  </button>
                ) : (
                  <button
                    type="button"
                    className="settings-popout__btn"
                    disabled={deleteStage === 'busy'}
                    onClick={() => setDeleteStage('idle')}
                  >
                    Keep
                  </button>
                )}
              </span>
              {deleteStage !== 'idle' && (
                <span className="settings-popout__inline">
                  <button
                    type="button"
                    className="settings-popout__btn settings-popout__btn--primary"
                    disabled={deleteStage === 'busy'}
                    onClick={() => {
                      setDeleteStage('busy')
                      deleteOwnAccount()
                        .then(deleted => {
                          if (!deleted) {
                            setDeleteError('Account not deleted')
                            setDeleteStage('confirm')
                            return
                          }
                          localStorage.removeItem('hadoku_session_id')
                          localStorage.removeItem('hadoku_user_type')
                          window.location.assign('/')
                        })
                        .catch(reportErr)
                    }}
                  >
                    {deleteStage === 'busy' ? 'Deleting…' : 'Delete for good'}
                  </button>
                </span>
              )}
              {deleteError && (
                <span className="settings-popout__error" role="alert">
                  {deleteError}
                </span>
              )}
            </section>
          )}
        </>
      )}
    </>
  )
}
