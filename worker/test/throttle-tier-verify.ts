/**
 * Who the throttle bounds (throttle.ts throttleTierOf): anonymous callers and
 * guests at the public ceiling, `service` at its own, and humans the operator
 * knows (member and up — a member is verified) not at all.
 *
 * Run via: pnpm run test:worker  (or `... throttle-tier-verify`).
 */
import { throttleTierOf } from '../src/throttle'

let failed = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failed++
  // The `  ✓ name` / `  ✗ name  detail` lines every harness prints, which
  // run-worker-verify.mjs reads into its JUnit report.
  console.log(
    ok ? `  ✓ ${label}` : `  ✗ ${label}  got ${String(actual)} (want ${String(expected)})`
  )
}

check('public', throttleTierOf({ userType: 'public' }), 'public')
check('a guest', throttleTierOf({ userType: 'guest' }), 'public')
check('a member', throttleTierOf({ userType: 'member' }), null)
check('friend', throttleTierOf({ userType: 'friend' }), null)
check('service', throttleTierOf({ userType: 'service' }), 'service')
check('wife', throttleTierOf({ userType: 'wife' }), null)
check('admin', throttleTierOf({ userType: 'admin' }), null)
check('an unknown tier ranks as public', throttleTierOf({ userType: 'stranger' }), 'public')

if (failed) {
  console.error(`${failed} throttle-tier check(s) failed`)
  process.exit(1)
}
console.log('throttle-tier: all checks passed')
