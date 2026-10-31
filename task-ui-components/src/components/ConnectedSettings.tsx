/**
 * ConnectedSettings — the unified per-user settings control for the hadoku
 * ecosystem: a gear button that opens a popout housing everything that is a
 * property of the PERSON (not the app):
 *   - current access tier (read-only, friendly label)
 *   - display name (inline edit → POST /session/name)
 *   - avatar: picture and character, chosen in place (AvatarPicker)
 *   - global content-visibility level (tiered pill → PUT /prefs/api/v1/content-level)
 *   - switch key (an inline sign-in form, on the site's own sign-in client)
 *
 * Those are grouped into tabs (Profile, Content, Account), followed by the
 * app's own: `children` as one "App" tab, `appTabs` as one tab each. The open
 * tab is remembered per user and per app (useSettingsTab, @wolffm/themes).
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
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useSettingsTab } from '@wolffm/themes'
import { SettingsIcon } from './ThemeIcons'
import { AvatarPicker } from './AvatarPicker'
import {
  deleteOwnAccount,
  prefetchSettings,
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
  /** App-specific settings as ONE tab, labelled "App", after the site's own
   *  tabs — so an app with its own preferences keeps one unified gear instead
   *  of a second control. For more than one section, use `appTabs`.
   *
   *  This slot is deliberately unconstrained — put whatever the app needs in
   *  it. The constraint is only that it cannot change the site's tabs. */
  children?: React.ReactNode
  /** App-specific settings as tabs of their own, after `children`'s "App" tab
   *  if both are given. `id` is stable and unique within the app: the last-open
   *  tab is remembered by it. `render` runs only while its tab is open. */
  appTabs?: AppSettingsTab[]
}

/** One app-contributed tab in the settings popout. */
export interface AppSettingsTab {
  id: string
  label: string
  render: () => React.ReactNode
}

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

/** Rejection sink for fire-and-forget settings actions. The client helpers
 *  already resolve to null on failure (state reflects it), so this only trips
 *  on truly unexpected throws — log rather than swallow silently. */
function reportErr(err: unknown) {
  // task-ui-components v2 dropped its logger; keep the package dependency-free.
  console.error('[ConnectedSettings] action failed', (err as Error)?.message ?? err)
}

/** Inline, not in app-header.css: every app runs this component from the
 *  site's shared vendor module, but compiles app-header.css into its own
 *  stylesheet at ITS build, so a new rule reaches an app only when it rebuilds. */
const PASSKEY_DOT: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--color-primary)',
  pointerEvents: 'none'
}

/** Save passkey pulses while the dot is asking for it. Keyframes cannot be
 *  inline, so the rule is injected once into the document instead, for the
 *  same reason PASSKEY_DOT is inline. */
const PASSKEY_PULSE_CLASS = 'settings-popout__btn--pulse'
const PASSKEY_PULSE_CSS = `
@keyframes settings-passkey-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 70%, transparent); }
  70% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--color-primary) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent); }
}
@media (prefers-reduced-motion: no-preference) {
  .${PASSKEY_PULSE_CLASS}:not(:disabled) {
    animation: settings-passkey-pulse 1.6s ease-out infinite;
  }
}
`

/** The tab strip and its panels. Injected for the same reason as the pulse:
 *  an app's copy of app-header.css predates the tabs until it rebuilds. The
 *  strip stays pinned while a long tab scrolls, and scrolls sideways itself
 *  when the tabs outgrow a phone-width panel. */
const TABS_CSS = `
.settings-popout__top {
  position: sticky;
  top: -16px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: -16px -16px 0;
  padding: 16px 16px 0;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
}
.settings-popout__tabs {
  display: flex;
  gap: 2px;
  margin: 0 -16px -1px;
  padding: 0 16px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.settings-popout__tab {
  position: relative;
  flex: none;
  padding: 6px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.settings-popout__tab:hover {
  color: var(--color-text);
}
.settings-popout__tab[aria-selected='true'] {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
}
.settings-popout__tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
  border-radius: 6px 6px 0 0;
}
.settings-popout__tabpanel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
`

