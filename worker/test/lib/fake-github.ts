/**
 * An in-memory GitHub repo, speaking the slice of the REST API the theme
 * editor uses: the branch ref, raw contents, commits, trees, and a
 * fast-forward-only ref update.
 *
 * Two users:
 *   - theme-editor-verify.ts, which drives every save outcome through it
 *   - the dev server, so a save from a LOCAL editor lands here and not on the
 *     real main. That matters: the dev stack binds the real HADOKU_SITE_TOKEN
 *     (it validates board repos with it), so without this a local save would
 *     commit to production.
 *
 * `handle` answers only this repo's git/contents paths and returns null for
 * everything else, so the caller passes other GitHub traffic through.
 */

export type Files = Map<string, string>

export interface FakeCommit {
  files: Files
  parent: string | null
  message: string
}

export class FakeGitHub {
  commits = new Map<string, FakeCommit>()
  trees = new Map<string, Files>()
  main = ''
  calls: string[] = []
  /** Answer the next N ref updates with 422, as GitHub does when main moved. */
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
    this.trees = new Map()
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
    const prefix = `/repos/${this.repo}`
    if (url.host !== 'api.github.com' || !url.pathname.startsWith(`${prefix}/`)) return null
    const path = url.pathname.slice(prefix.length)
    if (!/^\/(git|contents)\//.test(path)) return null

    const method = init?.method ?? 'GET'
    this.calls.push(`${method} ${path}`)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
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
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const c = this.commits.get(path.slice('/git/commits/'.length))
      if (!c) return reply(404, { message: 'Not Found' })
      const tree = this.sha()
      this.trees.set(tree, new Map(c.files))
      return reply(200, { tree: { sha: tree } })
    }
    if (method === 'POST' && path === '/git/trees') {
      const base = this.trees.get(body.base_tree)
      if (!base) return reply(422, { message: 'bad base_tree' })
      const files = new Map(base)
      for (const entry of body.tree) files.set(entry.path, entry.content)
      const tree = this.sha()
      this.trees.set(tree, files)
      return reply(201, { sha: tree })
    }
    if (method === 'POST' && path === '/git/commits') {
      const files = this.trees.get(body.tree)
      if (!files) return reply(422, { message: 'bad tree' })
      const c = this.sha()
      this.commits.set(c, { files, parent: body.parents[0], message: body.message })
      return reply(201, { sha: c })
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (this.beforeMove) {
        const run = this.beforeMove
        this.beforeMove = null
        run()
      }
      if (this.refuseNextMoves > 0) {
        this.refuseNextMoves--
        return reply(422, { message: 'Update is not a fast forward' })
      }
      // Fast-forward only, exactly like force:false.
      if (this.commits.get(body.sha)?.parent !== this.main) {
        return reply(422, { message: 'Update is not a fast forward' })
      }
      this.main = body.sha
      return reply(200, { object: { sha: this.main } })
    }
    return reply(404, { message: `fake GitHub has no ${method} ${path}` })
  }
}
