/**
 * Icon gallery — a real page, not a mock.
 *
 * Runs the actual integration a consumer app gets: @wolffm/themes tokens, the task
 * app's own stylesheet, the platform <HadokuThemePicker> inside <HadokuThemeRoot>,
 * and the real component classes (.task-app__item, .pill-btn, .settings-text-input).
 * If something only looks right because the gallery hand-styled it, that is a bug in
 * the gallery — everything here is meant to prove the shipped module.
 *
 *   pnpm run gallery      ->  http://localhost:5200/dev/gallery/index.html
 */
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HadokuThemeRoot,
  Icon,
  ICON_NAMES,
  ICON_FAMILIES,
  ICON_SOURCE_SLUGS,
  LUCIDE_VERSION,
  getIconSvg,
  type IconName,
  type IconFamily,
  type IconVariant
} from '@wolffm/themes'
import { HadokuThemePicker } from '@wolffm/task-ui-components'

import '@wolffm/themes/style.css'
import '@wolffm/themes/icons.css'
import '../../src/styles/style.css'
import './gallery.css'

function Gallery() {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [variant, setVariant] = useState<IconVariant>('bare')
  const [family, setFamily] = useState<IconFamily>('warning')
  const [size, setSize] = useState(28)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ICON_NAMES
    return ICON_NAMES.filter(n => n.includes(q) || ICON_SOURCE_SLUGS[n].includes(q))
  }, [query])

  return (
    <HadokuThemeRoot containerRef={containerRef}>
      <div className="task-app-container" ref={containerRef}>
        <div className="task-app gallery">
          <header className="gallery__bar">
            <div>
              <h1 className="gallery__title">Icon gallery</h1>
              <p className="gallery__sub">
                {ICON_NAMES.length} icons · @wolffm/themes · artwork vendored from lucide{' '}
                {LUCIDE_VERSION} (ISC)
              </p>
            </div>
            {/* The real platform picker — takes no props by design. */}
            <HadokuThemePicker />
          </header>

          {/* ── controls ─────────────────────────────────────────────────── */}
          <section className="gallery__card">
            <h2 className="gallery__h2">Controls</h2>
            <div className="gallery__controls">
              <label className="gallery__control">
                <span className="gallery__label">Search</span>
                <input
                  className="settings-text-input"
                  placeholder="popcorn, trash, satellite…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>

              <div className="gallery__control">
                <span className="gallery__label">Variant</span>
                <div className="gallery__pills">
                  {(['bare', 'accent', 'tint', 'filled'] as const).map(v => (
                    <button
                      key={v}
                      className={`pill-btn ${variant === v ? 'pill-btn--active' : ''}`}
                      onClick={() => setVariant(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="gallery__control">
                <span className="gallery__label">
                  Family {variant === 'bare' && <em>(bare inherits text colour)</em>}
                </span>
                <div className="gallery__pills">
                  {ICON_FAMILIES.map(f => (
                    <button
                      key={f}
                      className={`pill-btn ${family === f ? 'pill-btn--active' : ''}`}
                      onClick={() => setFamily(f)}
                      disabled={variant === 'bare'}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <label className="gallery__control">
                <span className="gallery__label">Size — {size}px</span>
                <input
                  type="range"
                  min={12}
                  max={64}
                  value={size}
                  onChange={e => setSize(Number(e.target.value))}
                />
              </label>
            </div>
          </section>

          {/* ── the contrast story, side by side ─────────────────────────── */}
          <section className="gallery__card">
            <h2 className="gallery__h2">Why the accent lives on the tile</h2>
            <p className="gallery__note">
              Switch through all 18 themes with the picker above. The bare accent glyph on the left
              is the treatment the plan originally called for — it misses WCAG 1.4.11&rsquo;s 3:1
              non-text minimum in 8 of 36 theme/surface combinations (light 2.15, ocean-light 1.92,
              pink-light 1.67). The two tiles on the right pass 3:1 in all 18 themes, for all five
              families.
            </p>
            <div className="gallery__compare">
              <div className="gallery__compare-cell">
                <span className="gallery__bad-glyph">
                  <Icon name="warning" size={40} />
                </span>
                <code>accent glyph</code>
                <span className="gallery__verdict gallery__verdict--bad">fails 8/36</span>
              </div>
              <div className="gallery__compare-cell">
                <Icon name="warning" size={40} variant="accent" family={family} />
                <code>accent (opt-in)</code>
                <span className="gallery__verdict">yours to own</span>
              </div>
              <div className="gallery__compare-cell">
                <Icon name="warning" size={40} variant="tint" family={family} />
                <code>tint tile</code>
                <span className="gallery__verdict gallery__verdict--ok">18/18 pass</span>
              </div>
              <div className="gallery__compare-cell">
                <Icon name="warning" size={40} variant="filled" family={family} />
                <code>filled tile</code>
                <span className="gallery__verdict gallery__verdict--ok">18/18 pass</span>
              </div>
            </div>
          </section>

          {/* ── icons in real app chrome ─────────────────────────────────── */}
          <section className="gallery__card">
            <h2 className="gallery__h2">In real app chrome</h2>
            <p className="gallery__note">
              Actual task classes — <code>.task-app__item</code>, <code>.task-app__action-btn</code>
              , <code>.settings-text-input</code>. These are the buttons this repo migrated off
              emoji.
            </p>

            <div className="task-app__list task-app__list--column gallery__list">
              {[
                { title: 'Ship the icon module', tag: 'themes' },
                { title: 'Rewire the frontpage POCs', tag: 'hadoku_site' }
              ].map(t => (
                <div className="task-app__item" key={t.title}>
                  <div className="task-app__item-content">
                    <div className="task-app__item-title-row">
                      <span className="task-app__item-title">{t.title}</span>
                    </div>
                    <div className="task-app__item-meta-row">
                      <span className="task-app__item-tag">{t.tag}</span>
                      <span className="task-app__item-age">2h ago</span>
                    </div>
                  </div>
                  {/* The app's real modifier classes — they carry the gradients.
                      Base .task-app__action-btn alone has no background and falls
                      back to the browser's default button chrome. */}
                  <div className="task-app__item-actions">
                    <button
                      className="task-app__action-btn task-app__notes-toggle has-notes"
                      title="Notes"
                    >
                      <Icon name="note" />
                    </button>
                    <button
                      className="task-app__action-btn task-app__edit-tag-btn"
                      title="Edit tags"
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className="task-app__action-btn task-app__complete-btn"
                      title="Complete"
                    >
                      <Icon name="check" />
                    </button>
                    <button className="task-app__action-btn task-app__delete-btn" title="Delete">
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="gallery__form">
              <input className="settings-text-input" placeholder="New task title…" />
              <button className="pill-btn pill-btn--active">
                <Icon name="plus" /> Add
              </button>
              <button className="pill-btn">
                <Icon name="refresh" /> Refresh
              </button>
              <button className="pill-btn">
                <Icon name="gear" /> Settings
              </button>
            </div>

            <div className="gallery__badges">
              <span className="gallery__badge">
                <Icon name="check" variant="tint" family="success" size={18} /> success
              </span>
              <span className="gallery__badge">
                <Icon name="warning" variant="tint" family="warning" size={18} /> warning
              </span>
              <span className="gallery__badge">
                <Icon name="error" variant="tint" family="danger" size={18} /> danger
              </span>
              <span className="gallery__badge">
                <Icon name="info" variant="tint" family="primary" size={18} /> info
              </span>
              <span className="gallery__badge">
                <Icon name="sleep" variant="tint" family="neutral" size={18} /> idle
              </span>
            </div>
          </section>

          {/* ── the framework-free path, proven on the same page ─────────── */}
          <section className="gallery__card">
            <h2 className="gallery__h2">Framework-free path</h2>
            <p className="gallery__note">
              These are <strong>not</strong> React components — this row is raw HTML from{' '}
              <code>getIconSvg(name)</code>, the call an Astro or Qwik template makes with no client
              JS. It must look identical to the React row above it.
            </p>
            <div className="gallery__freeform">
              {(['popcorn', 'clapper', 'videotape', 'masks', 'antenna'] as IconName[]).map(n => (
                <figure className="gallery__free-cell" key={n}>
                  <div className="gallery__free-pair">
                    <span className="gallery__free-side">
                      <Icon name={n} size={32} />
                      <em>React</em>
                    </span>
                    <span className="gallery__free-vs">=</span>
                    <span className="gallery__free-side">
                      <span dangerouslySetInnerHTML={{ __html: getIconSvg(n, { size: 32 }) }} />
                      <em>string</em>
                    </span>
                  </div>
                  <figcaption>
                    <code>{n}</code>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>

          {/* ── every icon ───────────────────────────────────────────────── */}
          <section className="gallery__card">
            <h2 className="gallery__h2">
              All icons{' '}
              <span className="gallery__count">
                {shown.length}
                {shown.length !== ICON_NAMES.length && ` of ${ICON_NAMES.length}`}
              </span>
            </h2>
            {shown.length === 0 ? (
              <p className="gallery__note">No icon matches “{query}”.</p>
            ) : (
              <div className="gallery__grid">
                {shown.map(name => (
                  <figure
                    className="gallery__cell"
                    key={name}
                    title={`lucide: ${ICON_SOURCE_SLUGS[name]}`}
                  >
                    <Icon name={name} size={size} variant={variant} family={family} />
                    <figcaption className="gallery__name">{name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </HadokuThemeRoot>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
)
