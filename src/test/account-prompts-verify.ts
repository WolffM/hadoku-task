/**
 * Verification harness for the header's two account prompts
 * (@wolffm/task-ui-components lib/accountPrompts, lib/verification,
 * lib/verifyRequest): the verify dialog's triggers and its request call, and
 * the keep-your-account banner's due rule.
 *
 * The UI end of both is e2e/account-prompts.spec.ts. What is here is the part
 * that fails quietly: a trigger that fires on the wrong 403 pops a dialog at a
 * friend; one that misses the code leaves a guest at a wall with no way past;
 * a due rule keyed on `verified` instead of the guest tier shows both prompts
 * to every unverified member before the platform has minted a single guest.
 */
import {
  isVerifyRefusal,
  keepAccountDue,
  keepAccountSnoozeUntil,
  KEEP_ACCOUNT_SNOOZE_MS,
  offersVerification,
  verifyRequestOutcome,
  verifyTitle,
  wrapFetchForVerify,
  type KeepAccountState
} from '../../task-ui-components/src/lib/accountPrompts'
import {
  fetchOpensDialog,
  holdFetchOpensUntilInteraction,
  installVerifyFetchHook,
  onVerifyNeeded,
  requestVerification,
  type VerifyEventDetail
} from '../../task-ui-components/src/lib/verification'
import {
  sendVerifyRequest,
  verifyRequestOpen
} from '../../task-ui-components/src/lib/verifyRequest'

/** The whole ladder (settingsClient.ts `Tier`); every case below but guest is cut from it. */
const LADDER = ['public', 'guest', 'member', 'friend', 'service', 'wife', 'admin'] as const

let failures = 0
let checks = 0

