/**
 * Controls gallery — scrollbars, buttons, dropdowns and tooltips from
 * @wolffm/task-ui-components, each beside the browser default it replaces.
 *
 * Same rules as the icon gallery: real theme root, real platform picker, the
 * shipped component CSS. Layout lives in gallery.css / controls.css; nothing
 * here paints a control by hand.
 *
 *   pnpm run gallery:controls  ->  http://localhost:5200/dev/gallery/controls.html
 *
 * `[` and `]` step through all 18 themes.
 */
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HadokuThemeRoot, THEMES, useHadokuTheme, type IconName } from '@wolffm/themes'
import {
  Button,
  HadokuThemePicker,
  NativeSelect,
  Select,
  Tooltip,
  type ButtonFamily,
  type ButtonVariant,
  type SelectOption,
  type SelectVariant,
  type TooltipPlacement,
  type TooltipVariant
} from '@wolffm/task-ui-components'

import '@wolffm/themes/style.css'
import '@wolffm/themes/icons.css'
import '../../src/styles/style.css'
import '@wolffm/task-ui-components/button.css'
import '@wolffm/task-ui-components/select.css'
import '@wolffm/task-ui-components/tooltip.css'
import '@wolffm/task-ui-components/scrollbar.css'
import './gallery.css'
import './controls.css'

const VARIANTS: ButtonVariant[] = ['solid', 'gradient', 'soft', 'outline', 'ghost']
const FAMILIES: ButtonFamily[] = ['primary', 'success', 'warning', 'danger', 'neutral']
const SELECT_VARIANTS: SelectVariant[] = ['outline', 'filled', 'ghost', 'underline']
const TIP_VARIANTS: TooltipVariant[] = ['inverse', 'card', 'primary']
const PLACEMENTS: TooltipPlacement[] = ['top', 'right', 'bottom', 'left']

const SCROLL_SAMPLES: { label: string; className: string | null; note: string }[] = [
  { label: 'Browser default', className: null, note: 'what we get today' },
  { label: 'Default', className: 'hdk-scroll', note: 'hdk-scroll' },
  { label: 'Thin', className: 'hdk-scroll hdk-scroll--thin', note: '--thin' },
  { label: 'Accent', className: 'hdk-scroll hdk-scroll--accent', note: '--accent' },
  { label: 'Rail', className: 'hdk-scroll hdk-scroll--rail', note: '--rail' },
  {
    label: 'Autohide',
    className: 'hdk-scroll hdk-scroll--autohide',
    note: '--autohide · hover to reveal'
  }
]

type Status = 'todo' | 'doing' | 'blocked' | 'done'

const STATUS_OPTIONS: SelectOption<Status>[] = [
  { value: 'todo', label: 'To do', icon: 'circle' },
  { value: 'doing', label: 'In progress', icon: 'activity' },
  { value: 'blocked', label: 'Blocked', icon: 'ban' },
  { value: 'done', label: 'Done', icon: 'check' }
]

const SORT_OPTIONS: SelectOption[] = [
  { value: 'recent', label: 'Recently updated', icon: 'clock', description: 'Newest edits first' },
  { value: 'created', label: 'Date created', icon: 'calendar', description: 'Oldest first' },
  { value: 'title', label: 'Title', icon: 'list', description: 'A to Z' },
  {
    value: 'priority',
    label: 'Priority',
    icon: 'flag',
    description: 'Needs a priority field',
    disabled: true
  },
  { value: 'tag', label: 'Tag', icon: 'tag', description: 'Grouped by first tag' }
]

const THEME_OPTIONS: SelectOption[] = THEMES.map(t => ({
  value: t,
  label: t,
  icon: (t.endsWith('dark') ? 'moon' : 'sun') as IconName
}))

const ROWS = [
  'Ship the controls gallery',
  'Theme the scrollbars',
  'Retire title= tooltips',
  'Swap native selects in settings',
  'Audit button chrome in hadoku_site',
  'Check izakaya contrast',
  'Write the usage notes',
  'Run the Playwright suite',
  'Publish task-ui-components',
  'Fan out to consumers',
  'Verify on prod',
  'Close the ticket'
]

