/**
 * Preloaded into every verification harness (run-worker-verify.mjs) so none of
 * them can reach the network.
 *
 * A harness stubs the URLs it cares about and passes everything else to the
 * fetch it captured at load time. That fallback reached production:
 * actionable-verify drives lane writes on an automation board, and the worker's
 * wake (POST https://hadoku.me/mgmt/api/repo/dispatch) went out for real on
 * every run, from CI and from every dev box. 172 calls in nine days reached the
 * edge, each one a 404 that looked like task-api's dispatch failing in
 * production.
 *
 * This replaces fetch BEFORE the harness loads, so the fetch a harness captures
 * is this one. Loopback still works. Anything else is refused and recorded, and
 * the process exits non-zero: the worker swallows a failed fetch (the wake is
 * best-effort), so throwing alone would leave the run green.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const passthrough = globalThis.fetch
const blocked = []

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (LOOPBACK.has(url.hostname)) return passthrough(input, init)
  blocked.push(`${init?.method ?? (input instanceof Request ? input.method : 'GET')} ${url.href}`)
  return Promise.reject(new Error(`verify harness: network access refused (${url.href}) — stub it`))
}

process.on('exit', () => {
  if (blocked.length === 0) return
  console.error(`\n✗ ${blocked.length} un-stubbed network request(s):`)
  for (const b of blocked) console.error(`    ${b}`)
  process.exitCode = 1
})
