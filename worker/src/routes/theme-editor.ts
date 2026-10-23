/**
 * The hosted theme editor's backend (hadoku.me/task/editor).
 *
 *   GET  /task/api/themes/source — style.css as it stands on main, plus the
 *                                  commit it was read at
 *   POST /task/api/themes/save   — apply token edits and commit them to main
 *                                  under a new version, which publishes
 *
 * Both are service tier and up. The page shell is gated at the edge too
 * (ROUTE_TIERS in hadoku_site), but the editor bundle under /mf/task/ is public
 * like every child-app asset, so THIS is the seal on the write, not that.
 *
 * WHAT A SAVE GUARANTEES
 * ----------------------
 * The commit skips the local pre-commit hook, so the save re-does the parts of
 * it that could go wrong here:
 *   - the theme contract (contract.mjs — the same code lint:css runs) must pass
 *     on the resulting file, or nothing is committed (422)
 *   - the version bump mirrors scripts/version-bump.mjs: a themes/ change bumps
 *     themes, task-ui-components and task, by nextVersion's patch/.20 rule.
 *     Bumping here means publish.yml finds unpublished versions and writes no
 *     chore(release) follow-up commit
 *   - values are re-serialized by normalizeColor, never copied from the request,
 *     so a request cannot smuggle CSS into the file
 *
 * Edits are token-level, so they re-apply cleanly onto a main that moved since
 * the editor loaded. The one case that refuses (409) is someone else having
 * changed one of the SAME tokens in between — overwriting that silently would
 * lose their work.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { tierAtLeast } from '@wolffm/worker-utils'
import {
  THEMES,
  applyTokenEdits,
  checkThemes,
  normalizeColor,
  parseThemes,
  type TokenChange,
  type TokenEdits
} from '@wolffm/themes/contract'
import { logger } from '../logger'
import { ErrorResponseSchema } from '../schemas'
import type { AppContext } from '../types'
import { githubToken } from './board-automation'

const REPO = 'WolffM/hadoku-task'
const BRANCH = 'main'
const STYLE_PATH = 'themes/src/style.css'
/** Bumped together on a themes/ change — classify() in scripts/version-bump.mjs. */
const BUMPED_PACKAGES = [
  { name: '@wolffm/themes', file: 'themes/package.json' },
  { name: '@wolffm/task-ui-components', file: 'task-ui-components/package.json' },
  { name: '@wolffm/task', file: 'package.json' }
]
const MAX_ATTEMPTS = 3
const GITHUB_TIMEOUT_MS = 10_000

/** Next patch, rolling over to the next minor at .20 — nextVersion() in scripts/version-bump.mjs. */
export function nextVersion(version: string): string {
  const [maj, min, pat] = version.split('.').map(Number)
  return pat === 20 ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
}

class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function github(token: string) {
  async function call<T>(path: string, init: RequestInit = {}, accept?: string): Promise<T> {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'hadoku-task-theme-editor',
        ...(init.body ? { 'Content-Type': 'application/json' } : {})
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      throw new GitHubError(
        `GitHub ${init.method ?? 'GET'} ${path} → ${res.status} ${body}`,
        res.status
      )
    }
    return (accept === RAW ? await res.text() : await res.json()) as T
  }
  const RAW = 'application/vnd.github.raw'
  return {
    headCommit: async () =>
      (await call<{ object: { sha: string } }>(`/git/ref/heads/${BRANCH}`)).object.sha,
    /** Exact bytes — style.css is CRLF and must stay that way. */
    file: (path: string, ref: string) =>
      call<string>(`/contents/${path}?ref=${encodeURIComponent(ref)}`, {}, RAW),
    treeOf: async (commit: string) =>
      (await call<{ tree: { sha: string } }>(`/git/commits/${commit}`)).tree.sha,
    createTree: async (baseTree: string, files: Record<string, string>) =>
      (
        await call<{ sha: string }>('/git/trees', {
          method: 'POST',
          body: JSON.stringify({
            base_tree: baseTree,
            tree: Object.entries(files).map(([path, content]) => ({
              path,
              mode: '100644',
              type: 'blob',
              content
            }))
          })
        })
      ).sha,
    createCommit: async (message: string, tree: string, parent: string) =>
      (
        await call<{ sha: string }>('/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message, tree, parents: [parent] })
        })
      ).sha,
    /** Fast-forward only — a 422 means main moved under us. */
    moveBranch: (commit: string) =>
      call(`/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit, force: false })
      })
  }
}

/** Rewrite only the `"version"` value, so the rest of package.json keeps its exact bytes. */
function bumpPackageJson(text: string): { text: string; from: string; to: string } {
  const from = (JSON.parse(text) as { version: string }).version
  const to = nextVersion(from)
  const out = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${to}$2`)
  if ((JSON.parse(out) as { version: string }).version !== to) {
    throw new Error('version rewrite did not take')
  }
  return { text: out, from, to }
}

