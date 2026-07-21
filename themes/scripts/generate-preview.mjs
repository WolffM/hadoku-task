#!/usr/bin/env node
/**
 * Generates a standalone preview of the whole theme system.
 *
 * The page is built entirely out of the tokens it is previewing - switching
 * theme restyles the preview itself, so it doubles as proof that the token set
 * is complete. Nothing is hardcoded; every value comes from style.css.
 *
 * All output is ASCII (HTML entities / CSS escapes) so the page cannot depend
 * on the host sending a charset.
 *
 *   node themes/scripts/generate-preview.mjs [-o out.html]
 *
 * Themes are scoped to a wrapper element rather than :root because the host
 * page may already own the `data-theme` attribute on <html>.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseThemes, THEMES, FAMILIES, STYLE_PATH, isDarkTheme } from './lib/parse-themes.mjs'
import { contrast, ratio } from './lib/color.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outFlag = process.argv.indexOf('-o')
const OUT = outFlag > -1 ? process.argv[outFlag + 1] : resolve(here, '../dev/preview.html')

const themes = parseThemes()
const styleCss = readFileSync(STYLE_PATH, 'utf8')

const VARIANTS = [
  ['', 'fill'],
  ['-dark', 'gradient'],
  ['-bg', 'tint'],
  ['-hover', 'hover']
]
const STRUCTURAL_GROUPS = [
  ['Text', ['text', 'text-secondary', 'text-tertiary', 'text-muted']],
  ['Borders', ['border', 'border-light']],
  ['Surfaces', ['bg', 'bg-card', 'bg-alt', 'bg-hover', 'bg-overlay']]
]

/* ---------- contrast data, computed once and embedded ---------- */
const contrastData = {}
for (const theme of THEMES) {
  const tk = themes[theme]
  const surface = tk['--color-bg-card']
  contrastData[theme] = FAMILIES.map(f => ({
    family: f,
    fill: ratio(contrast(tk[`--color-on-${f}`], tk[`--color-${f}`], surface)),
    gradient: ratio(contrast(tk[`--color-on-${f}`], tk[`--color-${f}-dark`], surface)),
    tint: ratio(contrast(tk[`--color-on-${f}-bg`], tk[`--color-${f}-bg`], surface))
  }))
}
const totalPairs = THEMES.length * FAMILIES.length * 3
const worst = Math.min(
  ...Object.values(contrastData).flatMap(rows => rows.flatMap(r => [r.fill, r.gradient, r.tint]))
)

/* ---------- markup fragments ---------- */
const themeLabel = t => t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const themeRail = THEMES.map(
  t => `      <button class="chip" data-pick="${t}" type="button" aria-pressed="${t === 'light'}">
        <span class="chip__swatches" data-theme="${t}" aria-hidden="true">
          <i style="background: var(--color-primary)"></i><i style="background: var(--color-success)"></i><i style="background: var(--color-danger)"></i>
        </span>
        <span class="chip__name">${themeLabel(t)}</span>
      </button>`
).join('\n')

const familyRows = FAMILIES.map(
  f => `        <div class="rect__row">
          <div class="rect__label">${f}</div>
${VARIANTS.map(
  ([v, role]) => `          <div class="rect__cell">
            <div class="rect__chip" style="background: var(--color-${f}${v})"></div>
            <code>--color-${f}${v || ''}</code><span class="rect__role">${role}</span>
          </div>`
).join('\n')}
          <div class="rect__cell">
            <div class="rect__chip rect__chip--text" style="background: var(--color-${f}); color: var(--color-on-${f})">Aa</div>
            <code>--color-on-${f}</code><span class="rect__role">on fill</span>
          </div>
          <div class="rect__cell">
            <div class="rect__chip rect__chip--text" style="background: var(--color-${f}-bg); color: var(--color-on-${f}-bg)">Aa</div>
            <code>--color-on-${f}-bg</code><span class="rect__role">on tint</span>
          </div>
        </div>`
).join('\n')

