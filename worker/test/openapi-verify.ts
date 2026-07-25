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
  '/task/api/boards/{ref}/activate-automation',
  '/task/api/boards/{ref}/deactivate-automation'
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
  'ActivationPreview',
  'DeactivateAutomationResponse',
  'GrantShareInput',
  'ListSharesResponse',
  'Lane',
  'DomainError'
]

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

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
