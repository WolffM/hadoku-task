/**
 * Open repo items a board could take on — the "Automate open items" scan (§5.6).
 *
 * TenHands watches a board's repo and knows which of its open issues and PRs are
 * actually actionable: it has already dropped the pipeline's own `taskauto/*` PRs
 * and bot authors, which is exactly the filtering we would otherwise have to
 * re-derive from the GitHub API with a token and a list of heuristics. So we ask
 * it rather than GitHub:
 *
 *   GET {base}/api/taskauto/actionable?board=<handle>
 *
 * The BASE is derived from the preset source we already fetch lane contracts
 * from (AUTOMATION_PRESET_SOURCES) instead of being a second binding to keep in
 * sync — one provider, one URL, one place to change when it moves. What is NOT
 * shared with presets is the credential: a lane vocabulary is public, and this
 * is a repo's issue list, so it needs a key. We send our OWN service identity
 * (TASK_SERVICE_KEY — this repo's registry key, not TenHands' own, and not the
 * caller's: forwarding a person's key to another origin hands that origin the
 * ability to act as them).
 *
 * Fetched SERVER-side for the same reasons presets are: no CORS contract to
 * maintain, a malformed payload never reaches the UI, and one origin's outage
 * can't hang a board load. Every failure here is a REPORTED empty scan, never a
 * throw — the button this feeds simply doesn't appear.
 *
 * Deliberately NOT cached. A preset is a contract that changes monthly; this is
 * "what is open right now", read once per board load, and a cached copy would
 * offer items someone already closed.
 */
import { parsePresetSources } from './board-presets'

/** One open issue or PR TenHands says is worth working. */
export interface ActionableItem {
  kind: 'issue' | 'pr'
  number: number
  title: string
  url: string
  author?: string
  /** The task title to create, e.g. "Address #42" / "Address PR #17". */
  suggestedTitle: string
  bodySnippet?: string
  /** PRs only — the branch a runner has to check out to continue the work. */
  headRef?: string
}

/**
 * The scan result. `ok: false` always names a `reason`; an empty `items` with
 * `ok: true` genuinely means "nothing open to automate", which is the difference
 * the UI needs to avoid presenting an outage as an empty backlog.
 */
export interface ActionableScan {
  ok: boolean
  repo: string | null
  items: ActionableItem[]
  reason?: string
}

const FETCH_TIMEOUT_MS = 4000
/** The path the preset source URL ends in — what we strip to get the base. */
const PRESETS_PATH = '/automation/presets'

/**
 * The provider's base URL, derived from its presets endpoint.
 *
 * Prefers the source declared as `tenhands`; with no such id but exactly ONE
 * source configured, that one is it. Two anonymous providers is a genuine
 * ambiguity — the taskauto API is TenHands', not "whichever provider was listed
 * first" — so we answer null rather than guess and call a stranger's origin.
 */
export function taskautoBase(rawBinding: string | undefined): string | null {
  const sources = parsePresetSources(rawBinding)
  const source =
    sources.find(s => s.id === 'tenhands') ?? (sources.length === 1 ? sources[0] : null)
  if (!source) return null
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return null
  }
  const path = url.pathname.replace(/\/+$/, '')
  // Anything else means the binding points somewhere we can't reason about; a
  // guessed base would produce a 404 per board load against an unknown origin.
  if (!path.endsWith(PRESETS_PATH)) return null
  return `${url.origin}${path.slice(0, -PRESETS_PATH.length)}`
}

/** Normalise one item, or null when it isn't usable. The provider is trusted for
 * WHICH items to send; it is not trusted to send well-formed ones. */
function toItem(raw: unknown): ActionableItem | null {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object') return null
  const kind = p.kind === 'pr' ? 'pr' : p.kind === 'issue' ? 'issue' : null
  if (!kind) return null
  const number = typeof p.number === 'number' && Number.isInteger(p.number) ? p.number : null
  if (number === null || number <= 0) return null
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const url = str(p.url)
  if (!url) return null
  // A title we can't read isn't fatal — the number identifies the work, and the
  // notes carry the link. Fall back rather than drop the item.
  const title = str(p.title) ?? `${kind === 'pr' ? 'PR' : 'Issue'} #${number}`
  const suggested =
    str(p.suggested_title) ?? (kind === 'pr' ? `Address PR #${number}` : `Address #${number}`)
  return {
    kind,
    number,
    title,
    url,
    ...(str(p.author) && { author: str(p.author) }),
    suggestedTitle: suggested,
    ...(str(p.body_snippet) && { bodySnippet: str(p.body_snippet) }),
    ...(str(p.head_ref) && { headRef: str(p.head_ref) })
  }
}

/**
 * Ask TenHands what is open on this board's repo. Never throws: an unreachable
 * or unconfigured provider is a reported outcome, because the caller is a board
 * load and a board must still load.
 */
export async function fetchActionable(
  env: { AUTOMATION_PRESET_SOURCES?: string; TASK_SERVICE_KEY?: string },
  boardRef: string
): Promise<ActionableScan> {
  const base = taskautoBase(env.AUTOMATION_PRESET_SOURCES)
  if (!base) return { ok: false, repo: null, items: [], reason: 'no_provider_configured' }
  // Our identity when we have one. We still CALL without it rather than
  // refusing locally: whether this route is credentialled is the provider's
  // decision (its sibling /automation/presets is public), and a local refusal
  // would make a public route look permanently broken to anyone who hadn't
  // bound a secret they didn't need. Unauthenticated against a gated route is
  // simply a 401, reported like any other provider answer.
  const key = (env.TASK_SERVICE_KEY ?? '').trim()

  const url = `${base}/api/taskauto/actionable?board=${encodeURIComponent(boardRef)}`
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'hadoku-task',
        ...(key && { 'X-User-Key': key })
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) {
      return { ok: false, repo: null, items: [], reason: `provider_${res.status}` }
    }
    const body = (await res.json()) as {
      success?: boolean
      repo?: unknown
      items?: unknown
      error?: unknown
    }
    if (body?.success === false) {
      return { ok: false, repo: null, items: [], reason: 'provider_reported_failure' }
    }
    if (!Array.isArray(body?.items)) {
      return { ok: false, repo: null, items: [], reason: 'bad_payload' }
    }
    const items = body.items.map(toItem).filter((i): i is ActionableItem => i !== null)
    return {
      ok: true,
      repo: typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : null,
      items
    }
  } catch (e) {
    // AbortSignal.timeout() throws a TimeoutError whose MESSAGE says "aborted",
    // not "timeout" — match the name first, or every slow provider is reported
    // as unreachable and the diagnosis points at the wrong thing.
    const name = e instanceof Error ? e.name : ''
    const msg = e instanceof Error ? e.message : String(e)
    const timedOut = name === 'TimeoutError' || /timeout|timed out/i.test(msg)
    return {
      ok: false,
      repo: null,
      items: [],
      reason: timedOut ? 'provider_timeout' : 'provider_unreachable'
    }
  }
}
