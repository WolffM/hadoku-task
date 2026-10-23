/**
 * hadoku.me/task/editor — drag a slider, watch the real app recolour, press
 * Save and the change is committed to main under a new version (which
 * publishes). See worker/src/routes/theme-editor.ts for what a save does.
 *
 * Two verdicts are shown live as you drag:
 *   - the theme CONTRACT (AA contrast + token symmetry) — the same code lint:css
 *     and the save route run. Any failure disables Save; the server re-checks.
 *   - COMFORT meters — glare, surface separation, border visibility, text
 *     harshness, semantic hue. Advisory: they explain why a theme can pass AA
 *     and still be tiring to look at, and never block a save.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, THEME_FAMILIES } from '@wolffm/themes'
import {
  checkTheme,
  comfortMetrics,
  isDarkTheme,
  parseThemes,
  THEMES,
  type ThemeTokenMap
} from '@wolffm/themes/contract'
import { logger } from '@wolffm/logger/client'
import type { EditorApi, SaveResult } from './api'
import {
  DISPLAY_GROUPS,
  NEUTRAL_ADJUST,
  changedTokens,
  editsFor,
  effectiveTokens,
  emptyDraft,
  fromLch,
  toLch,
  type GroupAdjust,
  type Lch,
  type ThemeDraft
} from './model'
import { Preview } from './Preview'

const DRAFTS_KEY = 'hadoku-theme-editor:drafts'

interface Loaded {
  commit: string
  versions: Record<string, string>
  originals: ThemeTokenMap
}

type Banner =
  | { kind: 'saved'; result: Extract<SaveResult, { kind: 'committed' }> }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string; detail?: string[] }
  | { kind: 'conflict'; result: Extract<SaveResult, { kind: 'conflict' }> }

/** Unsaved work survives a reload. Per-browser convenience only — never the record. */
function readDrafts(): Record<string, ThemeDraft> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ThemeDraft>) : {}
  } catch (e) {
    logger.warn('[theme-editor] could not restore drafts', { error: String(e) })
    return {}
  }
}

function writeDrafts(drafts: Record<string, ThemeDraft>) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch (e) {
    logger.warn('[theme-editor] could not persist drafts', { error: String(e) })
  }
}

const themeLabel = (() => {
  const labels: Record<string, string> = {}
  for (const f of THEME_FAMILIES) {
    labels[f.lightTheme] = f.lightLabel
    labels[f.darkTheme] = f.darkLabel
  }
  return (theme: string) => labels[theme] ?? theme
})()

function stops(n: number, at: (t: number) => string) {
  return Array.from({ length: n }, (_, i) => at(i / (n - 1))).join(', ')
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  track?: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, display, track, onChange }: SliderProps) {
  return (
    <label className="te-slider">
      <span className="te-slider__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={track ? { background: `linear-gradient(to right, ${track})` } : undefined}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="te-slider__value">{display}</span>
    </label>
  )
}

