#!/usr/bin/env node
/**
 * Bump the version of every publishable package whose files are STAGED, and
 * re-stage the package.json so the bump rides along in the same commit.
 *
 * Run by .husky/pre-commit. The point is that a push to main arrives already
 * carrying a publishable version, so publish.yml never has to write a follow-up
 * "auto-bump" commit on main.
 *
 * REQUIRES A BOOTSTRAPPED WORKTREE. The hook that runs this is installed by
 * husky at `.husky/_`, which is generated during `pnpm install` and self-ignored,
 * so a plain `git worktree add` produces a checkout where no hook runs at all —
 * this script never fires and CI's backstop does every bump. Since work here
 * happens in worktrees, that is the normal case, not an edge one. Create them
 * with `node scripts/new-worktree.mjs <name>`, which installs and then verifies
 * the hook is live.
 *
 * publish.yml keeps its own registry-aware bump as a BACKSTOP, for the cases
 * this can't cover: a bot commit, a `--no-verify`, or a version that turns out
 * to be taken on the registry (this script can't check that offline). The two
 * must agree on the rules below — the mapping, the dependency fan-out, and the
 * rollover — or CI will keep stepping in. See "Detect changed packages" and
 * "Auto-bump versions" in .github/workflows/publish.yml.
 *
 *   node scripts/version-bump.mjs                        # bump + re-stage
 *   node scripts/version-bump.mjs --dry-run              # print what it would do
 *   node scripts/version-bump.mjs --dry-run --files a b  # classify these paths
 *
 * The last form is how the path mapping gets checked against publish.yml's
 * without dirtying a tree.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/**
 * Which staged paths belong to which package. Mirrors publish.yml's
 * "Detect changed packages" step verbatim — `task` is everything at the root
 * that ships in the bundle, explicitly EXCLUDING the two subpackage dirs.
 *
 * Deliberately not matched: docs/, plugins/, e2e/, scripts/, .github/, *.md —
 * none of them change a published artifact, so they must not burn a version.
 */
/**
 * Under `worker/` but NOT part of any published artifact, so they must not burn
 * a version. `files` is ["dist", ...]: nothing under worker/ ships directly, and
 * only worker/src reaches the tarball at all (compiled into dist/worker). Test
 * harnesses and migration SQL cannot change what is published — same reasoning
 * that already excludes docs/, e2e/, scripts/ and plugins/, they just happen to
 * sit under a prefix that otherwise means "task".
 *
 * Checked before the `task` match below, and mirrored by the second `grep -Ev`
 * in publish.yml's "Detect changed packages".
 */
const DEV_ONLY = /^worker\/(test|migrations)\//

const PACKAGES = [
  { key: 'ui', path: 'task-ui-components', name: '@wolffm/task-ui-components' },
  { key: 'themes', path: 'themes', name: '@wolffm/themes' },
  { key: 'task', path: '.', name: '@wolffm/task' }
]

export function classify(files) {
  const changed = new Set()
  for (const file of files) {
    if (file.startsWith('task-ui-components/')) changed.add('ui')
    else if (file.startsWith('themes/')) changed.add('themes')
    else if (DEV_ONLY.test(file)) continue
    else if (/^(src\/|worker\/|package\.json$|vite\.config\.|tsconfig\.|tsup\.)/.test(file)) {
      changed.add('task')
    }
  }
  // Dependency chain: `task` bundles themes + task-ui-components, and themes
  // depends on task-ui-components. A dependency change must republish its
  // dependents so their bundled copy AND pinned version stay in sync.
  if (changed.has('ui')) changed.add('themes').add('task')
  if (changed.has('themes')) changed.add('task')
  return changed
}

/** Next patch, rolling over to the next minor at .20. Mirrors publish.yml's next_version(). */
export function nextVersion(version) {
  const [maj, min, pat] = version.split('.').map(Number)
  return pat === 20 ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
}

const pkgFile = path => (path === '.' ? 'package.json' : `${path}/package.json`)

/** The version this package had at HEAD, or null when it's a fresh file/repo. */
function versionAtHead(path) {
  try {
    return JSON.parse(git('show', `HEAD:${pkgFile(path)}`)).version
  } catch {
    return null
  }
}

function main() {
  const filesFlag = process.argv.indexOf('--files')
  const staged =
    filesFlag === -1
      ? git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
      : process.argv.slice(filesFlag + 1)
  const changed = classify(staged)

  if (changed.size === 0) {
    console.log('📦 No publishable package changed — no version bump.')
    process.exit(0)
  }

  const bumped = []
  for (const pkg of PACKAGES) {
    if (!changed.has(pkg.key)) continue
    const file = pkgFile(pkg.path)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const head = versionAtHead(pkg.path)

    // Already moved relative to HEAD — a hand-written bump, or a retry after a
    // commit that the gates aborted (the tree kept the bump, HEAD never got it).
    //
    // This does NOT cover `--amend`, despite an earlier claim that it did. During
    // an amend HEAD is still the commit being amended, whose package.json already
    // carries the bump, so it equals the working tree and this never fires: an
    // amend that stages a publishable path bumps again (3.4.155 -> 3.4.156).
    // A bare `--amend --no-edit` is safe only incidentally — nothing is staged, so
    // no package matches and we exit before reaching here.
    // There is no fix at this point in the lifecycle —
    // hooks run pre-commit → prepare-commit-msg → commit-msg, and only
    // prepare-commit-msg is told it's an amend (via its third argument), by which
    // time the index for the commit is already fixed and a bump can't be staged.
    // Left as-is deliberately: a skipped patch number costs nothing, and
    // publish.yml's registry-aware backstop rolls forward to a free version.
    if (head && head !== json.version) {
      console.log(`📦 ${pkg.name}: already ${head} → ${json.version}, leaving it`)
      continue
    }

    const next = nextVersion(json.version)
    if (dryRun) {
      console.log(`📦 ${pkg.name}: would bump ${json.version} → ${next}`)
      continue
    }
    json.version = next
    // Same shape publish.yml writes, and what prettier produces for package.json.
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
    git('add', file)
    bumped.push(`${pkg.name} ${next}`)
    console.log(`📦 ${pkg.name}: ${next}`)
  }

  // The lockfile records workspace deps as `link:` and the one registry dep by a
  // caret range, so a version bump never moves it — nothing to regenerate here.
  if (bumped.length) console.log(`✅ Version bump staged: ${bumped.join(', ')}`)
}

// Importable so the rules that must match publish.yml (classify, nextVersion)
// can be checked directly; only running it as a CLI touches the tree.
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