function ScrollBox({ className }: { className: string | null }) {
  return (
    <div className={`controls__scroll-box ${className ?? ''}`} tabIndex={0}>
      <div className="controls__scroll-wide">
        Wide row — scroll sideways to see the horizontal bar and the corner →
      </div>
      {ROWS.map(r => (
        <div className="controls__scroll-row" key={r}>
          {r}
        </div>
      ))}
    </div>
  )
}

/** Prev / next through every theme, plus `[` `]` on the keyboard. */
function ThemeFlipper() {
  const { theme, setTheme } = useHadokuTheme()
  const index = Math.max(0, THEMES.indexOf(theme as (typeof THEMES)[number]))

  useEffect(() => {
    const step = (dir: number) => setTheme(THEMES[(index + dir + THEMES.length) % THEMES.length])
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [role="listbox"]')) return
      if (e.key === '[') step(-1)
      if (e.key === ']') step(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, setTheme])

  return (
    <div className="controls__flipper">
      <Tooltip content="Previous theme  [">
        <Button
          variant="ghost"
          family="neutral"
          icon="chevron-left"
          aria-label="Previous theme"
          onClick={() => setTheme(THEMES[(index - 1 + THEMES.length) % THEMES.length])}
        />
      </Tooltip>
      <Select
        aria-label="Theme"
        variant="filled"
        value={theme}
        onChange={setTheme}
        options={THEME_OPTIONS}
        className="controls__flipper-select"
      />
      <Tooltip content="Next theme  ]">
        <Button
          variant="ghost"
          family="neutral"
          icon="chevron-right"
          aria-label="Next theme"
          onClick={() => setTheme(THEMES[(index + 1) % THEMES.length])}
        />
      </Tooltip>
      <span className="controls__flipper-count">
        {index + 1} / {THEMES.length}
      </span>
    </div>
  )
}

function ButtonsSection() {
  const [loading, setLoading] = useState(false)

  return (
    <section className="gallery__card">
      <h2 className="gallery__h2">Buttons</h2>
      <p className="gallery__note">
        Five treatments × five families. Every pairing is a sanctioned one —{' '}
        <code>on-&lt;f&gt;</code> over <code>&lt;f&gt;</code>, <code>on-&lt;f&gt;-bg</code> over{' '}
        <code>&lt;f&gt;-bg</code> — so contrast holds in all 18 themes. <em>Gradient</em> is the
        task app&rsquo;s own active-pill look.
      </p>

      <div className="controls__matrix">
        <span />
        {FAMILIES.map(f => (
          <span className="controls__matrix-head" key={f}>
            {f}
          </span>
        ))}
        {VARIANTS.map(v => (
          <React.Fragment key={v}>
            <span className="controls__matrix-head controls__matrix-head--row">{v}</span>
            {FAMILIES.map(f => (
              <span key={f}>
                <Button variant={v} family={f}>
                  {f === 'danger' ? 'Delete' : 'Save'}
                </Button>
              </span>
            ))}
          </React.Fragment>
        ))}
      </div>

      <div className="controls__rows">
        <div className="controls__row">
          <span className="gallery__label">Sizes</span>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className="controls__row">
          <span className="gallery__label">Shapes</span>
          <Button shape="square" variant="soft">
            Square
          </Button>
          <Button shape="rounded" variant="soft">
            Rounded
          </Button>
          <Button shape="pill" variant="soft">
            Pill
          </Button>
        </div>
        <div className="controls__row">
          <span className="gallery__label">With icons</span>
          <Button icon="plus">Add task</Button>
          <Button variant="outline" family="neutral" icon="refresh">
            Refresh
          </Button>
          <Button variant="soft" family="neutral" iconEnd="chevron-down">
            More
          </Button>
          <Tooltip content="Settings">
            <Button variant="ghost" family="neutral" icon="gear" aria-label="Settings" />
          </Tooltip>
          <Tooltip content="Delete">
            <Button variant="soft" family="danger" icon="trash" aria-label="Delete" />
          </Tooltip>
          <Tooltip content="Star">
            <Button shape="pill" icon="star" aria-label="Star" />
          </Tooltip>
        </div>
        <div className="controls__row">
          <span className="gallery__label">States</span>
          <Button
            loading={loading}
            icon="save"
            onClick={() => {
              setLoading(true)
              setTimeout(() => setLoading(false), 1500)
            }}
          >
            {loading ? 'Saving…' : 'Click to load'}
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled outline
          </Button>
        </div>
        <div className="controls__row">
          <span className="gallery__label">Browser default</span>
          <button type="button">Save</button>
          <button type="button" disabled>
            Disabled
          </button>
        </div>
      </div>
    </section>
  )
}

function DropdownsSection() {
  const [status, setStatus] = useState<Status | null>('doing')
  const [sort, setSort] = useState<string | null>(null)
  const [native, setNative] = useState('doing')

  return (
    <section className="gallery__card">
      <h2 className="gallery__h2">Dropdowns</h2>
      <p className="gallery__note">
        <code>&lt;Select&gt;</code> is a real ARIA listbox: arrows, Home/End, Enter, Escape, and
        typeahead on both the open list and the closed trigger. The list is positioned fixed, so it
        escapes the clipped box at the end of this card and flips up when there is no room below.{' '}
        <code>&lt;NativeSelect&gt;</code> keeps the OS popup but wears the same trigger.
      </p>

      <div className="controls__select-grid">
        {SELECT_VARIANTS.map(v => (
          <label className="gallery__control" key={v}>
            <span className="gallery__label">{v}</span>
            <Select variant={v} value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </label>
        ))}
      </div>

      <div className="controls__rows">
        <div className="controls__row">
          <span className="gallery__label">Sizes</span>
          <Select
            aria-label="Status, small"
            size="sm"
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
          <Select
            aria-label="Status, medium"
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
          <Select
            aria-label="Status, large"
            size="lg"
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="controls__row">
          <span className="gallery__label">Descriptions</span>
          <Select
            aria-label="Sort by"
            placeholder="Sort by…"
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            className="controls__wide-select"
          />
          <Select
            aria-label="Disabled select"
            disabled
            value={null}
            onChange={() => {}}
            options={SORT_OPTIONS}
            placeholder="Disabled"
          />
        </div>
        <div className="controls__row">
          <span className="gallery__label">NativeSelect</span>
          {(['outline', 'filled', 'underline'] as const).map(v => (
            <NativeSelect
              key={v}
              variant={v}
              aria-label={`Native ${v}`}
              value={native}
              onChange={e => setNative(e.target.value)}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          ))}
        </div>
        <div className="controls__row">
          <span className="gallery__label">Browser default</span>
          <select
            aria-label="Browser default select"
            value={native}
            onChange={e => setNative(e.target.value)}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="controls__clip" data-testid="clip-box">
        <span className="gallery__label">Inside an overflow: hidden box</span>
        <Select
          aria-label="Theme, in a clipped box"
          value={null}
          placeholder="18 themes — scrolls"
          onChange={() => {}}
          options={THEME_OPTIONS}
        />
      </div>
    </section>
  )
}

function TooltipsSection() {
  return (
    <section className="gallery__card">
      <h2 className="gallery__h2">Tooltips</h2>
      <p className="gallery__note">
        Shows on hover <em>and</em> keyboard focus (Tab through these), Escape dismisses, and you
        can move the pointer onto the bubble to select its text. It flips and clamps at the viewport
        edge. Compare the native <code>title=</code> on the last button: a one-second wait,
        OS-drawn, and never shown to keyboard users.
      </p>

      <div className="controls__rows">
        {TIP_VARIANTS.map(v => (
          <div className="controls__row" key={v}>
            <span className="gallery__label">{v}</span>
            {PLACEMENTS.map(p => (
              <Tooltip key={p} variant={v} placement={p} content={`${v} · ${p}`}>
                <Button variant="outline" family="neutral" size="sm">
                  {p}
                </Button>
              </Tooltip>
            ))}
          </div>
        ))}
        <div className="controls__row">
          <span className="gallery__label">Toolbar</span>
          <div className="controls__toolbar">
            {(
              [
                ['note', 'Notes'],
                ['edit', 'Edit tags'],
                ['check', 'Mark complete'],
                ['copy', 'Duplicate'],
                ['trash', 'Delete task']
              ] as [IconName, string][]
            ).map(([icon, label]) => (
              <Tooltip key={icon} content={label} placement="bottom">
                <Button
                  variant="ghost"
                  family={icon === 'trash' ? 'danger' : 'neutral'}
                  size="sm"
                  icon={icon}
                  aria-label={label}
                />
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="controls__row">
          <span className="gallery__label">Long content</span>
          <Tooltip
            variant="card"
            content="Archived boards keep their tasks but drop out of the board bar. Restore one from Settings → Boards at any time."
          >
            <Button variant="soft" family="neutral" icon="info">
              What does archive do?
            </Button>
          </Tooltip>
        </div>
        <div className="controls__row">
          <span className="gallery__label">Browser default</span>
          <button type="button" title="Native title tooltip">
            Hover me (title=)
          </button>
        </div>
      </div>
    </section>
  )
}

const DEFAULT_COMPARE = ['light', 'dark', 'izakaya-light', 'cyberpunk-dark']

/** The same compact sample rendered under several themes at once. */
function CompareSection() {
  const [picked, setPicked] = useState<string[]>(DEFAULT_COMPARE)
  const [status, setStatus] = useState<Status | null>('todo')

  const toggle = (t: string) => setPicked(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))

  return (
    <section className="gallery__card">
      <h2 className="gallery__h2">Side by side</h2>
      <p className="gallery__note">
        Nested <code>data-theme</code> containers — pick any themes to line up.
      </p>
      <div className="gallery__pills controls__compare-pills">
        {THEMES.map(t => (
          <button
            key={t}
            type="button"
            className={`pill-btn ${picked.includes(t) ? 'pill-btn--active' : ''}`}
            onClick={() => toggle(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="controls__compare">
        {picked.map(t => (
          <div className="controls__compare-cell" data-theme={t} key={t}>
            <div className="controls__compare-name">{t}</div>
            <div className="controls__row">
              <Button size="sm">Save</Button>
              <Button size="sm" variant="soft" family="success">
                Done
              </Button>
              <Button size="sm" variant="outline" family="danger">
                Delete
              </Button>
              <Tooltip content={`Tooltip in ${t}`}>
                <Button size="sm" variant="ghost" family="neutral" icon="info" aria-label="Info" />
              </Tooltip>
            </div>
            <Select
              aria-label={`Status in ${t}`}
              size="sm"
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
            <div className="controls__compare-scroll">
              <ScrollBox className="hdk-scroll" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Gallery() {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  return (
    <HadokuThemeRoot containerRef={containerRef}>
      <div className="task-app-container" ref={containerRef}>
        <div className="task-app gallery">
          <header className="gallery__bar">
            <div>
              <h1 className="gallery__title">Controls gallery</h1>
              <p className="gallery__sub">
                @wolffm/task-ui-components · scrollbars, buttons, dropdowns, tooltips ·{' '}
                <a href="./index.html">icon gallery</a>
              </p>
            </div>
            <HadokuThemePicker />
          </header>

          <div className="controls__sticky">
            <ThemeFlipper />
          </div>

          <section className="gallery__card">
            <h2 className="gallery__h2">Scrollbars</h2>
            <p className="gallery__note">
              CSS only: <code>hdk-scroll</code> on a root styles that element and every scroller
              inside it, so one class covers an app. Firefox draws its own thin bar in the theme
              colours; the rounded, inset thumb is Chromium and Safari.
            </p>
            <div className="controls__scroll-grid">
              {SCROLL_SAMPLES.map(s => (
                <figure className="controls__scroll-cell" key={s.label}>
                  <ScrollBox className={s.className} />
                  <figcaption>
                    <strong>{s.label}</strong> <code>{s.note}</code>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>

          <ButtonsSection />
          <DropdownsSection />
          <TooltipsSection />
          <CompareSection />
        </div>
      </div>
    </HadokuThemeRoot>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('controls gallery: #root is missing from index.html')

createRoot(rootEl).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
)
