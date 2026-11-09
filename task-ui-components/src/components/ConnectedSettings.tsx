/**
 * ConnectedSettings — the unified per-user settings control for the hadoku
 * ecosystem: a gear button that opens a popout housing everything that is a
 * property of the PERSON (not the app):
 *   - current access tier (read-only, friendly label)
 *   - display name (inline edit → POST /session/name)
 *   - avatar: picture and character, chosen in a dialog (AvatarDialog)
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
import {
  prefetchSettings,
  passkeysSupported,
  type ContentLevelState,
  type Tier
} from '../lib/settingsClient'
import { PASSKEY_PULSE_CLASS, reportErr } from './settingsShared'
import { relayIdentityChanges } from '../lib/identityRelay'

// The Profile, Content and Account tab bodies are most of this component, and
// opened now and then, but this module is on every page of every app through
// the site's shared vendor bundle (#111). So they are a chunk of their own,
// fetched when the popout opens and preloaded on the gear's hover or focus.
const loadSiteTabs = () => import('./SettingsSiteTabs')
const SettingsSiteTabs = React.lazy(() =>
  loadSiteTabs().then(m => ({ default: m.SettingsSiteTabs }))
)
const SITE_TABS = new Set(['profile', 'content', 'account'])
function preloadSiteTabs() {
  loadSiteTabs().catch(reportErr)
}
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

/** The panel's width, inline for the same reason as PASSKEY_DOT. 300px wrapped
 *  rows onto extra lines and left an app's own sections scrolling; app-header.css
 *  still caps it at the viewport (`max-width: calc(100vw - 32px)`). */
const PANEL_WIDTH: React.CSSProperties = { width: 400 }

