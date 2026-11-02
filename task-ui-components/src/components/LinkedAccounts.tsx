/**
 * LinkedAccounts — Discord and Steam, linked and unlinked from the settings
 * popout's Account tab (operator, 2026-11-02: linking is an account matter, not
 * part of changing the avatar). A linked account's picture then shows up as a
 * choice in the avatar dialog's Picture tab.
 *
 * Loaded only when the person opens the row, never at mount: the read can
 * refresh a linked picture from Discord or Steam, which opening the gear must
 * not cost (settings-prefetch e2e).
 *
 * Linking signs in through a popup (`linkInPopup`), so the page under the
 * popout never navigates and a game keeps running.
 *
 * COMPLIANCE (Steam Web API terms; Discord developer terms), carried over from
 * hadoku.me/account: nothing is fetched from a provider until the person reads
 * what is read and kept and presses Continue; no provider logos, and no implied
 * endorsement.
 */
import React, { useEffect, useState } from 'react'
import type { AvatarSettings, LinkProvider } from '@wolffm/prefs-client/avatar'
import { AVATAR_EVENT } from '../lib/avatarEvent'
import { avatarClient, avatarErrorText } from '../lib/avatarData'

const LABEL: Record<LinkProvider, string> = { discord: 'Discord', steam: 'Steam' }

const CONSENT: Record<LinkProvider, { points: string[]; go: string }> = {
  discord: {
    points: [
      'Discord asks you to share your basic profile ("identify").',
      'Kept: your Discord user ID and the address of your profile picture, refreshed while linked.',
      'Not kept: your username, email, servers or any token.',
      'Unlink deletes both.'
    ],
    go: 'Continue to Discord'
  },
  steam: {
    points: [
      'You sign in on steamcommunity.com; your password never reaches hadoku.me.',
      'Your public Steam profile picture is then read through the Steam Web API, now and periodically while linked.',
      'Kept: your Steam ID and the address of that picture.',
      'Unlink deletes both and stops the reads.'
    ],
    go: 'Continue to Steam'
  }
}

const S = {
  stack: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' },
  line: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  list: { margin: 0, paddingLeft: 18, fontSize: '0.75rem', lineHeight: 1.45 }
} satisfies Record<string, React.CSSProperties>

export function LinkedAccounts() {
  const [settings, setSettings] = useState<AvatarSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<LinkProvider | null>(null)

  useEffect(() => {
    let live = true
    avatarClient
      .get()
      .then(s => live && setSettings(s))
      .catch((err: unknown) => live && setError(avatarErrorText(err)))
    return () => {
      live = false
    }
  }, [])

  const run = async (work: () => Promise<AvatarSettings>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await work()
      setSettings(next)
      // The page under the popout (a watchparty room, a game) re-reads the
      // avatar from this, as it does after a change in the avatar dialog.
      window.dispatchEvent(new window.CustomEvent<AvatarSettings>(AVATAR_EVENT, { detail: next }))
    } catch (err) {
      setError(avatarErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return (
      <span className="settings-popout__hint" role={error ? 'alert' : undefined}>
        {error ?? '…'}
      </span>
    )
  }

  // Must stay synchronous up to linkInPopup: the popup opens before its first
  // await, inside this click, which is what popup blockers allow.
  const link = (provider: LinkProvider) => {
    setConsent(null)
    void run(async () => {
      const next = await avatarClient.linkInPopup(provider)
      // Linking is choosing, when the account came back with a picture.
      return next.linked[provider]?.avatarUrl ? avatarClient.choose(provider) : next
    })
  }

  return (
    <div style={S.stack}>
      {(['discord', 'steam'] as const).map(p => {
        const linked = settings.linked[p]
        return (
          <div key={p} style={S.line}>
            <span className="settings-popout__label" style={S.grow}>
              {LABEL[p]}
              {!settings.providers[p]
                ? ' · not available yet'
                : linked
                  ? linked.avatarUrl
                    ? ' · linked'
                    : ' · linked, no picture'
                  : ''}
            </span>
            {settings.providers[p] && !linked && (
              <button
                type="button"
                className="settings-popout__btn"
                disabled={busy}
                onClick={() => setConsent(consent === p ? null : p)}
              >
                Link
              </button>
            )}
            {linked && (
              <button
                type="button"
                className="settings-popout__btn"
                disabled={busy}
                onClick={() => void run(() => avatarClient.unlink(p))}
              >
                Unlink
              </button>
            )}
          </div>
        )
      })}

      {consent && (
        <div style={S.stack}>
          <ul style={S.list}>
            {CONSENT[consent].points.map(t => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <span style={S.line}>
            <button
              type="button"
              className="settings-popout__btn settings-popout__btn--primary"
              disabled={busy}
              onClick={() => link(consent)}
            >
              {CONSENT[consent].go}
            </button>
            <button type="button" className="settings-popout__btn" onClick={() => setConsent(null)}>
              Cancel
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