function useInjectedStyle(id: string, css: string, active: boolean) {
  useEffect(() => {
    if (!active || document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = css
    document.head.appendChild(el)
  }, [id, css, active])
}

const TIER_LABEL: Record<Tier, string> = {
  admin: 'Administrator',
  wife: 'Wife',
  service: 'Service',
  friend: 'Friend',
  member: 'Member',
  public: 'Guest'
}

export function ConnectedSettings({
  userType: userTypeProp,
  name: nameProp,
  onNameChange,
  children,
  appTabs
}: ConnectedSettingsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const tabIdBase = useId()
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [savedTab, saveTab] = useSettingsTab()
  // This visit's pick; wins over the saved one while it is still offered.
  const [pickedTab, setPickedTab] = useState<string | null>(null)

  // Identity — from props if supplied, else resolved lazily via whoami().
  const [userType, setUserType] = useState<Tier>(userTypeProp ?? 'public')
  const [resolvedName, setResolvedName] = useState<string | null>(nameProp ?? null)

  // Name editing
  const [nameDraft, setNameDraft] = useState(resolvedName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [displayName, setLocalName] = useState<string | null>(resolvedName)

  // Key swap. The draft lives only in this state and the input: it is never
  // logged, stored or sent anywhere but the site's sign-in client.
  const [keyFormOpen, setKeyFormOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  // Passkeys, through the same site client: save one while signed in, or
  // sign in with one from the key form. One prompt at a time, and always
  // cancellable: a password manager can dismiss the browser's prompt without
  // ever answering it, so Cancel, closing the popout and the site client's own
  // time limit each end the wait.
  const [passkeyMode, setPasskeyMode] = useState<'save' | 'signin' | null>(null)
  const [passkeySaved, setPasskeySaved] = useState(false)
  // How many passkeys sign this person in, from whoami; null = unknown.
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  // Delete account: one click arms it, a second, separate button confirms.
  const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const passkeyCtl = useRef<AbortController | null>(null)
  const cancelPasskey = useCallback((reason?: string) => passkeyCtl.current?.abort(reason), [])

  // Avatar: the picker loads only when opened, never at mount (AvatarPicker).
  const [avatarOpen, setAvatarOpen] = useState(false)

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

  // Signed in on a key with no passkey: the gear carries a dot and Save passkey
  // is the primary action until one is saved. Unknown counts never prompt.
  const needsPasskey =
    !resolving &&
    userType !== 'public' &&
    passkeyCount === 0 &&
    !passkeySaved &&
    passkeysSupported()
  useInjectedStyle('settings-passkey-pulse', PASSKEY_PULSE_CSS, needsPasskey)
  useInjectedStyle('settings-tabs', TABS_CSS, open)

  // The site's own groups first, then the app's. App ids are namespaced so an
  // app tab called "account" can never collide with the site's.
  const tabs: { id: string; label: string; dot?: boolean }[] = [
    { id: 'profile', label: 'Profile' },
    ...(!resolving && showContentPill ? [{ id: 'content', label: 'Content' }] : []),
    // The gear's dot asks for a passkey; this one says where Save passkey is.
    { id: 'account', label: 'Account', dot: needsPasskey },
    ...(children ? [{ id: 'app:', label: 'App' }] : []),
    ...(appTabs ?? []).map(t => ({ id: `app:${t.id}`, label: t.label }))
  ]
  const tabIds = tabs.map(t => t.id)
  // Nothing remembered: open on the app's first tab, which is usually why the
  // gear was clicked inside an app.
  const defaultTab = tabIds.find(id => id.startsWith('app:')) ?? 'profile'
  const activeTab =
    [pickedTab, savedTab].find((id): id is string => id !== null && tabIds.includes(id)) ??
    defaultTab
  const appTab = appTabs?.find(t => `app:${t.id}` === activeTab)
  const tabDomId = (id: string) => `${tabIdBase}tab-${id}`
  const panelDomId = `${tabIdBase}panel`

  const selectTab = useCallback(
    (id: string) => {
      setPickedTab(id)
      saveTab(id)
    },
    [saveTab]
  )

  // Arrow keys, Home and End move between tabs and open the one they land on
  // (the ARIA tablist pattern with automatic activation).
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabIds.indexOf(activeTab)
    const n = tabIds.length
    const next =
      e.key === 'ArrowRight'
        ? tabIds[(i + 1) % n]
        : e.key === 'ArrowLeft'
          ? tabIds[(i - 1 + n) % n]
          : e.key === 'Home'
            ? tabIds[0]
            : e.key === 'End'
              ? tabIds[n - 1]
              : undefined
    if (next === undefined) return
    e.preventDefault()
    selectTab(next)
    tabRefs.current.get(next)?.focus()
  }

  // A remembered tab past the edge of a narrow strip is scrolled into sight.
  // jsdom implements no scrollIntoView, and every consumer's unit test that
  // renders the popout runs there, so the call is optional.
  useEffect(() => {
    if (open)
      tabRefs.current.get(activeTab)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [open, activeTab])

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
      .then(({ identity, content: state, passkeys }) => {
        if (!live) return
        setPasskeyCount(passkeys)
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
    const result = await setDisplayName(trimmed)
    setNameSaving(false)
    // A refusal keeps the editor open on the draft, saying why.
    if (!result.ok) {
      setNameError(result.error)
      return
    }
    setNameError(null)
    setLocalName(result.name)
    setNameDraft(result.name ?? '')
    if (result.name !== null) onNameChange?.(result.name)
    setEditingName(false)
  }, [nameDraft, displayName, onNameChange])

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
  }, [])

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
      setPasskeySaved(true)
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
  }, [])

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

  // Closing the popout (or leaving the page) abandons an open prompt.
  useEffect(() => {
    if (!open) cancelPasskey(CLOSED)
  }, [open, cancelPasskey])
  useEffect(() => () => cancelPasskey(CLOSED), [cancelPasskey])

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

  // No caller-supplied class on the root. The four rows below are the
  // platform's, not the app's, and a className here is enough to restyle or
  // hide any of them — which is the drift this component exists to prevent.
  // Apps extend via `children` and `appTabs`, never by reaching into this markup.
  return (
    <div className="settings-popout" ref={rootRef}>
      <button
        type="button"
        className="app-header__icon-btn settings-toggle-btn"
        aria-label={needsPasskey ? 'User settings, no passkey saved' : 'User settings'}
        style={needsPasskey ? { position: 'relative' } : undefined}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <SettingsIcon />
        {needsPasskey && (
          <span className="settings-toggle-btn__dot" style={PASSKEY_DOT} aria-hidden="true" />
        )}
      </button>

      {open && <div className="settings-popout__overlay" onClick={() => setOpen(false)} />}

      {open && (
        <div className="settings-popout__panel" role="dialog" aria-label="User settings">
          <div className="settings-popout__top">
            <div className="settings-popout__header">Settings</div>
            <div
              className="settings-popout__tabs"
              role="tablist"
              aria-label="Settings sections"
              onKeyDown={onTabKey}
            >
              {tabs.map(t => (
                <button
                  key={t.id}
                  ref={el => {
                    if (el) tabRefs.current.set(t.id, el)
                    else tabRefs.current.delete(t.id)
                  }}
                  type="button"
                  role="tab"
                  id={tabDomId(t.id)}
                  className="settings-popout__tab"
                  aria-selected={t.id === activeTab}
                  aria-controls={panelDomId}
                  tabIndex={t.id === activeTab ? 0 : -1}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                  {t.dot && <span style={PASSKEY_DOT} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>

          <div
            className="settings-popout__tabpanel"
            role="tabpanel"
            id={panelDomId}
            aria-labelledby={tabDomId(activeTab)}
          >
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

                {/* Avatar: picture and character, chosen in place (AvatarPicker).
              Collapsed until Change, so opening the gear costs no request and no
              page load reads the avatar. Hidden for public callers, like the
              content pill: an avatar needs a session. */}
                {!resolving && userType !== 'public' && (
                  <section className="settings-popout__row settings-popout__row--stack">
                    <span className="settings-popout__inline">
                      <span className="settings-popout__label settings-popout__label--grow">
                        Avatar
                      </span>
                      <button
                        type="button"
                        className="settings-popout__btn"
                        aria-expanded={avatarOpen}
                        onClick={() => setAvatarOpen(v => !v)}
                      >
                        {avatarOpen ? 'Done' : 'Change'}
                      </button>
                    </span>
                    {avatarOpen && <AvatarPicker />}
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

                {/* A self-made account (member) can delete itself. The confirm is a
              separate button on its own line, so a double click on Delete
              never confirms. */}
                {!resolving && userType === 'member' && (
                  <section className="settings-popout__row settings-popout__row--stack">
                    <span className="settings-popout__inline">
                      <span className="settings-popout__label settings-popout__label--grow">
                        Account
                      </span>
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

            {/* App-specific settings (optional) — same popout, one gear. */}
            {activeTab === 'app:' && (
              <section className="settings-popout__row settings-popout__row--stack">
                {children}
              </section>
            )}
            {appTab && (
              <section className="settings-popout__row settings-popout__row--stack">
                {appTab.render()}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