/** Save passkey pulses while the dot is asking for it. Keyframes cannot be
 *  inline, so the rule is injected once into the document instead, for the
 *  same reason PASSKEY_DOT is inline. */
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
 *  when the tabs outgrow a phone-width panel. It shows no scrollbar there: the
 *  edge that hides a tab fades instead (data-fade-start / data-fade-end, set
 *  by useStripFades), and the open tab is scrolled into sight — with the
 *  strip's own padding, so the last tab lands clear of the fade. The tab padding
 *  is sized so six tabs fit the 400px panel without scrolling at all. */
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
  scroll-padding-inline: 16px;
  scrollbar-width: none;
}
.settings-popout__tabs::-webkit-scrollbar {
  display: none;
}
.settings-popout__tabs[data-fade-start] {
  mask-image: linear-gradient(to right, transparent, black 28px);
}
.settings-popout__tabs[data-fade-end] {
  mask-image: linear-gradient(to left, transparent, black 28px);
}
.settings-popout__tabs[data-fade-start][data-fade-end] {
  mask-image: linear-gradient(
    to right,
    transparent,
    black 28px,
    black calc(100% - 28px),
    transparent
  );
}
.settings-popout__tab {
  position: relative;
  flex: none;
  padding: 6px;
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

/** Marks which edges of the tab strip hide a tab, for TABS_CSS's fades. Set
 *  on the element directly, not through state: it changes on every scroll
 *  frame and nothing React renders depends on it. jsdom has no ResizeObserver,
 *  so the resize half is optional, like scrollIntoView below. */
function useStripFades(
  strip: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  tabCount: number
) {
  useEffect(() => {
    const el = strip.current
    if (!active || !el) return
    const update = () => {
      const hidden = el.scrollWidth - el.clientWidth
      el.toggleAttribute('data-fade-start', el.scrollLeft > 1)
      el.toggleAttribute('data-fade-end', el.scrollLeft < hidden - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    resize?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      resize?.disconnect()
    }
  }, [strip, active, tabCount])
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
  const stripRef = useRef<HTMLDivElement>(null)
  const [savedTab, saveTab] = useSettingsTab()
  // This visit's pick; wins over the saved one while it is still offered.
  const [pickedTab, setPickedTab] = useState<string | null>(null)

  // Identity — from props if supplied, else resolved lazily via whoami().
  const [userType, setUserType] = useState<Tier>(userTypeProp ?? 'public')
  // The name: from props or whoami, then any rename saved in the popout.
  const [displayName, setLocalName] = useState<string | null>(nameProp ?? null)

  // How many passkeys sign this person in, from whoami; null = unknown. A save
  // in the popout sets passkeySaved, which retires the gear's dot.
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null)
  const [passkeySaved, setPasskeySaved] = useState(false)

  // The Switch key form stays open across a close of the popout.
  const [keyFormOpen, setKeyFormOpen] = useState(false)

  // Avatar: the dialog loads only when opened, never at mount (AvatarPicker).
  const [avatarOpen, setAvatarOpen] = useState(false)
  // Service identities this person may mint for (whoami.serviceGrants).
  const [serviceGrants, setServiceGrants] = useState(0)
  // The operator verified this person (whoami.verified); a member shows it.
  const [verified, setVerified] = useState(false)

  // Content level
  const [content, setContent] = useState<ContentLevelState | null>(null)

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

  useStripFades(stripRef, open, tabs.length)

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
      setLocalName(nameProp)
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
      .then(({ identity, content: state, passkeys, serviceGrants: grants, verified: v }) => {
        if (!live) return
        setPasskeyCount(passkeys)
        setServiceGrants(grants)
        setVerified(v)
        // Props stay authoritative: the host passed them because it can see an
        // identity this component can't resolve for itself.
        if (userTypeProp === undefined) {
          setUserType(identity.userType)
          setLocalName(identity.name)
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

  // Every rename and avatar change made here reaches the browser's other
  // hadoku tabs, and theirs reach this page's listeners — a room open in
  // another tab updates even though this page has none (lib/identityRelay).
  useEffect(() => relayIdentityChanges(), [])

  // Escape closes — unless the avatar dialog is open: that Escape is the dialog's.
  useEffect(() => {
    if (!open || avatarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, avatarOpen])

  const onPasskeySaved = useCallback(() => setPasskeySaved(true), [])

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
        onPointerEnter={preloadSiteTabs}
        onFocus={preloadSiteTabs}
        onClick={() => setOpen(v => !v)}
      >
        <SettingsIcon />
        {needsPasskey && (
          <span className="settings-toggle-btn__dot" style={PASSKEY_DOT} aria-hidden="true" />
        )}
      </button>

      {open && <div className="settings-popout__overlay" onClick={() => setOpen(false)} />}

      {open && (
        <div
          className="settings-popout__panel"
          style={PANEL_WIDTH}
          role="dialog"
          aria-label="User settings"
        >
          <div className="settings-popout__top">
            <div className="settings-popout__header">Settings</div>
            <div
              ref={stripRef}
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
            {/* The site's own tabs: their own chunk (#111), mounted while the
              popout is open whichever tab shows, so a draft survives a visit
              to an app tab. Only a site tab waits on it; an app tab's content
              below renders at once. */}
            <React.Suspense
              fallback={
                SITE_TABS.has(activeTab) ? <span className="settings-popout__hint">…</span> : null
              }
            >
              <SettingsSiteTabs
                activeTab={activeTab}
                resolving={resolving}
                userType={userType}
                verified={verified}
                displayName={displayName}
                onNameSaved={setLocalName}
                onNameChange={onNameChange}
                content={content}
                setContent={setContent}
                needsPasskey={needsPasskey}
                passkeyCount={passkeyCount}
                passkeySaved={passkeySaved}
                onPasskeySaved={onPasskeySaved}
                serviceGrants={serviceGrants}
                keyFormOpen={keyFormOpen}
                setKeyFormOpen={setKeyFormOpen}
                avatarOpen={avatarOpen}
                setAvatarOpen={setAvatarOpen}
              />
            </React.Suspense>

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
