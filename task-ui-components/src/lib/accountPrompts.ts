/**
 * The rules behind the two account prompts the header owns (hadoku_site
 * docs/planning/account-journeys-2026-11-18.md, J5 and §4), kept free of React,
 * the DOM and every import so `src/test/account-prompts-verify.ts` asserts them
 * directly:
 *
 *   - the verify dialog: a guest hit something that needs a verified account,
 *     signalled by a backend's `403 MEMBER_NOT_VERIFIED` or by the app calling
 *     `requestVerification()`;
 *   - the keep-your-account banner: a guest with no passkey loses the account
 *     with the cookie, so after their first click they are asked to save one.
 *
 * Both are keyed on `userType === 'guest'` and nothing else: the edge sends
 * `member` only once the operator verified the account, so the tier alone says
 * who is unverified.
 */

/** What every backend answers a guest with when the action needs a verified account. */
export const MEMBER_NOT_VERIFIED = 'MEMBER_NOT_VERIFIED'

/**
 * The refusal, as task-api sends it (`code`) and as the design doc spells it
 * (`error`). Any other 403 is somebody else's refusal and opens nothing.
 */
export function isVerifyRefusal(status: number, body: unknown): boolean {
  if (status !== 403 || typeof body !== 'object' || body === null) return false
  const { code, error } = body as { code?: unknown; error?: unknown }
  return code === MEMBER_NOT_VERIFIED || error === MEMBER_NOT_VERIFIED
}

/** Only a guest is offered verification: public visitors get the edge's sign-in page, member and up already are. */
export function offersVerification(userType: string): boolean {
  return userType === 'guest'
}

/** The dialog's title: what needs verifying, when the app said. */
export function verifyTitle(reason?: string): string {
  const what = reason?.trim()
  return what ? `${what} needs a verified account` : 'This needs a verified account'
}

/**
 * Wrap a fetch so a same-origin `403 MEMBER_NOT_VERIFIED` calls `onRefusal`.
 * The caller gets the response untouched: the body is read from a clone, after
 * the response is handed back, so the hook can neither delay nor consume it.
 */
export function wrapFetchForVerify(
  fetchImpl: typeof fetch,
  onRefusal: () => void,
  sameOrigin: (url: string) => boolean
): typeof fetch {
  return async function verifyAwareFetch(input, init) {
    const res = await fetchImpl(input, init)
    if (res.status === 403 && (res.headers.get('content-type') ?? '').includes('json')) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (sameOrigin(url)) {
        res
          .clone()
          .json()
          .then(
            body => {
              if (isVerifyRefusal(res.status, body)) onRefusal()
            },
            // A 403 whose body is not JSON after all is not ours to read.
            () => undefined
          )
      }
    }
    return res
  }
}

/** Later snoozes the banner for a week. */
export const KEEP_ACCOUNT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

export function keepAccountSnoozeUntil(now: number): number {
  return now + KEEP_ACCOUNT_SNOOZE_MS
}

export interface KeepAccountState {
  userType: string
  /** Passkeys signing this person in, from whoami; null = unknown. */
  passkeys: number | null
  /** One was saved on this page. */
  passkeySaved: boolean
  /** Epoch ms the snooze runs to; 0 = never snoozed. */
  snoozedUntil: number
  now: number
}

/**
 * The person is owed the banner: a guest whose account exists only on this
 * device, not snoozed. An unknown passkey count never prompts. WHEN it shows
 * (after the first click, once per page) is the host's half.
 */
export function keepAccountDue(s: KeepAccountState): boolean {
  return s.userType === 'guest' && s.passkeys === 0 && !s.passkeySaved && !(s.snoozedUntil > s.now)
}
