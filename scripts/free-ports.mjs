#!/usr/bin/env node
/**
 * Print N distinct free TCP ports as a JSON array: `node scripts/free-ports.mjs 4`.
 *
 * The kernel picks each one (listen on :0), and every socket stays open until
 * all N are chosen, so the N are distinct. They are bound on the unspecified
 * address (dual-stack), so a port is only handed out when it is free on IPv4
 * AND IPv6 — vite listens on `localhost`, which may resolve to ::1.
 *
 * Why: the e2e stack used fixed ports (3001/3002/3003 and vite's 5199), so a
 * second job on the same host, or a developer's running `pnpm run dev:api`,
 * failed the run with EADDRINUSE (hadoku-task#114). playwright.config.ts calls
 * this for every port the environment does not pin.
 *
 * Synchronous for its caller: a Playwright config cannot await at load, so it
 * runs this with execFileSync.
 */
import { createServer } from 'node:net'

const n = Number(process.argv[2] ?? 1)
if (!Number.isInteger(n) || n < 1) {
  console.error(`free-ports: expected a positive count, got ${process.argv[2]}`)
  process.exit(2)
}

const servers = []
const ports = []
for (let i = 0; i < n; i++) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, resolve)
  })
  servers.push(server)
  ports.push(server.address().port)
}
await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
process.stdout.write(JSON.stringify(ports))
