/**
 * AvatarPicker — the Picture tab of AvatarBuilder (inside AvatarDialog, opened
 * from ConnectedSettings): the picture people see (character, Discord, Steam or
 * an upload) and the character games use as the piece. One resolved avatar per
 * person, stored in hadoku_site's prefs-api and rendered by every app
 * (`@wolffm/prefs-client/avatar`, bundled into this package at build so the link
 * protocol cannot drift from the callback page).
 *
 * Everything happens in place: picking, uploading and removing are requests
 * from here. Discord and Steam are managed in the popout's Account tab
 * (LinkedAccounts); one not linked yet can also be linked from its tile here,
 * with the same consent step, and its picture is then worn.
 *
 * AvatarBuilder owns the settings and the character table and loads them only
 * when the dialog opens; this component draws them and sends changes through
 * `run`, which applies the answer everywhere in the dialog.
 *
 * Styles are inline for the reason PASSKEY_DOT's are (ConnectedSettings.tsx):
 * apps compile app-header.css at their own build, so a new rule there reaches
 * an app only when it rebuilds.
 */
import React, { useEffect, useState } from 'react'
import { type AvatarSettings, type AvatarSource } from '@wolffm/prefs-client/avatar'
import { avatarClient, portraitUrl, type CharacterSet } from '../lib/avatarData'
import { LinkConsent, linkAndWear } from './LinkedAccounts'

const LABEL: Record<AvatarSource, string> = {
  sprite: 'Character',
  discord: 'Discord',
  steam: 'Steam',
  upload: 'Upload'
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
    // Longhands, not the `border` shorthand: the selected styles override
    // borderColor, and when one comes off React clears borderColor to '', which
    // would reset it to currentColor and leave a text-coloured ring behind.
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
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
  grow: { flex: 1, minWidth: 0 }
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
  // The tab on show. Picking an available source also wears it; one that is
  // not yet opens to get it: Upload to choose a file, Discord or Steam to link.
  const [view, setView] = useState<AvatarSource>(shown.source)
  useEffect(() => setView(shown.source), [shown.source])

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
            aria-checked={view === src}
            disabled={busy}
            style={{ ...S.source, ...(view === src ? S.sourceOn : {}) }}
            onClick={() => {
              setView(src)
              if (available[src] && shown.source !== src) {
                run(() => avatarClient.choose(src)).catch(reportErr)
              }
            }}
          >
            <Picture src={thumbOf[src]} style={S.thumb} />
            {LABEL[src]}
          </button>
        ))}
      </div>

      {view === 'sprite' &&
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

      {(view === 'discord' || view === 'steam') &&
        !available[view] &&
        (!settings.providers[view] ? (
          <span className="settings-popout__hint">{LABEL[view]} is not available yet.</span>
        ) : settings.linked[view] ? (
          <span className="settings-popout__hint">Your {LABEL[view]} account has no picture.</span>
        ) : (
          <LinkConsent
            key={view}
            provider={view}
            busy={busy}
            onLink={() => {
              run(() => linkAndWear(view)).catch(reportErr)
            }}
          />
        ))}

      {view === 'upload' && (
        <div style={S.line}>
          <span className="settings-popout__label" style={S.grow}>
            {settings.upload ? 'Your picture' : 'Choose a picture to use'}
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
                // An upload is worn at once: picking a file on this tab means "use this".
                if (file)
                  run(async () => {
                    await avatarClient.upload(file)
                    return avatarClient.choose('upload')
                  }).catch(reportErr)
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
      )}
    </div>
  )
}

function reportErr(err: unknown) {
  console.error('[AvatarPicker] action failed', (err as Error)?.message ?? err)
}