function commitMessage(changes: TokenChange[], savedBy: string | undefined, note?: string) {
  const themes = [...new Set(changes.map(c => c.theme))]
  const subject = `style(themes): theme editor — ${themes.join(', ')} (${changes.length} token${changes.length === 1 ? '' : 's'})`
  const lines = changes.map(c => `- ${c.theme} ${c.token}: ${c.from} → ${c.to}`)
  return [
    subject,
    '',
    ...(note ? [note, ''] : []),
    ...lines,
    '',
    `Saved from hadoku.me/task/editor${savedBy ? ` by ${savedBy}` : ''}.`
  ].join('\n')
}

const ColorEditsSchema = z
  .record(z.string().max(40), z.record(z.string().max(60), z.string().max(64)))
  .openapi({
    example: { 'ocean-light': { '--color-bg': '#e8f2f8' } },
    description: '`{ [theme]: { [--color-token]: cssColor } }`'
  })

const SourceResponseSchema = z.object({
  commit: z.string(),
  css: z.string(),
  versions: z.record(z.string(), z.string())
})

const SaveBodySchema = z.object({
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  edits: ColorEditsSchema,
  note: z.string().max(500).optional()
})

const ChangeSchema = z.object({
  theme: z.string(),
  token: z.string(),
  from: z.string(),
  to: z.string()
})

const SaveResponseSchema = z.object({
  committed: z.boolean(),
  commit: z.string().optional(),
  url: z.string().optional(),
  versions: z.record(z.string(), z.string()).optional(),
  changes: z.array(ChangeSchema)
})

const ConflictResponseSchema = z.object({
  error: z.string(),
  conflicts: z.array(
    z.object({ theme: z.string(), token: z.string(), yours: z.string(), theirs: z.string() })
  )
})

const ContractResponseSchema = z.object({ error: z.string(), problems: z.array(z.string()) })

const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } }
})

type SaveOutcome =
  | { kind: 'committed'; commit: string; versions: Record<string, string>; changes: TokenChange[] }
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | {
      kind: 'conflict'
      conflicts: { theme: string; token: string; yours: string; theirs: string }[]
    }
  | { kind: 'contract'; problems: string[] }
  | { kind: 'moved' }

async function attemptSave(
  gh: ReturnType<typeof github>,
  baseCommit: string,
  edits: TokenEdits,
  savedBy: string | undefined,
  note: string | undefined
): Promise<SaveOutcome> {
  const head = await gh.headCommit()
  const headCss = await gh.file(STYLE_PATH, head)

  if (head !== baseCommit) {
    const before = parseThemes(await gh.file(STYLE_PATH, baseCommit))
    const now = parseThemes(headCss)
    const conflicts = []
    for (const [theme, tokens] of Object.entries(edits)) {
      for (const [token, yours] of Object.entries(tokens)) {
        const theirs = now[theme]?.[token]
        if (theirs !== undefined && before[theme]?.[token] !== theirs) {
          conflicts.push({ theme, token, yours, theirs })
        }
      }
    }
    if (conflicts.length) return { kind: 'conflict', conflicts }
  }

  let applied: { css: string; changes: TokenChange[] }
  try {
    applied = applyTokenEdits(headCss, edits)
  } catch (e) {
    return { kind: 'invalid', message: e instanceof Error ? e.message : String(e) }
  }
  const { css, changes } = applied
  if (!changes.length) return { kind: 'unchanged' }

  const problems = checkThemes(parseThemes(css))
  if (problems.length) return { kind: 'contract', problems }

  const files: Record<string, string> = { [STYLE_PATH]: css }
  const versions: Record<string, string> = {}
  for (const pkg of BUMPED_PACKAGES) {
    const bumped = bumpPackageJson(await gh.file(pkg.file, head))
    files[pkg.file] = bumped.text
    versions[pkg.name] = bumped.to
  }

  const tree = await gh.createTree(await gh.treeOf(head), files)
  const commit = await gh.createCommit(commitMessage(changes, savedBy, note), tree, head)
  try {
    await gh.moveBranch(commit)
  } catch (e) {
    // The commit object we made is now unreferenced; GitHub collects it.
    if (e instanceof GitHubError && e.status === 422) return { kind: 'moved' }
    throw e
  }
  return { kind: 'committed', commit, versions, changes }
}

