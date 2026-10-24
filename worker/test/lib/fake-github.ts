/**
 * An in-memory GitHub repo, speaking the slice of the REST API the theme
 * editor reads (the branch ref and raw contents) and mgmt-api's commit verb,
 * which it saves through.
 *
 * Two users:
 *   - theme-editor-verify.ts, which drives every save outcome through it
 *   - the dev server, so a save from a LOCAL editor lands here and not on the
 *     real main. That matters: the dev stack's service key could be a real
 *     one, and mgmt-api would commit to production with it.
 *
 * `handle` answers only this repo's git/contents paths, plus mgmt-api's
 * `POST /api/repo/commit` (which the worker saves through), and returns null
 * for everything else, so the caller passes other traffic through.
 */

export type Files = Map<string, string>

export interface FakeCommit {
  files: Files
  parent: string | null
  message: string
}

export class FakeGitHub {
  commits = new Map<string, FakeCommit>()
  main = ''
  calls: string[] = []
  /** Refuse the next N saves with 409, as mgmt-api does when main moved. */
  refuseNextMoves = 0
  /** Runs between our read of main and our ref update — a concurrent push. */
  beforeMove: (() => void) | null = null
  failHeadRead = false
  private seq = 0

  constructor(
    readonly repo: string,
    seed: Files
  ) {
    this.reset(seed)
  }

  private sha() {
    return (++this.seq).toString(16).padStart(40, '0')
  }

  reset(seed: Files) {
    this.commits = new Map()
    this.main = this.sha()
    this.commits.set(this.main, { files: new Map(seed), parent: null, message: 'seed' })
    this.calls = []
    this.refuseNextMoves = 0
    this.beforeMove = null
    this.failHeadRead = false
  }

  /** Commit directly to main, as another person or agent would. */
  pushOther(edit: (f: Files) => void, message = 'someone else') {
    const files = new Map(this.head().files)
    edit(files)
    const next = this.sha()
    this.commits.set(next, { files, parent: this.main, message })
    this.main = next
    return next
  }

  head(): FakeCommit {
    return this.commit(this.main)
  }

  commit(sha: string): FakeCommit {
    const c = this.commits.get(sha)
    if (!c) throw new Error(`fake GitHub has no commit ${sha}`)
    return c
  }

  handle(input: string, init?: RequestInit): Response | null {
    const url = new URL(input)
    if (url.host === 'hadoku.me' && url.pathname === '/mgmt/api/repo/commit') {
      return this.mgmtCommit(init)
    }
    const prefix = `/repos/${this.repo}`
    if (url.host !== 'api.github.com' || !url.pathname.startsWith(`${prefix}/`)) return null
    const path = url.pathname.slice(prefix.length)
    if (!/^\/(git|contents)\//.test(path)) return null

    const method = init?.method ?? 'GET'
    this.calls.push(`${method} ${path}`)
    const reply = (status: number, payload: unknown) =>
      new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })

    if (method === 'GET' && path === '/git/ref/heads/main') {
      if (this.failHeadRead) return reply(500, { message: 'boom' })
      return reply(200, { object: { sha: this.main } })
    }
    if (method === 'GET' && path.startsWith('/contents/')) {
      const file = decodeURIComponent(path.slice('/contents/'.length))
      const ref = url.searchParams.get('ref') ?? this.main
      const content = this.commits.get(ref)?.files.get(file)
      return content === undefined ? reply(404, { message: 'Not Found' }) : reply(200, content)
    }
    return reply(404, { message: `fake GitHub has no ${method} ${path}` })
  }

  /**
   * Fast-forward main to `sha`, exactly like mgmt-api's `force: false`: false
   * when main has moved past its parent, or when a test asked for a refusal.
   */
  private moveMain(sha: string): boolean {
    if (this.beforeMove) {
      const run = this.beforeMove
      this.beforeMove = null
      run()
    }
    if (this.refuseNextMoves > 0) {
      this.refuseNextMoves--
      return false
    }
    if (this.commits.get(sha)?.parent !== this.main) return false
    this.main = sha
    return true
  }

  /**
   * mgmt-api's commit verb against this repo: the tree, commit and
   * fast-forward it makes with its own token, recorded in `calls` as GitHub
   * would see them, and its answers — 401 with no key, 409 when main moved
   * past `base`, 200 `{ commit }` otherwise.
   */
  private mgmtCommit(init?: RequestInit): Response {
    const reply = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    if (!new Headers(init?.headers).get('X-User-Key')) {
      return reply(401, { success: false, error: 'X-User-Key required' })
    }
    const { base, message, files } = JSON.parse(String(init?.body)) as {
      base: string
      message: string
      files: Record<string, string>
    }
    this.calls.push(`GET /git/commits/${base}`)
    const parent = this.commits.get(base)
    if (!parent) return reply(400, { success: false, error: `no commit ${base}` })
    this.calls.push('POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main')
    const next = new Map(parent.files)
    for (const [path, content] of Object.entries(files)) next.set(path, content)
    const sha = this.sha()
    this.commits.set(sha, { files: next, parent: base, message })
    if (!this.moveMain(sha)) {
      return reply(409, { success: false, error: `main has moved past ${base}` })
    }
    return reply(200, { success: true, commit: sha })
  }
}
