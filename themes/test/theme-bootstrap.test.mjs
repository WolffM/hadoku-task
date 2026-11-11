/**
 * src/theme-bootstrap.js, run for real in a vm with fake storage, DOM and
 * fetch. hadoku_site's e2e/theme-bootstrap.spec.ts covers painting through a
 * browser; this covers the decisions: who gets the random dark draw, when it
 * stops, and what the cross-device calls send. Plus the two contracts that make
 * it shareable: its lists track this package's own THEMES and RETIRED_THEMES,
 * and its text is safe inside a <script> element and identical in both exports.
 *
 * Moved here from hadoku_site's scripts/test/theme-bootstrap.test.mjs with the
 * script itself.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(resolve(pkg, 'src/theme-bootstrap.js'), 'utf8')
const INDEX = readFileSync(resolve(pkg, 'src/index.ts'), 'utf8')

function store(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    map: m
  }
}

/**
 * Run the bootstrap once. `responses` answers fetch by "METHOD path".
 */
function boot({ local = {}, session = {}, prefersDark = false, responses = {}, random = 0 } = {}) {
  const attrs = new Map()
  const calls = []
  const errors = []
  const localStorage = store(local)
  const sessionStorage = store(session)
  const window = {
    matchMedia: () => ({ matches: prefersDark })
  }
  const sandbox = {
    window,
    localStorage,
    sessionStorage,
    document: {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: k => attrs.delete(k)
      }
    },
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    console: { error: (...a) => errors.push(a) },
    Math: Object.assign(Object.create(Math), { random: () => random }),
    Promise,
    JSON,
    Error,
    String,
    fetch: async (url, init = {}) => {
      const method = init.method || 'GET'
      calls.push({ method, url, init })
      const body = responses[`${method} ${url}`]
      if (body === undefined) return { ok: false, status: 401, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => body }
    }
  }
  vm.runInNewContext(SOURCE, sandbox)
  return { api: window.__hadokuTheme, attrs, localStorage, sessionStorage, calls, errors }
}

const settle = () => new Promise(r => setTimeout(r, 0))