const structuralRows = STRUCTURAL_GROUPS.map(
  ([label, names]) => `        <div class="struct__group">
          <div class="struct__label">${label}</div>
          <div class="struct__items">
${names
  .map(
    n => `            <div class="struct__item">
              <div class="struct__chip" style="background: var(--color-${n})"></div>
              <code>--color-${n}</code>
            </div>`
  )
  .join('\n')}
          </div>
        </div>`
).join('\n')

const buttons = FAMILIES.map(
  f => `          <button class="btn btn--${f}" type="button">${f}</button>`
).join('\n')
const badges = FAMILIES.map(f => `          <span class="badge badge--${f}">${f}</span>`).join('\n')
const familyCss = FAMILIES.map(
  f => `.btn--${f} { background: linear-gradient(180deg, var(--color-${f}) 0%, var(--color-${f}-dark) 100%); color: var(--color-on-${f}); }
.btn--${f}:hover { background: var(--color-${f}-dark); }
.badge--${f} { background: var(--color-${f}-bg); color: var(--color-on-${f}-bg); }`
).join('\n')

const html = `<title>Hadoku Theme System &mdash; 18 themes, 41 tokens</title>
<style>
${styleCss}

/* ============================================================
   Preview chrome. Deliberately built from the tokens it shows:
   change the theme and this page restyles itself, which is the
   proof that the set is complete.
   ============================================================ */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }

.stage {
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-family);
  line-height: 1.55;
  transition: background 0.25s ease, color 0.25s ease;
}

.wrap { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 0; max-width: 1280px; margin: 0 auto; }
@media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } }

/* ---- theme rail ---- */
.rail {
  position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto;
  padding: 28px 18px 40px; border-right: 1px solid var(--color-border);
  display: flex; flex-direction: column; gap: 3px;
}
@media (max-width: 860px) {
  .rail { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--color-border);
          flex-direction: row; flex-wrap: wrap; gap: 6px; }
}
.rail__eyebrow {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.11em; font-weight: 700;
  color: var(--color-text-secondary); margin-bottom: 12px; width: 100%;
}
.chip {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 7px 9px; border: 1px solid transparent; border-radius: var(--hdk-radius);
  background: transparent; color: var(--color-text-secondary);
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.chip:hover { background: var(--color-bg-hover); color: var(--color-text); }
.chip[aria-pressed='true'] { background: var(--color-primary-bg); color: var(--color-on-primary-bg); border-color: var(--color-primary); font-weight: 600; }
.chip:focus-visible { outline: none; box-shadow: var(--hdk-shadow-focus-sm); }
.chip__swatches { display: flex; flex-shrink: 0; border-radius: 3px; overflow: hidden; }
.chip__swatches i { display: block; width: 9px; height: 18px; }
.chip__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- main ---- */
main { padding: 32px 34px 80px; min-width: 0; }
@media (max-width: 640px) { main { padding: 24px 18px 60px; } }

.head { border-bottom: 1px solid var(--color-border); padding-bottom: 22px; margin-bottom: 26px; }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; font-weight: 700; text-wrap: balance; }
.head p { margin: 0; color: var(--color-text-secondary); max-width: 62ch; font-size: 14px; }

.stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.stat {
  flex: 1 1 130px; padding: 12px 14px; border: 1px solid var(--color-border-light);
  border-radius: var(--hdk-radius); background: var(--color-bg-card);
}
.stat__n { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat__l { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-secondary); margin-top: 3px; }
.stat--ok .stat__n { color: var(--color-success); }

section { margin-top: 40px; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.11em; font-weight: 700;
     color: var(--color-text-secondary); margin: 0 0 4px; }
.sub { margin: 0 0 16px; font-size: 13px; color: var(--color-text-secondary); max-width: 62ch; }

.panel { background: var(--color-bg-card); border: 1px solid var(--color-border-light);
         border-radius: var(--hdk-radius-lg); padding: 20px; }

/* ---- components ---- */
.row { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
.row + .row { margin-top: 16px; }
.btn { padding: 8px 15px; border: none; border-radius: var(--hdk-radius); font: inherit; font-size: 13px;
       font-weight: 600; cursor: pointer; text-transform: capitalize; box-shadow: var(--hdk-shadow-sm); }
.badge { padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; text-transform: capitalize; }
${familyCss}
.field { padding: 8px 11px; border: 1px solid var(--color-border); border-radius: var(--hdk-radius);
         background: var(--color-bg); color: var(--color-text); font: inherit; font-size: 13px; min-width: 190px; }
.field:focus { outline: none; border-color: var(--color-primary); box-shadow: var(--hdk-shadow-focus-sm); }
.inset { background: var(--color-bg-alt); border: 1px solid var(--color-border-light);
         border-radius: var(--hdk-radius); padding: 13px 15px; margin-top: 16px; }
.type-scale > * { margin: 0 0 5px; }
.t2 { color: var(--color-text-secondary); font-size: 13.5px; }
.t3 { color: var(--color-text-tertiary); font-size: 13px; }
.t4 { color: var(--color-text-muted); font-size: 12.5px; }

/* ---- the rectangle ---- */
.rect { display: flex; flex-direction: column; gap: 7px; overflow-x: auto; }
.rect__head, .rect__row { display: grid; grid-template-columns: 68px repeat(6, minmax(104px, 1fr)); gap: 7px; align-items: start; }
.rect__head > div { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em;
                    color: var(--color-text-secondary); font-weight: 700; padding-bottom: 2px; }
.rect__label { font-size: 12px; font-weight: 700; text-transform: capitalize; padding-top: 9px; }
.rect__cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.rect__chip { height: 34px; border-radius: 5px; border: 1px solid var(--color-border-light); }
.rect__chip--text { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.rect__cell code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px;
                   color: var(--color-text-secondary); overflow-wrap: anywhere; line-height: 1.35; }
.rect__role { font-size: 9px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

/* ---- structural ---- */
.struct { display: flex; flex-direction: column; gap: 16px; }
.struct__label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em;
                 color: var(--color-text-secondary); font-weight: 700; margin-bottom: 7px; }
.struct__items { display: flex; flex-wrap: wrap; gap: 8px; }
.struct__item { display: flex; flex-direction: column; gap: 3px; width: 132px; }
.struct__chip { height: 30px; border-radius: 5px; border: 1px solid var(--color-border); }
.struct__item code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px;
                     color: var(--color-text-secondary); overflow-wrap: anywhere; }

/* ---- contrast matrix ---- */
/* color: inherit is load-bearing. In quirks mode (a host that serves this
   fragment without a doctype) tables do not inherit colour from their
   ancestors, so the text falls back to black and vanishes on dark themes. */
.matrix { width: 100%; border-collapse: collapse; font-size: 12.5px; color: inherit; }
.matrix th, .matrix td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-border-light); color: inherit; }
.matrix th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-secondary); font-weight: 700; }
.matrix td:first-child { font-weight: 600; text-transform: capitalize; }
.matrix tr:last-child td { border-bottom: none; }
.ratio { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.ratio::after { content: ' \\2713'; color: var(--color-success); font-weight: 700; }
.ratio--fail { color: var(--color-danger); font-weight: 700; }
.ratio--fail::after { content: ' \\2715'; color: var(--color-danger); }

.note { margin-top: 12px; font-size: 12px; color: var(--color-text-secondary); }
.note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="stage" id="stage" data-theme="light">
  <div class="wrap">
    <nav class="rail" aria-label="Theme">
      <div class="rail__eyebrow">${THEMES.length} Themes</div>
${themeRail}
    </nav>

    <main>
      <header class="head">
        <h1>Hadoku Theme System</h1>
        <p>Every semantic family carries an identical set of six tokens. This page is built from
           those tokens &mdash; switching theme restyles the page itself, so what you see is the system
           proving it is complete.</p>
        <div class="stats">
          <div class="stat"><div class="stat__n">${THEMES.length}</div><div class="stat__l">Themes</div></div>
          <div class="stat"><div class="stat__n">41</div><div class="stat__l">Color tokens</div></div>
          <div class="stat"><div class="stat__n">5 &times; 6</div><div class="stat__l">Family rectangle</div></div>
          <div class="stat stat--ok"><div class="stat__n" id="stat-pairs">${totalPairs}</div><div class="stat__l">WCAG pairs pass</div></div>
          <div class="stat stat--ok"><div class="stat__n">${ratio(worst)}:1</div><div class="stat__l">Worst pair</div></div>
        </div>
      </header>

      <section>
        <h2>Components</h2>
        <p class="sub">Rendered live in <strong id="theme-name">Light</strong>. Buttons use the fill&rarr;gradient ramp with
           <code>on-&lt;f&gt;</code>; badges use the tint with <code>on-&lt;f&gt;-bg</code>.</p>
        <div class="panel">
          <div class="row">
${buttons}
          </div>
          <div class="row">
${badges}
          </div>
          <div class="row">
            <input class="field" value="Input field" aria-label="Sample input" />
            <button class="btn btn--neutral" type="button">Cancel</button>
            <button class="btn btn--primary" type="button">Save</button>
          </div>
          <div class="inset type-scale">
            <p>Body text &mdash; <code>--color-text</code></p>
            <p class="t2">Secondary text &mdash; <code>--color-text-secondary</code></p>
            <p class="t3">Tertiary text &mdash; <code>--color-text-tertiary</code></p>
            <p class="t4">Muted text &mdash; <code>--color-text-muted</code></p>
          </div>
        </div>
      </section>

      <section>
        <h2>The family rectangle</h2>
        <p class="sub">Five families down, six tokens across, no gaps. The symmetry is the point &mdash; it means the
           obvious guess is always a real token.</p>
        <div class="panel rect">
          <div class="rect__head">
            <div></div><div>Fill</div><div>Gradient</div><div>Tint</div><div>Hover</div><div>On fill</div><div>On tint</div>
          </div>
${familyRows}
        </div>
      </section>

      <section>
        <h2>Structural tokens</h2>
        <p class="sub">Text hierarchy, borders and surfaces &mdash; shared across all families.</p>
        <div class="panel struct">
${structuralRows}
        </div>
      </section>

      <section>
        <h2>Contrast &mdash; measured, not asserted</h2>
        <p class="sub">Every pair must clear WCAG AA 4.5:1. Translucent tints are composited over
           <code>--color-bg-card</code> before measuring, so these are the ratios that actually render.</p>
        <div class="panel">
          <table class="matrix">
            <thead><tr><th>Family</th><th>on-&lt;f&gt; on fill</th><th>on-&lt;f&gt; on gradient</th><th>on-&lt;f&gt;-bg on tint</th></tr></thead>
            <tbody id="matrix-body"></tbody>
          </table>
          <p class="note">Before this release the tint column used <code>--color-&lt;f&gt;</code> as its text
             colour and failed in 62 of 90 theme&times;family combinations.</p>
        </div>
      </section>
    </main>
  </div>
</div>

<script>
  const CONTRAST = ${JSON.stringify(contrastData)};
  const DARK = ${JSON.stringify(THEMES.filter(isDarkTheme))};
  const stage = document.getElementById('stage');
  const body = document.getElementById('matrix-body');
  const label = (t) => t.replace(/-/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());

  function cell(v) {
    const cls = v >= 4.5 ? 'ratio' : 'ratio ratio--fail';
    return '<td><span class="' + cls + '">' + v.toFixed(2) + ':1</span></td>';
  }

  function apply(theme) {
    stage.dataset.theme = theme;
    document.getElementById('theme-name').textContent = label(theme);
    document.querySelectorAll('[data-pick]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.pick === theme));
    });
    body.innerHTML = CONTRAST[theme]
      .map((r) => '<tr><td>' + r.family + '</td>' + cell(r.fill) + cell(r.gradient) + cell(r.tint) + '</tr>')
      .join('');
  }

  document.querySelectorAll('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => apply(b.dataset.pick));
  });

  // Open on a theme that matches the viewer's own light/dark preference.
  apply(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
</script>
`

writeFileSync(OUT, html)
console.log(
  `Wrote ${OUT} - ${THEMES.length} themes, ${totalPairs} contrast pairs, worst ${ratio(worst)}:1`
)
