/**
 * Static OpenAPI spec verification (issue #103).
 *
 * /task/api/openapi.json is no longer built per request: `pnpm run gen:worker`
 * builds it once (openapi-builder.ts) into openapi-spec.ts and root serves those
 * bytes. That trades a 90–250 ms CPU cost per fetch for one way to go wrong — a
 * schema or route edited without regenerating, so the served spec silently
 * describes an API that no longer exists. This pins both halves:
 *
 *   1. DRIFT. The committed spec equals what the live schemas build NOW.
 *   2. SERVING. Root answers with exactly those bytes, as application/json.
 *
 * openapi-verify.ts keeps validating the document's content.
 *
 * Fix drift with `pnpm run gen:worker`. Run: pnpm run test:worker
 */
import { createTaskHandler } from '../src/index'
import { buildOpenAPISpec } from '../src/openapi-builder'
import { OPENAPI_SPEC } from '../src/openapi-spec'

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
function section(title: string) {
  console.log(`\n${title}`)
}

/** Where two strings first differ, with a little context — a 90 KB one-line
 * JSON diff is otherwise unreadable. */
function firstDifference(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return `at byte ${i}: committed …${a.slice(Math.max(0, i - 40), i + 40)}… vs built …${b.slice(Math.max(0, i - 40), i + 40)}…`
}

async function main() {
  // ---------------------------------------------------------------------
  section('1. The committed spec equals what the schemas build now')
  // ---------------------------------------------------------------------
  {
    const built = await buildOpenAPISpec()
    check(
      'openapi-spec.ts is current (else: pnpm run gen:worker)',
      built === OPENAPI_SPEC,
      built === OPENAPI_SPEC ? '' : firstDifference(OPENAPI_SPEC, built)
    )
    const doc = JSON.parse(OPENAPI_SPEC) as { openapi?: string; paths?: Record<string, unknown> }
    check(
      'it is an OpenAPI 3 document',
      doc.openapi?.startsWith('3.') === true,
      `openapi=${doc.openapi}`
    )
    check(
      'it documents the routes',
      Object.keys(doc.paths ?? {}).length > 30,
      `paths=${Object.keys(doc.paths ?? {}).length}`
    )
  }

  // ---------------------------------------------------------------------
  section('2. Root serves exactly those bytes')
  // ---------------------------------------------------------------------
  {
    const app = createTaskHandler()
    const res = await app.request('http://localhost/task/api/openapi.json', {}, {})
    const body = await res.text()
    check('200', res.status === 200, `status=${res.status}`)
    check(
      'Content-Type is application/json',
      res.headers.get('Content-Type') === 'application/json',
      `content-type=${res.headers.get('Content-Type')}`
    )
    check(
      'body is the committed spec, byte for byte',
      body === OPENAPI_SPEC,
      `length=${body.length}`
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