// THEMES as src/index.ts exports it; the draw must be exactly its dark half.
const PKG_THEMES = [
  ...(INDEX.match(/export const THEMES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)
].map(m => m[1])
const PKG_DARK = PKG_THEMES.filter(t => t === 'dark' || t.endsWith('-dark'))

test('the draw covers exactly the dark themes in THEMES', () => {
  assert.ok(PKG_DARK.length > 0, 'no dark themes parsed from src/index.ts')
  const drawn = new Set()
  for (let i = 0; i < PKG_DARK.length; i++) {
    drawn.add(boot({ random: (i + 0.5) / PKG_DARK.length }).api.theme)
  }
  assert.deepEqual([...drawn].sort(), [...PKG_DARK].sort())
})

test('a first visit draws a dark theme even under a light OS, and pins no choice', () => {
  const { api, attrs, localStorage } = boot({ prefersDark: false })
  assert.match(api.theme, /^dark$|-dark$/)
  assert.equal(attrs.get('data-theme'), api.theme)
  assert.equal(api.chosen, false)
  assert.equal(localStorage.getItem('hadoku-theme'), null)
  assert.equal(localStorage.getItem('hadoku-theme-auto'), api.theme)
})

test('the draw is sticky on the device', () => {
  const first = boot({ random: 0.99 })
  const again = boot({ local: Object.fromEntries(first.localStorage.map), random: 0 })
  assert.equal(again.api.theme, first.api.theme)
  assert.equal(again.api.chosen, false)
})

test('a draw of a theme the package dropped is drawn again', () => {
  const { api, localStorage } = boot({ local: { 'hadoku-theme-auto': 'gone-dark' }, random: 0 })
  assert.equal(api.theme, PKG_DARK[0])
  assert.equal(localStorage.getItem('hadoku-theme-auto'), PKG_DARK[0])
})

// RETIRED_THEMES as src/index.ts exports it: the bootstrap's copy must match.
const PKG_RETIRED = Object.fromEntries(
  [
    ...(INDEX.match(/RETIRED_THEMES[^=]*=\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(
      /(?:'([^']+)'|(\w+))\s*:\s*'([^']+)'/g
    )
  ].map(m => [m[1] ?? m[2], m[3]])
)

test('the retired-theme map matches @wolffm/themes', () => {
  assert.ok(Object.keys(PKG_RETIRED).length > 0, 'no RETIRED_THEMES parsed from src/index.ts')
  const mapped = Object.fromEntries(
    Object.keys(PKG_RETIRED).map(name => [name, boot().api.normalize(name)])
  )
  const expected = Object.fromEntries(
    Object.entries(PKG_RETIRED).map(([name, to]) => [name, boot().api.normalize(to)])
  )
  assert.deepEqual(mapped, expected)
  for (const to of Object.values(expected))
    assert.ok(!(to in PKG_RETIRED), `${to} is itself retired`)
})

test('a retired theme still in storage paints its replacement', () => {
  const chosen = boot({ local: { 'hadoku-theme': 'strawberry-dark' } })
  assert.equal(chosen.api.theme, 'pink-dark')
  assert.equal(chosen.attrs.get('data-theme'), 'pink-dark')
  assert.equal(chosen.api.chosen, true)
  // The bare family token expands per the OS scheme, like any other.
  assert.equal(
    boot({ session: { 'hadoku-theme': 'strawberry' }, prefersDark: false }).api.theme,
    'pink-light'
  )
})

test('a draw of a retired theme stays the draw, as its replacement', () => {
  const { api } = boot({
    local: { 'hadoku-theme-auto': 'strawberry-dark' },
    session: { 'hadoku-theme': 'strawberry-dark' },
    random: 0
  })
  assert.equal(api.theme, 'pink-dark')
  assert.equal(api.chosen, false)
  const fresh = boot({ local: { 'hadoku-theme-auto': 'strawberry-dark' }, random: 0 })
  assert.equal(fresh.api.theme, 'pink-dark')
  assert.equal(fresh.localStorage.getItem('hadoku-theme-auto'), 'pink-dark')
})

test('a stored choice wins over the draw, light included', () => {
  const { api, attrs } = boot({
    local: { 'hadoku-theme': 'light', 'hadoku-theme-auto': 'ocean-dark' }
  })
  assert.equal(api.theme, 'light')
  assert.equal(api.chosen, true)
  assert.equal(attrs.has('data-theme'), false)
})

test('the draw echoed into sessionStorage is still not a choice', () => {
  const { api } = boot({
    local: { 'hadoku-theme-auto': 'pink-dark' },
    session: { 'hadoku-theme': 'pink-dark' }
  })
  assert.equal(api.theme, 'pink-dark')
  assert.equal(api.chosen, false)
})

test('a session-only pick that differs from the draw is a choice', () => {
  const { api } = boot({
    local: { 'hadoku-theme-auto': 'pink-dark' },
    session: { 'hadoku-theme': 'nature-light' }
  })
  assert.equal(api.chosen, true)
})

const SIGNED_IN = { 'GET /session/whoami': { userType: 'friend' } }

test('remember() writes the theme at user and device scope when signed in', async () => {
  const { api, calls, errors } = boot({
    responses: { ...SIGNED_IN, 'PUT /prefs/api/v1/portfolio': { scope: 'user' } }
  })
  api.remember('light')
  await settle()
  const puts = calls.filter(c => c.method === 'PUT')
  assert.deepEqual(
    puts.map(c => JSON.parse(c.init.body)).sort((a, b) => a.scope.localeCompare(b.scope)),
    [
      { scope: 'device', patch: { theme: 'light' } },
      { scope: 'user', patch: { theme: 'light' } }
    ]
  )
  assert.ok(puts.every(c => c.init.headers['X-Device-Id']))
  assert.equal(api.chosen, true)
  assert.deepEqual(errors, [])
})

test('remember() and adopt() send nothing to prefs-api for a signed-out visitor', async () => {
  const { api, calls } = boot({ responses: { 'GET /session/whoami': { userType: 'public' } } })
  api.adopt(() => assert.fail('adopted without a session'))
  api.remember('ocean-dark')
  await settle()
  assert.deepEqual(
    calls.map(c => c.url),
    ['/session/whoami']
  )
})

test('adopt() replaces the draw with a choice made on another device', async () => {
  const { api, attrs, localStorage } = boot({
    responses: { ...SIGNED_IN, 'GET /prefs/api/v1/portfolio': { merged: { theme: 'light' } } }
  })
  let adopted = null
  api.adopt(t => (adopted = t))
  await settle()
  assert.equal(adopted, 'light')
  assert.equal(attrs.has('data-theme'), false)
  assert.equal(localStorage.getItem('hadoku-theme'), 'light')
  assert.equal(api.chosen, true)
})

test('adopt() maps a retired theme from another device to its replacement', async () => {
  const { api, attrs, localStorage } = boot({
    responses: {
      ...SIGNED_IN,
      'GET /prefs/api/v1/portfolio': { merged: { theme: 'strawberry-light' } }
    }
  })
  let adopted = null
  api.adopt(t => (adopted = t))
  await settle()
  assert.equal(adopted, 'pink-light')
  assert.equal(attrs.get('data-theme'), 'pink-light')
  assert.equal(localStorage.getItem('hadoku-theme'), 'pink-light')
})

test('adopt() does nothing when the device already has a choice', async () => {
  const { api, calls } = boot({ local: { 'hadoku-theme': 'ocean-light' }, responses: SIGNED_IN })
  api.adopt(() => assert.fail('overrode a local choice'))
  await settle()
  assert.deepEqual(calls, [])
})

test('adopt() leaves the draw alone when no device has chosen', async () => {
  const { api, calls } = boot({
    responses: { ...SIGNED_IN, 'GET /prefs/api/v1/portfolio': { merged: {} } }
  })
  const drawn = api.theme
  api.adopt(() => assert.fail('adopted nothing'))
  await settle()
  assert.equal(calls.length, 2)
  assert.equal(api.theme, drawn)
  assert.equal(api.chosen, false)
})

test('the text is safe to put inside a <script> element verbatim', () => {
  // An HTML parser ends a script element at the first `</script`, whatever
  // JavaScript says about strings and comments, and `<!--` changes how it
  // scans for that end. Consumers inline this with is:inline / set:html and
  // no escaping, so neither may appear anywhere.
  assert.doesNotMatch(SOURCE, /<\/script/i)
  assert.doesNotMatch(SOURCE, /<!--/)
})

test('@wolffm/themes/theme-bootstrap exports the file, byte for byte', async () => {
  execFileSync(process.execPath, [resolve(pkg, 'scripts/build-theme-bootstrap.mjs')], {
    stdio: 'pipe'
  })
  const url = pathToFileURL(resolve(pkg, 'dist/theme-bootstrap.js'))
  url.search = `?t=${Date.now()}`
  const { THEME_BOOTSTRAP } = await import(url.href)
  assert.equal(THEME_BOOTSTRAP, SOURCE)
})
