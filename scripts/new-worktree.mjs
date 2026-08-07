#!/usr/bin/env node
/**
 * Create a worktree AND bootstrap it, because an un-bootstrapped worktree is a
 * silently broken one.
 *
 * `git worktree add` alone gives you a checkout where the pre-commit hook does
 * NOT run. `core.hooksPath` is `.husky/_`, which husky generates during install
 * and self-ignores (`.husky/_/.gitignore` is `*`), so it is never checked out —
 * only `.husky/pre-commit` and `.husky/README.md` are tracked. git finds no
 * hook directory, runs nothing, and says nothing. Every gate is skipped and
 * scripts/version-bump.mjs never fires, so the push lands unversioned and
 * publish.yml's backstop writes the follow-up commit on main that the hook
 * exists to prevent.
 *
 * `pnpm install` fixes both halves of that: it runs husky's `prepare`, which
 * regenerates `.husky/_`, and it populates node_modules, without which the
 * hook's gates (typecheck, lint-staged, lint:css) die on a missing binary even
 * once the hook does fire. Symlinking or resolving up to the main checkout's
 * node_modules is not enough — that produces no `.husky/_`.
 *
 *   node scripts/new-worktree.mjs <name>              # branch <name>, dir .claude/worktrees/<name>
 *   node scripts/new-worktree.mjs <name> --branch x   # explicit branch name
 *   node scripts/new-worktree.mjs <name> --no-install # skip bootstrap (hook will be inert)
 *
 * Bootstrap also BUILDS the workspace packages. dist/ is gitignored, so a fresh
 * worktree has none, and the pre-commit typecheck resolves @wolffm/themes and
 * @wolffm/task-ui-components through their built entrypoints — leaving it out
 * means the very first commit from a new worktree fails the gate on a missing
 * export that is actually present in source.
 *
 * Run from the repo root of any existing checkout.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const valueOf = name => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const name = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--branch')
if (!name) {
  console.error('Usage: node scripts/new-worktree.mjs <name> [--branch <branch>] [--no-install]')
  process.exit(1)
}

const branch = valueOf('--branch') ?? name
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', encoding: 'utf8', ...opts })
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

// Resolve against the MAIN checkout, not wherever this is invoked from: worktrees
// nest under the main working tree, and creating one inside another worktree
// would bury it a level deeper each time.
const gitCommonDir = resolve(
  capture('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'])
)
const mainRoot = resolve(gitCommonDir, '..')
const dir = join(mainRoot, '.claude', 'worktrees', name)

if (existsSync(dir)) {
  console.error(`✗ ${dir} already exists`)
  process.exit(1)
}

console.log(`→ creating worktree ${dir} on branch ${branch}`)
// Reuse the branch if it already exists; otherwise cut a new one. Git refuses to
// check the same branch out twice, which is the safety property the whole
// worktree scheme rests on — let that error surface rather than working around it.
const branchExists = (() => {
  try {
    // stderr piped, not inherited: a missing ref is the expected answer here, and
    // git's "fatal: Needed a single revision" on the way to it reads like a failure.
    execFileSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return true
  } catch {
    return false
  }
})()
run('git', [
  'worktree',
  'add',
  ...(branchExists ? [] : ['-b', branch]),
  dir,
  ...(branchExists ? [branch] : [])
])

if (flag('--no-install')) {
  console.log('⚠ skipped install — the pre-commit hook will NOT run in this worktree')
  console.log(`  bootstrap later with:  cd ${dir} && pnpm install`)
  process.exit(0)
}

console.log('→ pnpm install (regenerates .husky/_ and populates node_modules)')
run('pnpm', ['install'], { cwd: dir })

// Prove the hook is actually live rather than assuming the install did it —
// this is the exact thing that was silently missing.
const hooksPath = capture('git', ['config', '--get', 'core.hooksPath']) || '.git/hooks'
const hookFile = join(dir, hooksPath, 'pre-commit')
if (existsSync(hookFile)) {
  console.log(`✓ pre-commit hook live at ${hooksPath}/pre-commit`)
} else {
  console.error(`✗ no hook at ${hookFile} — commits from here will skip every gate`)
  console.error('  check that husky ran: pnpm install output should mention "husky"')
  process.exit(1)
}

// Build the workspace packages, or the hook you just verified fails on its
// first use. dist/ is gitignored, so a fresh worktree has none — and the app
// resolves @wolffm/themes and @wolffm/task-ui-components through their BUILT
// entrypoints. The pre-commit typecheck therefore dies on
// "Module '@wolffm/themes' has no exported member ..." for anything added
// since the last published build, which reads as a broken commit rather than
// an unbuilt worktree. Bootstrapping a worktree that cannot pass its own gate
// is not bootstrapping it.
console.log('→ pnpm run build:packages (dist/ is gitignored; the hook typechecks against it)')
run('pnpm', ['run', 'build:packages'], { cwd: dir })

console.log(`\n✓ ready:  cd ${dir}`)
