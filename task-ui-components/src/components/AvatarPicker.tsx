/**
 * AvatarPicker — the Picture tab of AvatarBuilder (inside AvatarDialog, opened
 * from ConnectedSettings): the picture people see (character, Discord, Steam or
 * an upload) and the character games use as the piece. One resolved avatar per
 * person, stored in hadoku_site's prefs-api and rendered by every app
 * (`@wolffm/prefs-client/avatar`, bundled into this package at build so the link
 * protocol cannot drift from the callback page).
 *
 * Everything happens in place: picking, uploading and removing are requests
 * from here, and linking Discord or Steam signs in through a popup
 * (`linkInPopup`), so the page under the popout never navigates and a game
 * keeps running.
 *
 * AvatarBuilder owns the settings and the character table and loads them only
 * when the dialog opens; this component draws them and sends changes through
 * `run`, which applies the answer everywhere in the dialog.
 *
 * COMPLIANCE (Steam Web API terms; Discord developer terms), carried over from
 * hadoku.me/account: nothing is fetched from a provider until the person reads
 * what is read and kept and presses Continue; Steam attribution and a privacy
 * link sit under the controls; no provider logos, and no implied endorsement.
 *
 * Styles are inline for the reason PASSKEY_DOT's are (ConnectedSettings.tsx):
 * apps compile app-header.css at their own build, so a new rule there reaches
 * an app only when it rebuilds.
 */
import React, { useEffect, useState } from 'react'
import {
  type AvatarSettings,
  type AvatarSource,
  type LinkProvider
} from '@wolffm/prefs-client/avatar'
import { avatarClient, portraitUrl, type CharacterSet } from '../lib/avatarData'

const LABEL: Record<AvatarSource, string> = {
  sprite: 'Character',
  discord: 'Discord',
  steam: 'Steam',
  upload: 'Upload'
}

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
  stack: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%' },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  sources: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 },
  source: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.72rem',
    cursor: 'pointer'
  },
  sourceOn: {
    borderColor: 'var(--color-primary)',
    boxShadow: 'inset 0 0 0 1px var(--color-primary)'
  },
  thumb: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    overflow: 'hidden',
    background: 'var(--color-bg-alt)'
  },
  sets: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 },
  cell: {
    padding: 0,
    aspectRatio: '1',
    borderRadius: 6,
    overflow: 'hidden',
    border: '2px solid transparent',
    background: 'var(--color-bg-alt)',
    cursor: 'pointer'
  },
  line: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  list: { margin: 0, paddingLeft: 18, fontSize: '0.75rem', lineHeight: 1.45 }
} satisfies Record<string, React.CSSProperties>

function Picture({ src, style }: { src: string | null; style: React.CSSProperties }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <span style={style}>
      {src && !failed && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          style={S.img}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}

export interface AvatarPickerProps {
  settings: AvatarSettings
  sets: CharacterSet[] | null
  busy: boolean
  /** Send a change; the builder applies the answer and reports failures. */
  run: (work: () => Promise<AvatarSettings>) => Promise<void>
}

export function AvatarPicker({ settings, sets, busy, run }: AvatarPickerProps) {
  const [setIdx, setSetIdx] = useState(0)
  const [consent, setConsent] = useState<LinkProvider | null>(null)
  // Open on the set holding the person's character.
  useEffect(() => {
    const at = sets?.findIndex(s => s.characters.some(c => c.id === settings.sprite)) ?? -1
    if (at > 0) setSetIdx(at)
    // Only when the table arrives: afterwards the person moves between sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets])

  const characters = new Map((sets ?? []).flatMap(s => s.characters).map(c => [c.id, c]))
  const spriteSrc = (id: string | null | undefined) => {
    const c = id ? characters.get(id) : undefined
    return c ? portraitUrl(c) : null
  }

  const available: Record<AvatarSource, boolean> = {
    sprite: true,
    discord: Boolean(settings.linked.discord?.avatarUrl),
    steam: Boolean(settings.linked.steam?.avatarUrl),
    upload: settings.upload !== null
  }
  const thumbOf: Record<AvatarSource, string | null> = {
    sprite: spriteSrc(settings.sprite),
    discord: settings.linked.discord?.avatarUrl ?? null,
    steam: settings.linked.steam?.avatarUrl ?? null,
    upload: settings.upload?.url ?? null
  }
  const shown = settings.avatar
  const current = sets?.[setIdx]

  // Must stay synchronous up to linkInPopup: the popup opens before its first
  // await, inside this click, which is what popup blockers allow.
  const link = (provider: LinkProvider) => {
    setConsent(null)
    run(async () => {
      const next = await avatarClient.linkInPopup(provider)
      // Linking is choosing, when the account came back with a picture.
      return next.linked[provider]?.avatarUrl ? avatarClient.choose(provider) : next
    }).catch(reportErr)
  }

  return (
    <div style={S.stack}>
      {settings.choice && settings.choice !== shown.source && (
        <span className="settings-popout__hint">
          {LABEL[settings.choice]} is unavailable, so your character shows instead.
        </span>
      )}

      <div style={S.sources} role="radiogroup" aria-label="Picture">
        {(Object.keys(LABEL) as AvatarSource[]).map(src => (
          <button
            key={src}
            type="button"
            role="radio"
            aria-checked={shown.source === src}
            disabled={busy || !available[src]}
            title={available[src] ? undefined : 'Link or upload one first'}
            style={{
              ...S.source,
              ...(shown.source === src ? S.sourceOn : {}),
              opacity: available[src] ? 1 : 0.5
            }}
            onClick={() => {
              run(() => avatarClient.choose(src)).catch(reportErr)
            }}
          >
            <Picture src={thumbOf[src]} style={S.thumb} />
            {LABEL[src]}
          </button>
        ))}
      </div>

      {shown.source === 'sprite' &&
        (sets ? (
          <>
            {sets.length > 1 && (
              <div style={S.sets}>
                {sets.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`settings-popout__btn${i === setIdx ? ' settings-popout__btn--primary' : ''}`}
                    onClick={() => setSetIdx(i)}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
            )}
            <div style={S.grid} role="radiogroup" aria-label="Character">
              {current?.characters.map(c => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.sprite === c.id}
                  aria-label={c.name}
                  title={c.name}
                  disabled={busy}
                  style={{
                    ...S.cell,
                    borderColor: settings.sprite === c.id ? c.color : 'transparent'
                  }}
                  onClick={() => {
                    run(() => avatarClient.update({ sprite: c.id })).catch(reportErr)
                  }}
                >
                  <img src={portraitUrl(c)} alt="" style={S.img} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="settings-popout__hint">…</span>
        ))}

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
                onClick={() => {
                  run(() => avatarClient.unlink(p)).catch(reportErr)
                }}
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

      <div style={S.line}>
        <span className="settings-popout__label" style={S.grow}>
          Upload
        </span>
        <label className="settings-popout__btn" style={{ opacity: busy ? 0.5 : 1 }}>
          {settings.upload ? 'Replace' : 'Choose image'}
          <input
            type="file"
            accept={settings.limits.acceptedTypes.join(',')}
            hidden
            disabled={busy}
            onChange={e => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) run(() => avatarClient.upload(file)).catch(reportErr)
            }}
          />
        </label>
        {settings.upload && (
          <button
            type="button"
            className="settings-popout__btn"
            disabled={busy}
            onClick={() => {
              run(() => avatarClient.removeUpload()).catch(reportErr)
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function reportErr(err: unknown) {
  console.error('[AvatarPicker] action failed', (err as Error)?.message ?? err)
}
