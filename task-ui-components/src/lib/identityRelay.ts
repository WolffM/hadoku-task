/**
 * A rename or avatar change made in ONE tab reaches every other hadoku tab of
 * that browser, whatever app each is.
 *
 * The gear announces a change with a window event (NAME_EVENT, AVATAR_EVENT)
 * on the page where it was made. Every hadoku app is served from the one
 * hadoku.me origin, so a `BroadcastChannel` reaches all of the browser's tabs.
 * This relay posts each of those events there, and re-dispatches what other
 * tabs post as the same window event, so every listener a page already has (a
 * room's identity sync, an app's avatar watcher) acts on it unchanged. A room
 * server then re-reads the account and pushes it to every room the person is in.
 *
 * ConnectedSettings starts it at mount, so a change made on ANY page with the
 * gear is posted, room or no room. A page may also start it itself (a room
 * with no gear of its own); that is the same relay, not a second one.
 *
 * ONE RELAY PER WINDOW, even across duplicate bundled copies of this package:
 * the running relay is kept on the target under a `Symbol.for` key and
 * reference-counted, and an event a relay dispatched is marked under another,
 * so no copy posts it again. Two tabs cannot echo one change back and forth.
 * No `BroadcastChannel` (jsdom, an old webview): nothing to do, and the page's
 * own events still work.
 *
 * Its own module, free of React, so it can be imported anywhere.
 */
import { AVATAR_EVENT } from './avatarEvent'
import { NAME_EVENT } from './nameEvent'

export const IDENTITY_CHANNEL = 'hadoku:identity'

type IdentityEvent = typeof NAME_EVENT | typeof AVATAR_EVENT

export interface IdentityRelayMessage {
  event: IdentityEvent
  detail: unknown
}

export interface IdentityChannel {
  postMessage(m: IdentityRelayMessage): void
  addEventListener(type: 'message', fn: (e: { data: IdentityRelayMessage }) => void): void
  close(): void
}

const RUNNING = Symbol.for('hadoku:identity-relay')
const RELAYED = Symbol.for('hadoku:identity-relayed')

interface Running {
  count: number
  stop: () => void
}

type Host = EventTarget & { [RUNNING]?: Running }

function defaultChannel(): IdentityChannel | null {
  return typeof globalThis.BroadcastChannel === 'undefined'
    ? null
    : (new globalThis.BroadcastChannel(IDENTITY_CHANNEL) as unknown as IdentityChannel)
}

function isIdentityEvent(name: unknown): name is IdentityEvent {
  return name === NAME_EVENT || name === AVATAR_EVENT
}

function start(target: EventTarget, channel: IdentityChannel): () => void {
  const post = (e: Event) => {
    if ((e as Event & { [RELAYED]?: true })[RELAYED]) return
    const detail = (e as Event & { detail?: unknown }).detail
    if (!detail || typeof detail !== 'object' || !isIdentityEvent(e.type)) return
    channel.postMessage({ event: e.type, detail })
  }
  target.addEventListener(NAME_EVENT, post)
  target.addEventListener(AVATAR_EVENT, post)
  channel.addEventListener('message', m => {
    const { event, detail } = m.data ?? ({} as Partial<IdentityRelayMessage>)
    if (!isIdentityEvent(event) || !detail || typeof detail !== 'object') return
    const e = new globalThis.CustomEvent(event, { detail })
    Object.defineProperty(e, RELAYED, { value: true })
    target.dispatchEvent(e)
  })
  return () => {
    target.removeEventListener(NAME_EVENT, post)
    target.removeEventListener(AVATAR_EVENT, post)
    channel.close()
  }
}

/** Start relaying (or join the relay already running on `target`); returns the stop. */
export function relayIdentityChanges(
  target: EventTarget | undefined = typeof window === 'undefined' ? undefined : window,
  makeChannel: () => IdentityChannel | null = defaultChannel
): () => void {
  if (!target) return () => {}
  const host = target as Host
  let running = host[RUNNING]
  if (!running) {
    const channel = makeChannel()
    if (!channel) return () => {}
    running = { count: 0, stop: start(target, channel) }
    host[RUNNING] = running
  }
  running.count++
  const mine = running
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (--mine.count > 0) return
    mine.stop()
    if (host[RUNNING] === mine) delete host[RUNNING]
  }
}
