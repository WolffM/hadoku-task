#!/usr/bin/env node
/**
 * Reclaim the E2E port before Playwright's vite starts.
 *
 * Port 5199 is registered to this repo in hadoku-registry (`ports.yaml`,
 * service `hadoku-task-e2e`, since 2026-03-17). Anything else bound to it is
 * trespassing, and `reuseExistingServer` cannot tell: it only checks that
 * SOMETHING answers, so a foreign server gets silently adopted and the whole
 * suite runs against someone else's bytes. That is not hypothetical — on
 * 2026-08-17 a TenHands `http-server dist-demo -p 5199` sat here for hours,
 * answering 200 with a directory index.
 *
 * So: kill the squatter, keep our own.
 *
 *   ours     -> a vite whose cwd is this repo (or a worktree of it). Left
 *               running, because that is the reuse fast path worth having.
 *   foreign  -> anything else. SIGTERM, then SIGKILL if it does not go.
 *
 * Ownership is decided by /proc/<pid>/cwd, not by process name — a name match
 * would kill a sibling repo's vite, which is the same mistake in the other
 * direction.
 *
 * Linux-only by design (this is where the suite runs). Anywhere else it
 * no-ops with a warning rather than guessing.
 */

import { execFileSync } from 'node:child_process'
import { readlinkSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.E2E_PORT ?? 5199)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `ss -ltnp` is the only listener source that also gives us the pid. */
function listenerPids(port) {
  let out
  try {
    out = execFileSync('ss', ['-ltnp'], { encoding: 'utf-8' })
  } catch {
    console.warn(`[free-e2e-port] ss unavailable — cannot check port ${port}`)
    return []
  }
  const pids = new Set()
  for (const line of out.split('\n')) {
    // Local Address:Port is the 4th column; match the port at the very end so
    // 5199 does not match 15199 or a peer address that happens to contain it.
    const addr = line.trim().split(/\s+/)[3]
    if (!addr || !new RegExp(`[:.]${port}$`).test(addr)) continue
    for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]))
  }
  return [...pids]
}

function describe(pid) {
  let cwd = null
  let cmd = ''
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    /* process gone, or not ours to inspect — treated as unknown below */
  }
  try {
    cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim()
  } catch {
    /* same */
  }
  return { cwd, cmd }
}

/**
 * Ours = a vite serving THIS checkout. Worktrees live under
 * <repo>/.claude/worktrees/<name>, so a prefix test on the main checkout would
 * call a sibling worktree's vite "ours" and reuse the wrong source — the exact
 * bug the E2E_PORT note in playwright.config.ts describes. Require an exact
 * cwd match instead.
 */
function isOurs({ cwd, cmd }) {
  return cwd === REPO_ROOT && /vite/.test(cmd)
}

function kill(pid, signal) {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

const pids = listenerPids(PORT)
if (pids.length === 0) {
  process.exit(0)
}

let killedAny = false
for (const pid of pids) {
  const info = describe(pid)
  if (isOurs(info)) {
    console.log(`[free-e2e-port] :${PORT} held by our own vite (pid ${pid}) — reusing`)
    continue
  }
  console.warn(
    `[free-e2e-port] :${PORT} is registered to hadoku-task but held by pid ${pid}\n` +
      `                cwd: ${info.cwd ?? '(unreadable)'}\n` +
      `                cmd: ${info.cmd || '(unreadable)'}\n` +
      `                reclaiming it — see hadoku-registry/ports.yaml`
  )
  kill(pid, 'SIGTERM')
  killedAny = true
}

if (!killedAny) process.exit(0)

// Give SIGTERM a moment, then escalate. Busy-wait on a sync sleep: this runs as
// a one-shot preflight inside the webServer command, so there is no event loop
// worth yielding to and an async main would just add ceremony.
const deadline = Date.now() + 5000
while (Date.now() < deadline) {
  if (listenerPids(PORT).filter(p => !isOurs(describe(p))).length === 0) break
  execFileSync('sleep', ['0.2'])
}

for (const pid of listenerPids(PORT)) {
  const info = describe(pid)
  if (isOurs(info)) continue
  console.warn(`[free-e2e-port] pid ${pid} ignored SIGTERM — sending SIGKILL`)
  kill(pid, 'SIGKILL')
}

const stubborn = listenerPids(PORT).filter(p => !isOurs(describe(p)))
if (stubborn.length > 0) {
  console.error(
    `[free-e2e-port] could not free :${PORT} — still held by ${stubborn.join(', ')}.\n` +
      `                Run with E2E_PORT=<free port> to work around it.`
  )
  process.exit(1)
}

console.log(`[free-e2e-port] :${PORT} reclaimed`)
