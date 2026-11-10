/**
 * Who the throttle bounds (throttle.ts throttleTierOf): anonymous callers and
 * unverified members at the public ceiling, `service` at its own, and humans
 * the operator knows (friend and up, a verified member) not at all.
 *
 * Run via: pnpm run test:worker  (or `... throttle-tier-verify`).
 */
import { throttleTierOf } from '../src/throttle'

let failed = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${String(actual)}${ok ? '' : ` (want ${String(expected)})`}`
  )
}

check('public', throttleTierOf({ userType: 'public' }), 'public')
check('an unverified member', throttleTierOf({ userType: 'member', verified: false }), 'public')
check('a member with no verified flag', throttleTierOf({ userType: 'member' }), 'public')
check('a verified member', throttleTierOf({ userType: 'member', verified: true }), null)
check('friend', throttleTierOf({ userType: 'friend' }), null)
check('service', throttleTierOf({ userType: 'service', verified: true }), 'service')
check('wife', throttleTierOf({ userType: 'wife' }), null)
check('admin', throttleTierOf({ userType: 'admin' }), null)
check('an unknown tier ranks as public', throttleTierOf({ userType: 'stranger' }), 'public')

if (failed) {
  console.error(`${failed} throttle-tier check(s) failed`)
  process.exit(1)
}
console.log('throttle-tier: all checks passed')