function TokenSliders({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lch = useMemo(() => toLch(value), [value])
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const set = (patch: Partial<Lch>) => onChange(fromLch({ ...lch, ...patch }))

  return (
    <div className="te-token__sliders">
      <Slider
        label="Brightness"
        value={lch.L}
        min={0}
        max={1}
        step={0.005}
        display={`${Math.round(lch.L * 100)}%`}
        track={stops(7, t => fromLch({ ...lch, L: t, A: 1 }))}
        onChange={L => set({ L })}
      />
      <Slider
        label="Saturation"
        value={lch.C}
        min={0}
        max={0.37}
        step={0.002}
        display={lch.C.toFixed(3)}
        track={stops(7, t => fromLch({ ...lch, C: t * 0.37, A: 1 }))}
        onChange={C => set({ C })}
      />
      <Slider
        label="Hue"
        value={lch.H}
        min={0}
        max={360}
        step={1}
        display={`${Math.round(lch.H)}°`}
        track={stops(13, t => fromLch({ L: 0.7, C: 0.15, H: t * 360, A: 1 }))}
        onChange={H => set({ H })}
      />
      <Slider
        label="Opacity"
        value={lch.A}
        min={0}
        max={1}
        step={0.01}
        display={`${Math.round(lch.A * 100)}%`}
        track={stops(2, t => fromLch({ ...lch, A: t }))}
        onChange={A => set({ A })}
      />
      <input
        className="te-token__text"
        value={text}
        aria-label="Colour value"
        spellCheck={false}
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          try {
            onChange(fromLch(toLch(text)))
          } catch {
            setText(value)
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

function GroupSliders({
  adjust,
  onChange
}: {
  adjust: GroupAdjust
  onChange: (a: GroupAdjust) => void
}) {
  return (
    <div className="te-group__sliders">
      <Slider
        label="Brightness"
        value={adjust.dl}
        min={-0.3}
        max={0.3}
        step={0.005}
        display={`${adjust.dl >= 0 ? '+' : ''}${Math.round(adjust.dl * 100)}`}
        onChange={dl => onChange({ ...adjust, dl })}
      />
      <Slider
        label="Saturation"
        value={adjust.cs}
        min={0}
        max={2}
        step={0.02}
        display={`×${adjust.cs.toFixed(2)}`}
        onChange={cs => onChange({ ...adjust, cs })}
      />
      <Slider
        label="Hue shift"
        value={adjust.dh}
        min={-180}
        max={180}
        step={1}
        display={`${adjust.dh >= 0 ? '+' : ''}${adjust.dh}°`}
        onChange={dh => onChange({ ...adjust, dh })}
      />
    </div>
  )
}

export function ThemeEditor({ api, initialTheme }: { api: EditorApi; initialTheme?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ThemeDraft>>(readDrafts)
  const [theme, setTheme] = useState(
    initialTheme && THEMES.includes(initialTheme) ? initialTheme : 'light'
  )
  const [openToken, setOpenToken] = useState<string | null>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  const load = useCallback(async () => {
    try {
      const src = await api.source()
      setLoaded({ commit: src.commit, versions: src.versions, originals: parseThemes(src.css) })
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => writeDrafts(drafts), [drafts])

  const draft = drafts[theme] ?? emptyDraft()
  const updateDraft = (fn: (d: ThemeDraft) => ThemeDraft) =>
    setDrafts(all => ({ ...all, [theme]: fn(all[theme] ?? emptyDraft()) }))

  const original = loaded?.originals[theme]
  const effective = useMemo(
    () => (original ? effectiveTokens(original, draft) : {}),
    [original, draft]
  )
  const changedHere = useMemo(
    () => (original ? changedTokens(original, effective) : {}),
    [original, effective]
  )

  const edits = useMemo(() => (loaded ? editsFor(loaded.originals, drafts) : {}), [loaded, drafts])
  const editCount = Object.values(edits).reduce((n, t) => n + Object.keys(t).length, 0)

  /** The contract over every theme a save would touch, plus the one on screen. */
  const problems = useMemo(() => {
    if (!loaded) return []
    const themes = new Set([...Object.keys(edits), theme])
    return [...themes].flatMap(t =>
      checkTheme(t, effectiveTokens(loaded.originals[t], drafts[t] ?? emptyDraft()))
    )
  }, [loaded, edits, drafts, theme])
  const problemsHere = problems.filter(p => p.startsWith(`${theme}:`))
  const problemsElsewhere = problems.length - problemsHere.length

  const comfort = useMemo(
    () => (original ? comfortMetrics(theme, effective) : []),
    [theme, original, effective]
  )

  async function save() {
    if (!loaded) return
    setSaving(true)
    setBanner(null)
    const result = await api.save(loaded.commit, edits, note.trim() || undefined)
    setSaving(false)
    switch (result.kind) {
      case 'committed':
        setDrafts({})
        setNote('')
        setBanner({ kind: 'saved', result })
        await load()
        return
      case 'unchanged':
        setDrafts({})
        setBanner({ kind: 'info', message: 'Nothing to save — main already has these values.' })
        return
      case 'conflict':
        setBanner({ kind: 'conflict', result })
        return
      case 'contract':
        setBanner({ kind: 'error', message: result.message, detail: result.problems })
        return
      case 'error':
        setBanner({ kind: 'error', message: result.message })
    }
  }

  if (loadError) {
    return (
      <div className="te-shell te-shell--message" role="alert">
        <Icon name="error" /> Could not load the themes: {loadError}
      </div>
    )
  }
  if (!loaded || !original) {
    return <div className="te-shell te-shell--message">Loading themes from main…</div>
  }

  const saveBlocked = problems.length > 0

  return (
    <div className="te-shell">
      <header className="te-bar">
        <h1 className="te-bar__title">
          <Icon name="palette" /> Theme editor
        </h1>
        <label className="te-bar__theme">
          <span className="te-visually-hidden">Theme</span>
          <select value={theme} onChange={e => setTheme(e.target.value)} aria-label="Theme">
            {THEME_FAMILIES.map(f => (
              <optgroup
                key={f.lightTheme}
                label={
                  f.lightLabel.endsWith(' Light')
                    ? f.lightLabel.slice(0, -' Light'.length)
                    : `${f.lightLabel} / ${f.darkLabel}`
                }
              >
                {[f.lightTheme, f.darkTheme].map(t => (
                  <option key={t} value={t}>
                    {themeLabel(t)}
                    {edits[t] ? ` (${Object.keys(edits[t]).length})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="te-bar__meta" title={loaded.commit}>
          main @ {loaded.commit.slice(0, 7)} · themes {loaded.versions['@wolffm/themes']}
        </span>
        <span className="te-bar__spacer" />
        <input
          className="te-bar__note"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note for the commit (optional)"
          aria-label="Commit note"
          maxLength={500}
        />
        <button
          type="button"
          className="te-btn"
          disabled={editCount === 0}
          onClick={() => setDrafts({})}
        >
          <Icon name="undo" /> Discard all
        </button>
        <button
          type="button"
          className="te-btn te-btn--primary"
          disabled={editCount === 0 || saveBlocked || saving}
          title={saveBlocked ? 'Fix the contract failures first' : undefined}
          onClick={() => void save()}
        >
          <Icon name="save" /> {saving ? 'Saving…' : `Save${editCount ? ` ${editCount}` : ''}`}
        </button>
      </header>

      {banner && <BannerView banner={banner} onDismiss={() => setBanner(null)} onReload={load} />}

      <div className="te-main">
        <aside className="te-controls" aria-label="Token controls">
          <section className="te-gate" aria-label="Contract">
            {problemsHere.length === 0 ? (
              <p className="te-gate__ok">
                <Icon name="check" /> {themeLabel(theme)} passes the contract
              </p>
            ) : (
              <>
                <p className="te-gate__fail">
                  <Icon name="warning" /> {problemsHere.length} contract failure
                  {problemsHere.length === 1 ? '' : 's'} — Save is blocked
                </p>
                <ul className="te-gate__list">
                  {problemsHere.map(p => (
                    <li key={p}>{p.slice(theme.length + 2)}</li>
                  ))}
                </ul>
              </>
            )}
            {problemsElsewhere > 0 && (
              <p className="te-gate__fail">
                <Icon name="warning" /> {problemsElsewhere} failure
                {problemsElsewhere === 1 ? '' : 's'} in other edited themes
              </p>
            )}
            <ul className="te-comfort" aria-label="Comfort">
              {comfort.map(m => (
                <li key={m.id} className={m.ok ? 'te-comfort__ok' : 'te-comfort__flag'}>
                  <span>{m.label}</span>
                  <span>
                    {m.display} <small>{m.target}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="te-theme-actions">
            <span>
              {Object.keys(changedHere).length} change
              {Object.keys(changedHere).length === 1 ? '' : 's'} in {themeLabel(theme)}
            </span>
            <button
              type="button"
              className="te-btn te-btn--small"
              disabled={!drafts[theme]}
              onClick={() =>
                setDrafts(all => {
                  const next = { ...all }
                  delete next[theme]
                  return next
                })
              }
            >
              <Icon name="undo" /> Reset theme
            </button>
          </div>

          {DISPLAY_GROUPS.map(group => {
            const adjust = draft.groups[group.id] ?? NEUTRAL_ADJUST
            const adjusted = adjust.dh !== 0 || adjust.cs !== 1 || adjust.dl !== 0
            return (
              <section key={group.id} className="te-group">
                <button
                  type="button"
                  className="te-group__head"
                  aria-expanded={openGroup === group.id}
                  onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
                >
                  <Icon name={openGroup === group.id ? 'chevron-down' : 'chevron-right'} />
                  <span>{group.label}</span>
                  {adjusted && <span className="te-dot" aria-label="adjusted" />}
                  <span className="te-group__hint">adjust all</span>
                </button>
                {openGroup === group.id && (
                  <GroupSliders
                    adjust={adjust}
                    onChange={a =>
                      updateDraft(d => ({ ...d, groups: { ...d.groups, [group.id]: a } }))
                    }
                  />
                )}
                <ul className="te-tokens">
                  {group.tokens.map(token => {
                    const value = effective[token]
                    const changed = token in changedHere
                    const open = openToken === `${theme}${token}`
                    return (
                      <li key={token} className="te-token">
                        <button
                          type="button"
                          className="te-token__head"
                          aria-expanded={open}
                          onClick={() => setOpenToken(open ? null : `${theme}${token}`)}
                        >
                          <span
                            className="te-swatch"
                            // Translucent tokens composite over the theme's own
                            // page colour, which is where they render.
                            style={{
                              background: `linear-gradient(${value}, ${value}), ${effective['--color-bg']}`
                            }}
                          />
                          <span className="te-token__name">{token.replace('--color-', '')}</span>
                          {changed && <span className="te-dot" aria-label="changed" />}
                          <code className="te-token__value">{value}</code>
                        </button>
                        {open && (
                          <>
                            <TokenSliders
                              value={value}
                              onChange={v =>
                                updateDraft(d => ({ ...d, tokens: { ...d.tokens, [token]: v } }))
                              }
                            />
                            {changed && (
                              <button
                                type="button"
                                className="te-btn te-btn--small"
                                onClick={() =>
                                  updateDraft(d => {
                                    const tokens = { ...d.tokens }
                                    delete tokens[token]
                                    return { ...d, tokens }
                                  })
                                }
                              >
                                <Icon name="undo" /> Back to main ({original[token]})
                              </button>
                            )}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </aside>

        <main className="te-stage" data-dark={isDarkTheme(theme) || undefined}>
          <Preview theme={theme} tokens={effective} />
        </main>
      </div>
    </div>
  )
}

function BannerView({
  banner,
  onDismiss,
  onReload
}: {
  banner: Banner
  onDismiss: () => void
  onReload: () => Promise<void>
}) {
  const close = (
    <button type="button" className="te-btn te-btn--small" onClick={onDismiss} aria-label="Dismiss">
      <Icon name="close" />
    </button>
  )
  if (banner.kind === 'saved') {
    const { result } = banner
    return (
      <div className="te-banner te-banner--success" role="status">
        <Icon name="check" />
        <span>
          Committed {result.changes.length} token{result.changes.length === 1 ? '' : 's'} to main —
          publishing @wolffm/themes {result.versions['@wolffm/themes']}, @wolffm/task{' '}
          {result.versions['@wolffm/task']}. Live on hadoku.me once the deploy finishes.{' '}
          <a href={result.url} target="_blank" rel="noreferrer">
            View commit <Icon name="external" />
          </a>
        </span>
        {close}
      </div>
    )
  }
  if (banner.kind === 'conflict') {
    return (
      <div className="te-banner te-banner--warning" role="alert">
        <Icon name="warning" />
        <span>
          {banner.result.message}:{' '}
          {banner.result.conflicts.map(c => `${c.theme} ${c.token} (now ${c.theirs})`).join(', ')}.
          Load the latest from main to see their values; saving after that replaces them with yours.
        </span>
        <button
          type="button"
          className="te-btn te-btn--small"
          onClick={() => void onReload().then(onDismiss)}
        >
          <Icon name="refresh" /> Load latest
        </button>
        {close}
      </div>
    )
  }
  if (banner.kind === 'info') {
    return (
      <div className="te-banner" role="status">
        <Icon name="info" />
        <span>{banner.message}</span>
        {close}
      </div>
    )
  }
  return (
    <div className="te-banner te-banner--danger" role="alert">
      <Icon name="error" />
      <span>
        Save failed: {banner.message}
        {banner.detail && (
          <ul>
            {banner.detail.map(d => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </span>
      {close}
    </div>
  )
}