export function createThemeEditorRoutes() {
  const app = new OpenAPIHono<AppContext>()

  const sourceRoute = createRoute({
    method: 'get',
    path: '/themes/source',
    tags: ['Theme editor'],
    summary: 'Read the theme stylesheet from main',
    description:
      'themes/src/style.css exactly as it stands on main, the commit it was read at (send it back as `baseCommit` on save), and the current package versions. Service tier and up.',
    responses: {
      200: json(SourceResponseSchema, 'The stylesheet at the head of main'),
      403: json(ErrorResponseSchema, 'Service tier required'),
      502: json(ErrorResponseSchema, 'GitHub could not be read'),
      503: json(ErrorResponseSchema, 'No GitHub credential bound')
    }
  })

  app.openapi(sourceRoute, async c => {
    if (!tierAtLeast(c.get('authContext'), 'service')) {
      return c.json({ error: 'Service tier required' }, 403)
    }
    const token = githubToken(c.env)
    if (!token) return c.json({ error: 'The theme editor needs the GitHub token binding' }, 503)
    const gh = github(token)
    try {
      const commit = await gh.headCommit()
      const css = await gh.file(STYLE_PATH, commit)
      const versions: Record<string, string> = {}
      for (const pkg of BUMPED_PACKAGES) {
        versions[pkg.name] = (
          JSON.parse(await gh.file(pkg.file, commit)) as { version: string }
        ).version
      }
      return c.json({ commit, css, versions }, 200)
    } catch (e) {
      logger.warn('theme editor: source read failed', { error: String(e) })
      return c.json({ error: 'Could not read the stylesheet from GitHub' }, 502)
    }
  })

  const saveRoute = createRoute({
    method: 'post',
    path: '/themes/save',
    tags: ['Theme editor'],
    summary: 'Commit theme token edits to main',
    description:
      'Applies `{ [theme]: { [--color-token]: color } }` to themes/src/style.css on main, re-runs the theme contract (the gate lint:css runs), bumps @wolffm/themes, @wolffm/task-ui-components and @wolffm/task, and commits — which publishes. Service tier and up.',
    request: {
      body: { content: { 'application/json': { schema: SaveBodySchema } }, required: true }
    },
    responses: {
      200: json(SaveResponseSchema, 'Committed, or nothing to commit'),
      400: json(ErrorResponseSchema, 'An edit names an unknown theme/token or an invalid color'),
      403: json(ErrorResponseSchema, 'Service tier required'),
      409: json(ConflictResponseSchema, 'Someone changed the same tokens since `baseCommit`'),
      422: json(ContractResponseSchema, 'The result fails the theme contract'),
      502: json(ErrorResponseSchema, 'GitHub refused or could not be reached'),
      503: json(ErrorResponseSchema, 'No GitHub credential bound')
    }
  })

  app.openapi(saveRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'service')) {
      return c.json({ error: 'Service tier required' }, 403)
    }
    const token = githubToken(c.env)
    if (!token) return c.json({ error: 'The theme editor needs the GitHub token binding' }, 503)

    const { baseCommit, edits, note } = c.req.valid('json')

    // An unknown theme or a bad color is the caller's mistake: say so with a
    // 400 before spending a GitHub call. Whether the theme DECLARES the token
    // depends on the file, so that one is answered by attemptSave.
    try {
      for (const [theme, tokens] of Object.entries(edits)) {
        if (!THEMES.includes(theme)) throw new Error(`Unknown theme: ${theme}`)
        for (const [name, value] of Object.entries(tokens)) {
          if (!/^--color-[a-z0-9-]+$/.test(name)) throw new Error(`Not a color token: ${name}`)
          normalizeColor(value)
        }
      }
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }

    const gh = github(token)
    const savedBy = c.req.header('X-User-Name') || undefined
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const outcome = await attemptSave(gh, baseCommit, edits, savedBy, note)
        switch (outcome.kind) {
          case 'committed':
            logger.info('theme editor: committed', {
              commit: outcome.commit,
              versions: outcome.versions,
              tokens: outcome.changes.length,
              savedBy
            })
            return c.json(
              {
                committed: true,
                commit: outcome.commit,
                url: `https://github.com/${REPO}/commit/${outcome.commit}`,
                versions: outcome.versions,
                changes: outcome.changes
              },
              200
            )
          case 'unchanged':
            return c.json({ committed: false, changes: [] }, 200)
          case 'invalid':
            return c.json({ error: outcome.message }, 400)
          case 'conflict':
            return c.json(
              {
                error: 'Someone changed these tokens on main since you loaded the editor',
                conflicts: outcome.conflicts
              },
              409
            )
          case 'contract':
            return c.json(
              { error: 'The edited themes fail the theme contract', problems: outcome.problems },
              422
            )
          case 'moved':
            logger.info('theme editor: main moved mid-save, retrying', { attempt })
            continue
        }
      }
      return c.json({ error: 'main kept moving during the save — try again' }, 502)
    } catch (e) {
      logger.warn('theme editor: save failed', { error: String(e) })
      return c.json(
        {
          error:
            e instanceof GitHubError ? 'GitHub refused the save' : 'Could not reach GitHub to save'
        },
        502
      )
    }
  })

  return app
}
