/**
 * Probing GitHub about a repo.
 *
 * Its own module rather than a corner of board-automation.ts: it shares nothing
 * with that file's D1 work, and two route groups need it — repo linking
 * validates before saving, and reconcile validates before minting a share off a
 * link someone else typed. Folding it into board-automation pushed that file
 * over the size threshold, which is the relocation the audit warns about.
 *
 * Every branch is pinned by worker/test/repo-validate-verify.ts.
 */

/** Probe GitHub to validate a board's `repo` (owner/name). 404 is ambiguous —
 * GitHub returns it for both "no such repo" and "private repo the token can't
 * see" (it won't leak private-repo existence), so the caller phrases it as both. */
export async function validateRepo(
  repo: string,
  token: string | undefined
): Promise<{
  repo: string
  valid: boolean
  // The exact five the published RepoValidateResponse enum names. `string` here
  // meant the compiler could not tell whether the handler and the spec still
  // agreed — and a sixth reason could have shipped without anyone noticing.
  reason: 'ok' | 'not_found_or_no_access' | 'bad_format' | 'token' | 'error'
  private?: boolean
  defaultBranch?: string
  message?: string
}> {
  const trimmed = repo.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return {
      repo: trimmed,
      valid: false,
      reason: 'bad_format',
      message: 'Use the "owner/repo" form.'
    }
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hadoku-task'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`https://api.github.com/repos/${trimmed}`, { headers })
    if (res.status === 200) {
      const data = (await res.json()) as {
        private?: boolean
        default_branch?: string
        full_name?: string
      }
      return {
        repo: data.full_name ?? trimmed,
        valid: true,
        reason: 'ok',
        private: data.private,
        defaultBranch: data.default_branch
      }
    }
    if (res.status === 404) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'not_found_or_no_access',
        message: token
          ? 'No such repo, or it is private and our GitHub token lacks access — grant the WolffM token access to it, then re-check.'
          : 'No such public repo (private-repo validation needs the GitHub token binding).'
      }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'token',
        message: 'GitHub rejected our token (scope/rate limit).'
      }
    }
    return {
      repo: trimmed,
      valid: false,
      reason: 'error',
      message: `GitHub returned ${res.status}.`
    }
  } catch {
    return { repo: trimmed, valid: false, reason: 'error', message: 'Could not reach GitHub.' }
  }
}
