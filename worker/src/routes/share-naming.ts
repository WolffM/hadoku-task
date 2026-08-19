/**
 * How a board's repo and the automation runner map to registry display names.
 *
 * Pure string derivation, kept apart from both the grant machinery and the
 * routes because it is the load-bearing convention: a registry row carries no
 * `repo` field, so the NAME is the only link between a board's checkout mapping
 * and an identity. worker/test/share-naming-verify.ts pins every case.
 */
import type { Env } from '../types'

/**
 * The automation runner's registry identity: the key TenHands' worker actually
 * presents (hadoku_site keeps its value in the `TENHANDS_SERVICE_KEY` vault item
 * and the PM2 wrapper fetches it). Deliberately NOT `tenhands-devvault`, which is
 * only the operator-side dev-vault caller and never touches a board.
 *
 * Overridable via binding because this name has churned before — the app's key was
 * retired and re-minted under a second identity (hadoku_site 881cddd2), and a
 * rename must not need a deploy of this worker to keep auto-sharing working.
 */
export const DEFAULT_RUNNER_NAME = 'tenhands-service-key'

/** The registry name of the automation runner, for callers outside this module. */
export function automationRunnerName(env: Env): string {
  return env.AUTOMATION_RUNNER_KEY_NAME?.trim() || DEFAULT_RUNNER_NAME
}

/**
 * The registry display name of a repo's service key, by convention:
 * **`<repo name, with a leading `hadoku-` trimmed>-service-key`**.
 *
 *   WolffM/hadoku-aggregator → aggregator-service-key
 *   WolffM/tenhands          → tenhands-service-key
 *   WolffM/hadoku_site       → site-service-key
 *
 * The separator after `hadoku` may be `-` or `_`, because one real repo spells it
 * with an underscore: `WolffM/hadoku_site`'s key is `site-service-key`, so a
 * hyphen-only trim would leave `hadoku_site-service-key` and match nothing. No
 * live key name begins with `hadoku`, so accepting both can't collide.
 *
 * The owner segment is dropped — a key is named for the repo, not who hosts it.
 * Returns null when there's nothing to derive from, so the caller can skip the
 * lookup rather than resolve a garbage name.
 *
 * This convention is the whole reason repo→key is answerable at all: the registry
 * row carries no `repo` field (hadoku_site `RegistryRecord` is
 * {userId, name, tier, createdAt, lastSeenAt, retiredAt}), so the NAME is the only
 * link between a board's checkout mapping and an identity. If the convention ever
 * stops holding, this derivation is the single place that has to change.
 */
export function repoServiceKeyName(repo: string | null | undefined): string | null {
  const trimmed = (repo ?? '').trim()
  if (!trimmed) return null
  // Boards store "owner/name"; take the repo name, tolerating a trailing slash.
  const segments = trimmed.split('/').filter(Boolean)
  const repoName = segments.length ? segments[segments.length - 1].trim() : ''
  if (!repoName) return null
  const stem = /^hadoku[-_]/i.test(repoName) ? repoName.slice('hadoku-'.length) : repoName
  // A repo named exactly "hadoku-" would trim to nothing; don't invent a name.
  if (!stem) return null
  return `${stem}-service-key`
}
