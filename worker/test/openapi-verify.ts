/**
 * OpenAPI coverage guard — the generated /task/api/openapi.json must document the
 * agent / automation / sharing surface, not just the older task/board routes.
 *
 * TenHands (a Python consumer) codegens their client from this spec, so a new
 * route that isn't declared with createRoute silently drops out of the contract
 * and surfaces as drift at their runtime. This boots the real app, reads the
 * generated doc, and asserts every agent-facing path + a spread of schemas are
 * present — so adding a plain app.post without OpenAPI fails here.
 *
 * Run via: pnpm run test:worker  (or `... openapi-verify`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}

const REQUIRED_PATHS = [
  '/task/api/agent/claim',
  '/task/api/agent/heartbeat',
  '/task/api/agent/set-lane',
  '/task/api/agent/release',
  '/task/api/agent/cancel',
  '/task/api/agent/history',
  '/task/api/changes',
  '/task/api/boards/{ref}',
  '/task/api/boards/{ref}/shares',
  '/task/api/boards/{ref}/shares/me',
  '/task/api/boards/{ref}/shares/{granteeUserId}',
  '/task/api/automation/presets',
  '/task/api/boards/{ref}/repo',
  '/task/api/boards/{ref}/activate-automation',
  '/task/api/boards/{ref}/deactivate-automation',
  // A board's calendar (§9) — the sub-resource an integration reads to reconcile.
  '/task/api/boards/{ref}/calendar'
]

const REQUIRED_SCHEMAS = [
  'ClaimInput',
  'ClaimResponse',
  'HeartbeatInput',
  'SetLaneInput',
  'ReleaseInput',
  'ReleaseResponse',
  'CancelInput',
  'ClaimHistoryResponse',
  'ChangesResponse',
  'HydratedBoardResponse',
  'ActivateAutomationInput',
  'AutomationPreset',
  'SetRepoInput',
  'ListPresetsResponse',
  'ActivationPreview',
  'DeactivateAutomationResponse',
  'GrantShareInput',
  'ListSharesResponse',
  'BoardCalendar',
  'GetBoardCalendarResponse',
  'Lane',
  'DomainError',
  'DomainErrorCode'
]

/**
 * Error responses narrowed to the codes a single (route, status) can emit, so a
 * generated client gets one exception class per outcome. The value is the EXACT
 * enum the schema must carry — `/agent/heartbeat` 409 is only ever LEASE_LOST,
 * `/agent/release` 409 is genuinely either LEASE_LOST or LANE_CHANGED.
 */
const NARROWED_ERROR_SCHEMAS: Record<string, string[]> = {
  ForbiddenError: ['FORBIDDEN'],
  BoardNotFoundError: ['BOARD_NOT_FOUND'],
  TaskOrBoardNotFoundError: ['BOARD_NOT_FOUND', 'TASK_NOT_FOUND'],
  ClaimHeldError: ['CLAIM_HELD'],
  LeaseLostError: ['LEASE_LOST'],
  ReleaseConflictError: ['LEASE_LOST', 'LANE_CHANGED'],
  LaneUnknownError: ['LANE_UNKNOWN'],
  NotesTooLargeError: ['NOTES_TOO_LARGE'],
  DigestMismatchError: ['DIGEST_MISMATCH'],
  LaneSetInvalidError: ['LANE_SET_INVALID'],
  ShareGranteeNotFoundError: ['BOARD_NOT_FOUND', 'NAME_NOT_FOUND'],
  NoUserIdError: ['NO_USER_ID']
}

/** The (route, status) → schema wiring a Python client branches on. */
const RESPONSE_SCHEMA_REFS: Array<[string, string, string, string]> = [
  ['/task/api/agent/claim', 'post', '409', 'ClaimHeldError'],
  ['/task/api/agent/claim', 'post', '422', 'LaneUnknownError'],
  ['/task/api/agent/heartbeat', 'post', '409', 'LeaseLostError'],
  ['/task/api/agent/set-lane', 'post', '409', 'LeaseLostError'],
  ['/task/api/agent/release', 'post', '409', 'ReleaseConflictError'],
  ['/task/api/agent/release', 'post', '413', 'NotesTooLargeError'],
  ['/task/api/boards/{ref}/activate-automation', 'post', '409', 'DigestMismatchError'],
  ['/task/api/boards/{ref}/shares', 'post', '409', 'NoUserIdError'],
  ['/task/api/boards/{ref}/calendar', 'get', '404', 'BoardNotFoundError']
]

