/**
 * AvatarBuilder — the body of AvatarDialog: the person's avatar and what they
 * wear with it, with a live preview.
 *
 * Layout (operator's pick, 2026-11-01): a preview column on the left (the
 * avatar large, with the name, and a chat line as others see it), and on the
 * right tabs for the Picture (AvatarPicker) and each cosmetic slot. Narrow
 * screens stack the two.
 *
 * Cosmetics (`@wolffm/prefs-client/cosmetics`, bundled at build like the avatar
 * client): earned items equip on click; items not yet earned show how to earn
 * them and can be tried on in the preview, which saves nothing. An overlay
 * image can be placed: drag it on the big preview, turn it with the top handle,
 * resize it with the corner handle, or use the sliders. Every move goes through
 * `fitPlacement`, the same function prefs-api runs before it stores one, so the
 * preview never shows a spot the server would refuse.
 *
 * Styles are inline for the reason AvatarPicker's are: apps compile this
 * package's CSS at their own build. Tokens only; the cosmetics' own colours come
 * from the person's character colour (and, for overlay images, the art).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@wolffm/themes'
import type { AvatarSettings, LoadoutUpdate } from '@wolffm/prefs-client/avatar'
import {
  COSMETICS,
  COSMETICS_BY_ID,
  COSMETIC_SLOTS,
  PLACEMENT_DEFAULT,
  PLACEMENT_LIMITS,
  avatarHtml,
  cleanLoadout,
  ensureCosmeticsStyles,
  fitPlacement,
  messageHtml,
  nameHtml,
  placementTransform,
  wornCosmetics,
  type AvatarCosmetics,
  type CosmeticSlot,
  type Loadout,
  type OverlayArt,
  type Placement
} from '@wolffm/prefs-client/cosmetics'
import { AvatarPicker } from './AvatarPicker'
import { AVATAR_EVENT } from '../lib/avatarEvent'
import {
  avatarClient,
  avatarErrorText,
  fetchCharacters,
  portraitUrl,
  type CharacterSet
} from '../lib/avatarData'

type Tab = 'picture' | CosmeticSlot

const SLOT_LABEL: Record<CosmeticSlot, string> = {
  effect: 'Effect',
  gradient: 'Gradient',
  font: 'Font',
  overlay: 'Overlay',
  message: 'Message'
}

const SLIDERS = [
  ['x', 'Left/right', '%'],
  ['y', 'Up/down', '%'],
  ['r', 'Rotate', '°'],
  ['s', 'Size', '%']
] as const

const S = {
  body: { display: 'grid', gap: 16, alignItems: 'start' },
  side: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  stage: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '48px 12px 18px',
    borderRadius: 10,
    background: 'var(--color-bg-alt)',
    border: '1px solid var(--color-border)',
    touchAction: 'none',
    userSelect: 'none'
  },
  tryOn: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 6,
    background: 'var(--color-primary-bg)',
    color: 'var(--color-on-primary-bg)',
    fontSize: '0.72rem'
  },
  linkBtn: {
    border: 0,
    background: 'none',
    color: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: 'inherit',
    padding: 0,
    flex: 'none'
  },
  chat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)'
  },
  chatHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.72rem',
    color: 'var(--color-text-muted)'
  },
  msg: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  who: { minHeight: 22, display: 'flex', alignItems: 'center' },
  line: { fontSize: '0.85rem', marginTop: 2 },
  place: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    border: '1px solid var(--color-border)'
  },
  placeHead: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.8rem' },
  hint: { fontSize: '0.72rem', color: 'var(--color-text-muted)' },
  slider: {
    display: 'grid',
    gridTemplateColumns: '64px 1fr 40px',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.75rem',
    color: 'var(--color-text-muted)'
  },
  out: { textAlign: 'right', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' },
  toggles: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    fontSize: '0.75rem',
    color: 'var(--color-text-muted)'
  },
  tabs: {
    display: 'flex',
    gap: 2,
    borderBottom: '1px solid var(--color-border)',
    overflowX: 'auto',
    scrollbarWidth: 'none'
  },
  tab: {
    flex: 'none',
    padding: '7px 11px',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    borderTop: 0,
    borderLeft: 0,
    borderRight: 0,
    background: 'none',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--color-text-muted)'
  },
  tabOn: { color: 'var(--color-text)', borderBottomColor: 'var(--color-primary)' },
  count: { fontSize: '0.68rem', marginLeft: 4, opacity: 0.8, fontVariantNumeric: 'tabular-nums' },
  pane: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8 },
  tile: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: 6,
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit'
  },
  tileOn: {
    borderColor: 'var(--color-primary)',
    boxShadow: 'inset 0 0 0 1px var(--color-primary)'
  },
  tileTrying: { borderStyle: 'dashed', borderColor: 'var(--color-primary)' },
  tilePv: {
    height: 58,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg-alt)',
    overflow: 'hidden',
    padding: '0 8px',
    fontSize: '0.8rem'
  },
  tileName: { fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 },
  tileEarn: { fontSize: '0.7rem', lineHeight: 1.3, color: 'var(--color-text-muted)' },
  foot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: '0.75rem',
    color: 'var(--color-text-muted)'
  }
} satisfies Record<string, React.CSSProperties>

/**
 * Trusted HTML from the cosmetics renderer, which escapes every string it is
 * given. Memoised on the string and the style: React re-sets innerHTML on every
 * render even when the string is the same, and replacing the nodes under the
 * pointer between mousedown and mouseup swallows the click.
 */
