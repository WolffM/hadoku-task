#!/usr/bin/env node
/**
 * Re-activate a board from a provider's LIVE lane contract (fetch, don't paste).
 *
 * Pulls the preset from /task/api/automation/presets — the same server-side
 * fetch the picker uses — then runs the mandated dryRun → echo-digest → commit
 * handshake. Aborts before committing if the preview would send any task to the
 * Inbox, since a pure re-ordering must move nothing.
 *
 * Activation is owner-only, so this needs the BOARD OWNER's key, not a
 * service-tier key. Pass it in the environment so it stays out of shell history:
 *
 *   HADOKU_USER_KEY=… node scripts/reactivate-from-preset.mjs <boardId> [schemaId]
 */
const [boardId, schemaId] = process.argv.slice(2)
const KEY = process.env.HADOKU_USER_KEY
const BASE = process.env.HADOKU_BASE ?? 'https://hadoku.me/task/api'

if (!boardId || !KEY) {
  console.error(
    'usage: HADOKU_USER_KEY=<owner key> node scripts/reactivate-from-preset.mjs <boardId> [schemaId]'
  )
  process.exit(2)
}

async function call(path, body, base = BASE) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-User-Key': KEY,
      'User-Agent': 'hadoku-task',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.error(`HTTP ${res.status} non-JSON from ${path}: ${text.slice(0, 300)}`)
    process.exit(1)
  }
  return { status: res.status, json }
}

const who = await call('/session/whoami', undefined, new URL(BASE).origin)
console.log('whoami:', JSON.stringify(who.json))

const { json: listed } = await call('/automation/presets')
const presets = listed.presets ?? []
console.log(
  'sources:',
  (listed.sources ?? []).map(s => `${s.id} ok=${s.ok} count=${s.count}`).join(', ') || '(none)'
)
if (presets.length === 0) {
  console.error('No presets available — nothing to activate from.')
  process.exit(1)
}

const preset = schemaId ? presets.find(p => p.schemaId === schemaId) : presets[0]
if (!preset) {
  console.error(`No preset with schemaId "${schemaId}". Have: ${presets.map(p => p.schemaId)}`)
  process.exit(1)
}
console.log(
  `preset: ${preset.providerId}/${preset.schemaId} v${preset.schemaVersion} — ` +
    `${preset.lanes.length} lanes, orders [${preset.lanes.map(l => l.order).join(', ')}]`
)

const payload = {
  schemaId: preset.schemaId,
  schemaVersion: preset.schemaVersion,
  lanes: preset.lanes
}

const dry = await call(`/boards/${boardId}/activate-automation`, { ...payload, dryRun: true })
if (dry.status !== 200) {
  console.error(`dryRun HTTP ${dry.status}:`, JSON.stringify(dry.json))
  process.exit(1)
}
const { digest, mapping, toInbox, collisions } = dry.json.preview
console.log(`\ndryRun: digest=${digest} toInbox=${toInbox} collisions=${collisions.length}`)
for (const m of mapping)
  console.log(`   ${m.tag.padEnd(14)} ${String(m.count).padStart(3)} → ${m.lands}`)

// A re-order keeps every lane tag, so nothing should be orphaned. If something
// would be, the contract changed shape and this is a migration, not a re-order.
if (toInbox > 0) {
  console.error(`\nABORT: ${toInbox} task(s) would be cleared to the Inbox. Not a pure re-order.`)
  process.exit(1)
}

const commit = await call(`/boards/${boardId}/activate-automation`, { ...payload, digest })
if (commit.status !== 200) {
  console.error(`commit HTTP ${commit.status}:`, JSON.stringify(commit.json))
  process.exit(1)
}
console.log('\ncommitted:', JSON.stringify(commit.json.applied))

const after = await call(`/boards/${boardId}`)
const board = after.json.board ?? after.json
console.log(
  `\nboard ${board.id}: mode=${board.mode} schema=${board.schemaId} v${board.schemaVersion}`
)
for (const l of board.lanes ?? []) {
  console.log(`   ${String(l.order).padStart(2)}  ${l.tag.padEnd(14)} ${l.editableBy}`)
}