/** Every .ts under a directory, recursively. */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkTs(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * Every error code the SOURCE can actually put on the wire — the two ways one is
 * produced: a literal `code: 'X'` in a route, and a DomainError subclass passing
 * ('X', <httpStatus>) to super. Cheap and greppy on purpose: the point is that
 * adding a new code without adding it to DOMAIN_ERROR_CODES fails here rather
 * than at a consumer's parse step.
 */
function codesEmittedInSource(): Map<string, string> {
  const found = new Map<string, string>()
  const files = [
    ...walkTs(join(process.cwd(), 'worker/src')),
    ...walkTs(join(process.cwd(), 'src'))
  ]
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(process.cwd().length + 1)
    for (const m of text.matchAll(/\bcode:\s*'([A-Z][A-Z0-9_]{2,})'/g)) {
      if (!found.has(m[1])) found.set(m[1], rel)
    }
    // DomainError subclasses: super(message, 'CODE', 409) — the status may sit on
    // its own line after prettier, so allow whitespace/newlines between them.
    if (rel.endsWith('domain/types.ts')) {
      for (const m of text.matchAll(/'([A-Z][A-Z0-9_]{2,})',\s*(\d{3})/g)) {
        if (!found.has(m[1])) found.set(m[1], `${rel} (${m[2]})`)
      }
    }
  }
  return found
}

async function main() {
  console.log('OpenAPI coverage guard')
  const app = createTaskHandler()
  const res = await app.request('http://localhost/task/api/openapi.json', {}, {} as never)
  check('openapi.json served (200)', res.status === 200, `status=${res.status}`)
  const doc = (await res.json()) as {
    paths: Record<string, object>
    components?: { schemas?: Record<string, object> }
  }
  const paths = new Set(Object.keys(doc.paths ?? {}))
  const schemas = doc.components?.schemas ?? {}

  for (const p of REQUIRED_PATHS) check(`path documented: ${p}`, paths.has(p))
  for (const s of REQUIRED_SCHEMAS) check(`schema registered: ${s}`, !!schemas[s])

  // --- DomainError.code is a CLOSED enum, not a free string -------------------
  // A client generated from this spec branches on the code (CLAIM_HELD ⇒ take the
  // next task, LEASE_LOST ⇒ abort and write nothing), so an unconstrained string
  // forces them back to a hand-maintained code→exception map.
  const codeSchema = schemas['DomainErrorCode'] as { enum?: string[]; type?: string } | undefined
  const declared: string[] = codeSchema?.enum ?? []
  check('DomainErrorCode is an enum', declared.length > 0, `got ${JSON.stringify(codeSchema)}`)

  const emitted = codesEmittedInSource()
  const declaredSet = new Set(declared)
  for (const [code, where] of [...emitted].sort()) {
    check(`code declared in DomainErrorCode: ${code}`, declaredSet.has(code), `emitted at ${where}`)
  }
  // The reverse direction: a code in the enum that nothing emits is dead weight a
  // consumer would write a handler for.
  for (const code of declared) {
    check(`code still emitted somewhere: ${code}`, emitted.has(code), 'declared but unreachable')
  }

  const domainError = schemas['DomainError'] as
    | { properties?: Record<string, { $ref?: string }> }
    | undefined
  check(
    'DomainError.code $refs DomainErrorCode',
    domainError?.properties?.code?.$ref === '#/components/schemas/DomainErrorCode',
    `got ${JSON.stringify(domainError?.properties?.code)}`
  )

  // --- Per-response narrowing -------------------------------------------------
  for (const [name, expected] of Object.entries(NARROWED_ERROR_SCHEMAS)) {
    const s = schemas[name] as { properties?: { code?: { enum?: string[] } } } | undefined
    const actual = s?.properties?.code?.enum
    check(
      `narrowed schema ${name}.code = [${expected.join(', ')}]`,
      JSON.stringify(actual) === JSON.stringify(expected),
      `got ${JSON.stringify(actual)}`
    )
  }

  type Operation = {
    responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
  }
  for (const [path, method, status, schemaName] of RESPONSE_SCHEMA_REFS) {
    const op = (doc.paths as Record<string, Record<string, Operation>>)?.[path]?.[method]
    const ref = op?.responses?.[status]?.content?.['application/json']?.schema?.$ref
    check(
      `${method.toUpperCase()} ${path} ${status} → ${schemaName}`,
      ref === `#/components/schemas/${schemaName}`,
      `got ${ref}`
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