const Html = React.memo(
  function Html({ html, style }: { html: string; style?: React.CSSProperties }) {
    return <span style={style} dangerouslySetInnerHTML={{ __html: html }} />
  },
  (a, b) => a.html === b.html && JSON.stringify(a.style) === JSON.stringify(b.style)
)

/**
 * Play a tile's message reveal again. A finished reveal holds no animation (it
 * fills backwards only), so its markup is re-set. This runs synchronously in
 * mouseenter, before any press, so it cannot split a click; the memo above keeps
 * React from touching it afterwards.
 */
function replayPreview(tile: HTMLElement) {
  const pv = tile.firstElementChild
  if (!pv) return
  const markup = pv.innerHTML
  pv.innerHTML = markup
}

function useNarrow(): boolean {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Move every drawing of one overlay in `root` to `p`, without re-rendering (smooth while dragging). */
function applyPlacement(root: HTMLElement | null, id: string, p: Placement) {
  root?.querySelectorAll<HTMLElement>(`.hc-art[data-hc-art="${id}"]`).forEach(ol => {
    ol.style.zIndex = p.back ? '0' : '3'
    const adj = ol.firstElementChild as HTMLElement | null
    if (adj) adj.style.transform = placementTransform(p)
  })
}

/** Settings with a new loadout, and what is worn recomputed from it. */
function withLoadout(s: AvatarSettings, loadout: Loadout): AvatarSettings {
  return {
    ...s,
    cosmetics: { ...s.cosmetics, loadout },
    avatar: { ...s.avatar, cosmetics: wornCosmetics(loadout) }
  }
}

export interface AvatarBuilderProps {
  /** The person's display name, for the preview. */
  name: string | null
}

export function AvatarBuilder({ name }: AvatarBuilderProps) {
  const [settings, setSettings] = useState<AvatarSettings | null>(null)
  const [sets, setSets] = useState<CharacterSet[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('picture')
  const [tryOn, setTryOn] = useState<{ slot: CosmeticSlot; id: string } | null>(null)
  const [showLocked, setShowLocked] = useState(true)
  const [replay, setReplay] = useState(0)
  const narrow = useNarrow()
  const root = useRef<HTMLDivElement>(null)
  // Only the newest cosmetics request may set state: equips sent quickly in a
  // row can answer out of order.
  const seq = useRef(0)

  useEffect(() => ensureCosmeticsStyles(), [])

  useEffect(() => {
    let live = true
    avatarClient
      .get()
      .then(s => live && setSettings(s))
      .catch((err: unknown) => live && setError(avatarErrorText(err)))
    fetchCharacters()
      .then(s => live && setSets(s))
      .catch((err: unknown) => live && setError(avatarErrorText(err)))
    return () => {
      live = false
    }
  }, [])

  const announce = (next: AvatarSettings) =>
    // The page under the popout (a watchparty room, a game) re-reads the avatar
    // from this instead of waiting for its next join.
    window.dispatchEvent(new window.CustomEvent<AvatarSettings>(AVATAR_EVENT, { detail: next }))

  const run = useCallback(async (work: () => Promise<AvatarSettings>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await work()
      setSettings(next)
      announce(next)
    } catch (err) {
      setError(avatarErrorText(err))
    } finally {
      setBusy(false)
    }
  }, [])

  /** Save a cosmetics change, showing `optimistic` at once. A failure re-reads the truth. */
  const wear = useCallback(
    async (update: LoadoutUpdate, optimistic: (s: AvatarSettings) => AvatarSettings) => {
      const mine = ++seq.current
      setError(null)
      setSettings(s => (s ? optimistic(s) : s))
      try {
        const next = await avatarClient.setCosmetics(update)
        if (mine !== seq.current) return
        setSettings(next)
        announce(next)
      } catch (err) {
        if (mine !== seq.current) return
        setError(avatarErrorText(err))
        avatarClient
          .get()
          .then(s => mine === seq.current && setSettings(s))
          .catch((e: unknown) => setError(avatarErrorText(e)))
      }
    },
    []
  )

  const owned = useMemo(() => new Set(settings?.cosmetics.owned ?? []), [settings])
  const loadout = settings?.cosmetics.loadout
  const equippedOverlay = loadout?.equipped.overlay ?? null
  const art: OverlayArt | undefined = equippedOverlay
    ? COSMETICS_BY_ID.get(equippedOverlay)?.art
    : undefined
  const editing = tab === 'overlay' && !tryOn && !!art && !!equippedOverlay

  // The placement being edited, live; saved a beat after the last change.
  const [live, setLive] = useState<Placement>(PLACEMENT_DEFAULT)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dragging = useRef(false)
  useEffect(() => {
    if (dragging.current || !equippedOverlay) return
    setLive(loadout?.placement[equippedOverlay] ?? PLACEMENT_DEFAULT)
  }, [equippedOverlay, loadout])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const place = useCallback(
    (raw: Partial<Placement>, save: 'later' | 'now' | 'no') => {
      if (!art || !equippedOverlay) return
      const p = fitPlacement(art, raw)
      setLive(p)
      applyPlacement(root.current, equippedOverlay, p)
      clearTimeout(saveTimer.current)
      if (save === 'no') return
      const commit = () =>
        void wear({ placement: { [equippedOverlay]: p } }, s =>
          withLoadout(s, {
            ...s.cosmetics.loadout,
            placement: { ...s.cosmetics.loadout.placement, [equippedOverlay]: p }
          })
        )
      if (save === 'now') commit()
      else saveTimer.current = setTimeout(commit, 400)
    },
    [art, equippedOverlay, wear]
  )

  if (!settings) {
    return (
      <span className="settings-popout__hint" role={error ? 'alert' : undefined}>
        {error ?? '…'}
      </span>
    )
  }

  const characters = new Map((sets ?? []).flatMap(s => s.characters).map(c => [c.id, c]))
  const character = settings.sprite ? characters.get(settings.sprite) : undefined
  const picture = settings.avatar.url ?? (character ? portraitUrl(character) : null)
  // Every name cosmetic derives its colours from the character's.
  const colour: React.CSSProperties =
    character && /^#[0-9a-f]{6}$/i.test(character.color)
      ? ({ '--hc-base': character.color } as React.CSSProperties)
      : {}
  const displayName = name || 'You'

  const worn: AvatarCosmetics = { ...(settings.avatar.cosmetics ?? {}) }
  if (tryOn) {
    worn[tryOn.slot] = tryOn.id
    if (tryOn.slot === 'overlay') delete worn.placement
  }

  const equip = (slot: CosmeticSlot, id: string | null) => {
    setTryOn(null)
    void wear({ equip: { [slot]: id } }, s => {
      const l = s.cosmetics.loadout
      return withLoadout(s, cleanLoadout({ ...l, equipped: { ...l.equipped, [slot]: id } }, owned))
    })
  }

  const stage = (
    <Stage
      html={
        avatarHtml({ src: picture, size: 112, worn }) + nameHtml(displayName, worn, { large: true })
      }
      editing={editing}
      overlayId={equippedOverlay}
      live={live}
      onPlace={place}
      dragging={dragging}
      style={colour}
      banner={
        tryOn && (
          <div style={S.tryOn}>
            <Icon name="lock" size={12} />
            <span style={{ flex: 1, minWidth: 0 }}>
              Trying on {COSMETICS_BY_ID.get(tryOn.id)?.label} ·{' '}
              {COSMETICS_BY_ID.get(tryOn.id)?.earn}
            </span>
            <button type="button" style={S.linkBtn} onClick={() => setTryOn(null)}>
              Take off
            </button>
          </div>
        )
      }
    />
  )

  const chat = (
    <div style={S.chat}>
      <div style={S.chatHead}>
        <span>In chat</span>
        <button
          type="button"
          className="settings-popout__btn"
          onClick={() => setReplay(n => n + 1)}
        >
          Replay
        </button>
      </div>
      <div style={S.msg}>
        <Html html={avatarHtml({ src: picture, size: 36, worn })} style={colour} />
        <div style={{ minWidth: 0, ...colour }}>
          <div style={S.who}>
            <Html html={nameHtml(displayName, worn)} />
          </div>
          <div style={S.line}>
            <Html key={replay} html={messageHtml('gg, that last hand was brutal', worn)} />
          </div>
        </div>
      </div>
    </div>
  )

  const placement = editing && art && (
    <div style={S.place} role="group" aria-label="Placement">
      <div style={S.placeHead}>
        <strong>Placement</strong>
        <span style={S.hint}>
          Drag it on the avatar. The top handle turns it, the corner resizes it.
        </span>
      </div>
      {SLIDERS.map(([k, label, unit]) => (
        <label key={k} style={S.slider}>
          <span>{label}</span>
          <input
            type="range"
            min={PLACEMENT_LIMITS[k][0]}
            max={PLACEMENT_LIMITS[k][1]}
            value={live[k]}
            onChange={e => place({ ...live, [k]: Number(e.currentTarget.value) }, 'later')}
            style={{ width: '100%', accentColor: 'var(--color-primary)' }}
          />
          <output style={S.out}>
            {live[k]}
            {unit}
          </output>
        </label>
      ))}
      <div style={S.toggles}>
        <label>
          <input
            type="checkbox"
            checked={live.flip}
            onChange={e => place({ ...live, flip: e.currentTarget.checked }, 'now')}
          />{' '}
          Mirror
        </label>
        <label>
          <input
            type="checkbox"
            checked={live.back}
            onChange={e => place({ ...live, back: e.currentTarget.checked }, 'now')}
          />{' '}
          Behind
        </label>
        <button
          type="button"
          className="settings-popout__btn"
          onClick={() => place(PLACEMENT_DEFAULT, 'now')}
        >
          Reset
        </button>
      </div>
    </div>
  )

  const tabs: Tab[] = ['picture', ...COSMETIC_SLOTS]
  const tabLabel = (t: Tab) => (t === 'picture' ? 'Picture' : SLOT_LABEL[t])

  return (
    <div
      ref={root}
      style={{ ...S.body, gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '240px minmax(0, 1fr)' }}
    >
      <div style={S.side}>
        {stage}
        {chat}
        {placement}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={S.tabs} role="tablist" aria-label="Avatar">
          {tabs.map(t => {
            const items = t === 'picture' ? [] : COSMETICS.filter(i => i.slot === t)
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                style={{ ...S.tab, ...(tab === t ? S.tabOn : {}) }}
                onClick={() => {
                  setTab(t)
                  setTryOn(null)
                }}
              >
                {tabLabel(t)}
                {t !== 'picture' && (
                  <span style={S.count}>
                    {items.filter(i => owned.has(i.id)).length}/{items.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div style={S.pane} role="tabpanel" aria-label={tabLabel(tab)}>
          {tab === 'picture' ? (
            <AvatarPicker settings={settings} sets={sets} busy={busy} run={run} />
          ) : (
            <SlotGrid
              slot={tab}
              owned={owned}
              equipped={loadout?.equipped[tab] ?? null}
              tryOn={tryOn}
              showLocked={showLocked}
              onShowLocked={setShowLocked}
              preview={id => {
                const only: AvatarCosmetics = { [tab]: id ?? undefined }
                if (tab === 'overlay') return avatarHtml({ src: picture, size: 40, worn: only })
                if (tab === 'message') return messageHtml('gg, rematch?', only, { keep: true })
                // A name tile shows the item on top of what is worn in the other name slots.
                return nameHtml(displayName, { ...worn, [tab]: id ?? undefined })
              }}
              colour={colour}
              onEquip={id => equip(tab, id)}
              onTry={id =>
                setTryOn(t => (t?.slot === tab && t.id === id ? null : { slot: tab, id }))
              }
            />
          )}
          {error && (
            <span className="settings-popout__error" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface StageProps {
  html: string
  editing: boolean
  overlayId: string | null
  live: Placement
  onPlace: (p: Partial<Placement>, save: 'later' | 'now' | 'no') => void
  dragging: React.MutableRefObject<boolean>
  style: React.CSSProperties
  banner: React.ReactNode
}

/** The big preview, and the placement handles drawn on its overlay while editing. */
function Stage({ html, editing, overlayId, live, onPlace, dragging, style, banner }: StageProps) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    mode: string
    p0: Placement
    x0: number
    y0: number
    cx: number
    cy: number
    a0: number
    d0: number
    size: number
    last: Placement
  } | null>(null)

  // The handles live inside the overlay's placement box, so they turn and
  // scale with it. Re-added whenever the preview is redrawn.
  useEffect(() => {
    const adj = box.current?.querySelector('.hc-art .hc-adj')
    if (!editing || !adj) return
    const gz = document.createElement('span')
    gz.dataset.g = 'move'
    gz.setAttribute('aria-hidden', 'true')
    gz.style.cssText =
      'position:absolute;inset:-3px;border:1.5px dashed var(--color-primary);border-radius:6px;pointer-events:auto;cursor:move'
    const handle = (g: string, css: string) => {
      const h = document.createElement('i')
      h.dataset.g = g
      h.style.cssText = `position:absolute;pointer-events:auto;${css}`
      gz.appendChild(h)
    }
    handle(
      'rot',
      'left:50%;top:-20px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--color-primary);cursor:grab'
    )
    handle(
      'scale',
      'right:-7px;bottom:-7px;width:12px;height:12px;border-radius:3px;background:var(--color-bg-card);border:2px solid var(--color-primary);cursor:nwse-resize'
    )
    adj.appendChild(gz)
    return () => gz.remove()
  }, [html, editing])

  const down = (e: React.PointerEvent) => {
    const g = (e.target as HTMLElement).closest<HTMLElement>('[data-g]')
    const adj = g?.closest('.hc-adj')
    const avatar = box.current?.querySelector('.hc-av')
    if (!g || !adj || !avatar || !editing || !overlayId) return
    e.preventDefault()
    g.setPointerCapture(e.pointerId)
    const r = adj.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const size = avatar.getBoundingClientRect().width
    dragging.current = true
    drag.current = {
      mode: g.dataset.g ?? 'move',
      p0: live,
      x0: e.clientX,
      y0: e.clientY,
      cx,
      cy,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      size,
      last: live
    }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let next: Partial<Placement> = d.p0
    if (d.mode === 'move') {
      next = {
        ...d.p0,
        x: d.p0.x + ((e.clientX - d.x0) / d.size) * 100,
        y: d.p0.y + ((e.clientY - d.y0) / d.size) * 100
      }
    } else if (d.mode === 'rot') {
      const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx)
      next = { ...d.p0, r: d.p0.r + ((a - d.a0) * 180) / Math.PI }
    } else {
      next = { ...d.p0, s: (d.p0.s * Math.hypot(e.clientX - d.cx, e.clientY - d.cy)) / d.d0 }
    }
    d.last = next as Placement
    onPlace(next, 'no')
  }
  const up = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    dragging.current = false
    onPlace(d.last, 'now')
  }

  return (
    <div
      ref={box}
      role="group"
      aria-label="Preview"
      style={{ ...S.stage, ...style }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {banner}
      <Html html={html} style={{ display: 'contents' }} />
    </div>
  )
}

// ---------------------------------------------------------------------------

interface SlotGridProps {
  slot: CosmeticSlot
  owned: ReadonlySet<string>
  equipped: string | null
  tryOn: { slot: CosmeticSlot; id: string } | null
  showLocked: boolean
  onShowLocked: (on: boolean) => void
  preview: (id: string | null) => string
  colour: React.CSSProperties
  onEquip: (id: string | null) => void
  onTry: (id: string) => void
}

/** One slot's items: None, then everything, earned or not. */
function SlotGrid({
  slot,
  owned,
  equipped,
  tryOn,
  showLocked,
  onShowLocked,
  preview,
  colour,
  onEquip,
  onTry
}: SlotGridProps) {
  const items = COSMETICS.filter(i => i.slot === slot)
  const locked = items.filter(i => !owned.has(i.id))
  const shown = showLocked ? items : items.filter(i => owned.has(i.id))

  return (
    <>
      <div style={S.grid}>
        <button
          type="button"
          aria-pressed={equipped === null}
          style={{ ...S.tile, ...(equipped === null ? S.tileOn : {}) }}
          onClick={() => onEquip(null)}
        >
          <Html html={preview(null)} style={{ ...S.tilePv, ...colour }} />
          <span style={S.tileName}>None</span>
        </button>
        {shown.map(item => {
          const own = owned.has(item.id)
          const on = equipped === item.id
          const trying = tryOn?.slot === slot && tryOn.id === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={own ? on : trying}
              aria-label={own ? item.label : `${item.label}, locked. ${item.earn}. Try it on.`}
              style={{
                ...S.tile,
                ...(on ? S.tileOn : {}),
                ...(trying ? S.tileTrying : {})
              }}
              onClick={() => (own ? onEquip(item.id) : onTry(item.id))}
              // A message reveal plays once; hovering its tile plays it again.
              onMouseEnter={e => slot === 'message' && replayPreview(e.currentTarget)}
            >
              <Html
                html={preview(item.id)}
                style={{ ...S.tilePv, ...colour, opacity: own ? 1 : 0.55 }}
              />
              <span style={{ ...S.tileName, color: own ? undefined : 'var(--color-text-muted)' }}>
                {!own && <Icon name="lock" size={12} />}
                {item.label}
              </span>
              {!own && <span style={S.tileEarn}>{item.earn}</span>}
            </button>
          )
        })}
      </div>
      <div style={S.foot}>
        <span>
          {locked.length
            ? `${locked.length} still to earn. Pick one to try it on.`
            : 'You have earned all of these.'}
        </span>
        {locked.length > 0 && (
          <label>
            <input
              type="checkbox"
              checked={showLocked}
              onChange={e => onShowLocked(e.currentTarget.checked)}
            />{' '}
            Show locked
          </label>
        )}
      </div>
    </>
  )
}