function check(name: string, actual: unknown, expected: unknown) {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`)
  }
}

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

/** Lets the hook's clone().json() settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

// A browser's window and document, as far as these modules reach.
const page = new EventTarget() as EventTarget & Record<string, unknown>
const doc = new EventTarget()
Object.assign(globalThis, { window: page, document: doc })
page.CustomEvent = globalThis.CustomEvent
page.location = { href: 'https://hadoku.me/cardtable/', origin: 'https://hadoku.me' }

console.log('\nisVerifyRefusal: only a 403 carrying MEMBER_NOT_VERIFIED')
check('403 code (task-api)', isVerifyRefusal(403, { code: 'MEMBER_NOT_VERIFIED' }), true)
check('403 error (design doc)', isVerifyRefusal(403, { error: 'MEMBER_NOT_VERIFIED' }), true)
check('403 another code', isVerifyRefusal(403, { error: 'Forbidden', code: 'FORBIDDEN' }), false)
check('401 with the code', isVerifyRefusal(401, { code: 'MEMBER_NOT_VERIFIED' }), false)
check('403 no body', isVerifyRefusal(403, null), false)
check('403 string body', isVerifyRefusal(403, 'MEMBER_NOT_VERIFIED'), false)

console.log('\noffersVerification: the guest tier and nothing else')
for (const tier of LADDER.filter(t => t !== 'guest')) {
  check(`${tier}: no`, offersVerification(tier), false)
}
check('guest: yes', offersVerification('guest'), true)

console.log('\nverifyTitle')
check('with a reason', verifyTitle('Saving decks'), 'Saving decks needs a verified account')
check('without', verifyTitle(), 'This needs a verified account')
check('blank reason', verifyTitle('  '), 'This needs a verified account')

console.log('\nwrapFetchForVerify: a same-origin 403 MEMBER_NOT_VERIFIED, and only that')
{
  const sameOrigin = (url: string) =>
    new URL(url, 'https://hadoku.me/').origin === 'https://hadoku.me'
  const run = async (res: Response, url = '/cardtable/api/decks') => {
    let refused = 0
    const wrapped = wrapFetchForVerify(
      () => Promise.resolve(res),
      () => refused++,
      sameOrigin
    )
    const got = await wrapped(url)
    await settle()
    return { refused, got }
  }
  const coded = () => json(403, { error: 'Forbidden', code: 'MEMBER_NOT_VERIFIED' })
  check('403 code: refused once', (await run(coded())).refused, 1)
  check(
    '403 error spelling: refused',
    (await run(json(403, { error: 'MEMBER_NOT_VERIFIED' }))).refused,
    1
  )
  check('403 FORBIDDEN: nothing', (await run(json(403, { code: 'FORBIDDEN' }))).refused, 0)
  check(
    '401 with the code: nothing',
    (await run(json(401, { code: 'MEMBER_NOT_VERIFIED' }))).refused,
    0
  )
  check('200: nothing', (await run(json(200, { code: 'MEMBER_NOT_VERIFIED' }))).refused, 0)
  check(
    '403 html: nothing',
    (
      await run(
        new Response('<h1>MEMBER_NOT_VERIFIED</h1>', {
          status: 403,
          headers: { 'content-type': 'text/html' }
        })
      )
    ).refused,
    0
  )
  check('cross-origin 403: nothing', (await run(coded(), 'https://api.example.com/x')).refused, 0)
  check(
    'Request input is read by its url',
    (await run(coded(), new globalThis.Request('https://hadoku.me/x') as unknown as string))
      .refused,
    1
  )
  const { got } = await run(coded())
  check('the caller still reads the body', await got.json(), {
    error: 'Forbidden',
    code: 'MEMBER_NOT_VERIFIED'
  })
}

console.log('\nrequestVerification: one event, the first listener takes it')
{
  const first: VerifyEventDetail[] = []
  const second: VerifyEventDetail[] = []
  const off1 = onVerifyNeeded(d => first.push(d))
  const off2 = onVerifyNeeded(d => second.push(d))
  requestVerification({ reason: 'Saving decks' })
  check(
    'first listener: reason and source',
    first.map(d => [d.reason, d.source]),
    [['Saving decks', 'app']]
  )
  check('second listener: nothing', second.length, 0)
  requestVerification()
  check('no reason', first[1]?.reason, undefined)
  off1()
  off2()
}

console.log('\ninstallVerifyFetchHook: the page fetch raises the event, wrapped once')
{
  let calls = 0
  page.fetch = () => {
    calls++
    return Promise.resolve(json(403, { code: 'MEMBER_NOT_VERIFIED' }))
  }
  installVerifyFetchHook()
  const hooked = page.fetch
  installVerifyFetchHook()
  check('a second install keeps the first wrapper', page.fetch === hooked, true)
  const seen: VerifyEventDetail[] = []
  const off = onVerifyNeeded(d => seen.push(d))
  await (page.fetch as typeof fetch)('/task/api/boards')
  await settle()
  check('one fetch, one call through', calls, 1)
  check(
    'raised as a fetch refusal',
    seen.map(d => d.source),
    ['fetch']
  )
  await (page.fetch as typeof fetch)('https://elsewhere.example/api')
  await settle()
  check('cross-origin raises nothing', seen.length, 1)
  off()
}

console.log('\nafter a close, a refusal waits for the next touch of the page')
{
  check('armed at load', fetchOpensDialog(), true)
  holdFetchOpensUntilInteraction()
  check('held after a close', fetchOpensDialog(), false)
  doc.dispatchEvent(new Event('keydown'))
  check('a keypress re-arms', fetchOpensDialog(), true)
  holdFetchOpensUntilInteraction()
  doc.dispatchEvent(new Event('pointerdown'))
  check('a pointer re-arms', fetchOpensDialog(), true)
}

console.log('\nverifyRequestOutcome')
check('fresh', verifyRequestOutcome(200, { requested: true, fresh: true, requestedAt: 1 }), {
  kind: 'sent'
})
check('already open', verifyRequestOutcome(200, { requested: true, fresh: false }), {
  kind: 'already'
})
check('409: verified', verifyRequestOutcome(409, { error: 'Already verified' }), {
  kind: 'verified'
})
check('500: its words', verifyRequestOutcome(500, { error: 'Try later' }), {
  kind: 'error',
  message: 'Try later'
})
check('429 no body', verifyRequestOutcome(429, null), { kind: 'error', message: 'Not sent (429)' })

console.log('\nthe verify-request calls')
{
  const sent: { url: string; init?: Parameters<typeof fetch>[1] }[] = []
  let answer: Response = json(200, { requested: true, fresh: true, requestedAt: 5 })
  globalThis.fetch = ((url: string, init?: Parameters<typeof fetch>[1]) => {
    sent.push({ url, init })
    return Promise.resolve(answer)
  }) as typeof fetch
  check('POST sent', await sendVerifyRequest('Saving decks'), { kind: 'sent' })
  check(
    'POST route and method',
    [sent[0].url, sent[0].init?.method],
    ['/session/verify-request', 'POST']
  )
  check('POST body carries the reason', JSON.parse(String(sent[0].init?.body)), {
    reason: 'Saving decks'
  })
  check('POST is cookie-authed', sent[0].init?.credentials, 'same-origin')
  answer = json(200, { requested: true, fresh: false, requestedAt: 5 })
  check('POST already', await sendVerifyRequest(), { kind: 'already' })
  answer = json(409, { error: 'Already verified' })
  check('POST 409', await sendVerifyRequest(), { kind: 'verified' })
  answer = json(200, { tier: 'guest', requested: true, requestedAt: 5 })
  check('GET open', await verifyRequestOpen(), true)
  check('GET is a GET', sent[sent.length - 1].init?.method, undefined)
  answer = json(200, { tier: 'guest', requested: false, requestedAt: null })
  check('GET none open', await verifyRequestOpen(), false)
  globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as typeof fetch
  check('POST offline', await sendVerifyRequest(), {
    kind: 'error',
    message: 'Not sent: no connection'
  })
}

console.log('\nkeepAccountDue: a guest with no passkey, not snoozed')
{
  const now = 1_800_000_000_000
  const base: KeepAccountState = {
    userType: 'guest',
    passkeys: 0,
    passkeySaved: false,
    snoozedUntil: 0,
    now
  }
  check('guest, no passkey: due', keepAccountDue(base), true)
  check('guest with a passkey', keepAccountDue({ ...base, passkeys: 1 }), false)
  check('passkey count unknown', keepAccountDue({ ...base, passkeys: null }), false)
  check('saved one on this page', keepAccountDue({ ...base, passkeySaved: true }), false)
  for (const tier of LADDER.filter(t => t !== 'guest')) {
    check(`${tier}: never`, keepAccountDue({ ...base, userType: tier }), false)
  }
  const until = keepAccountSnoozeUntil(now)
  check('Later is seven days', until - now, 7 * 24 * 60 * 60 * 1000)
  check('the constant agrees', KEEP_ACCOUNT_SNOOZE_MS, until - now)
  check(
    'snoozed, a day in',
    keepAccountDue({ ...base, snoozedUntil: until, now: now + 86_400_000 }),
    false
  )
  check('snoozed, last ms', keepAccountDue({ ...base, snoozedUntil: until, now: until - 1 }), false)
  check('snooze over', keepAccountDue({ ...base, snoozedUntil: until, now: until + 1 }), true)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
// Throw, not process.exit: this app carries no @types/node (theme-prefs-migration-verify.ts).
if (failures > 0) throw new Error(`${failures} account-prompts check(s) failed`)
