/**
 * Server options shared by every dev-stack HTTP server (:3001, :3002, :3003).
 *
 * NO idle keep-alive close. Node closes an idle keep-alive socket after
 * keepAliveTimeout (5s) plus keepAliveTimeoutBuffer (1s), but Playwright's
 * request client keeps one pooled agent per worker for the whole run and never
 * expires a socket itself — so the same connection carries request after request
 * across unrelated tests, with idle gaps of any length between them.
 *
 * When this server's event loop is busy at the 6s mark (a loaded machine, a
 * synchronous sqlite query), a request can land on the socket just as the timer
 * is due. Node runs expired timers BEFORE it polls for socket data, so the
 * timeout wins, the socket is destroyed with that request unread, the kernel
 * answers RST, and the spec fails with `apiRequestContext.get: read ECONNRESET`.
 *
 * Measured 2026-10-21: with the loop held from 5.9s to 6.3s, a request sent at
 * 5.95s reset 6/6 times. With keepAliveTimeout 0 (which disables the idle close
 * outright, buffer included): 0/6. Clients close their own sockets — a Playwright
 * worker or browser on exit — which is the only owner a local dev stack needs.
 */
import type { ServerOptions } from 'node:http'

export const NO_IDLE_CLOSE: ServerOptions = { keepAliveTimeout: 0 }
