/**
 * Platform context — the one device-detection module for the hadoku ecosystem.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Six independent implementations, using four different thresholds (768, 820,
 * 900, 1000), answering three different questions. Two of them disagreed with
 * their own CSS: `hadoku-pygmalion` branched on `innerWidth >= 900` while its
 * stylesheet carried `max-width:900px`, `899px` AND `820px` (so at exactly
 * 900px the JS said desktop and the CSS said mobile), and
 * `hadoku-dataplatform` used a pure pointer query in JS against twelve
 * `max-width:900px` rules in CSS (so a landscape tablet got touch-first
 * behaviour and desktop layout at the same time).
 *
 * Same failure as the eight hand-copied `useTheme.ts` files this package
 * already absorbed — see the header of ../useTheme.tsx — so it gets the same
 * fix: one definition here, a seed passed down by the host on mount, and a
 * shared hook that owns the live value.
 *
 * TWO FLAGS, NOT ONE
 * ------------------
 * `touchFirst` and `narrow` are different questions and a single boolean makes
 * one caller wrong: a phone in landscape is touch-first but not narrow, and a
 * narrow desktop window is narrow but not touch-first. There is deliberately no
 * `isMobile` convenience OR — it would become the default reach and put the
 * fleet back on one blessed threshold under a new name.
 *
 * This module is framework-free (no React import) so plain-TS consumers like
 * hadoku-merchant can use it. The React hook lives in ./usePlatform.
 */

export interface PlatformSeed {
  /**
   * Input is finger-first: `(pointer: coarse) and (hover: none)`.
   *
   * True on phones and tablets. False on desktops — INCLUDING touchscreen
   * laptops, whose primary pointer is still a mouse. Keys off the primary
   * INPUT rather than the user-agent string (UAs lie; iPadOS reports a desktop
   * UA) or viewport width (a narrow desktop window is not a phone).
   *
   * Use for: tap targets, hover affordances, gesture vs. drag, control overlays.
   */
  touchFirst: boolean

  /**
   * Viewport is narrow: `(max-width: 767px)`.
   *
   * Use for: column counts, stacking, lane caps, drawer-vs-pane.
   */
  narrow: boolean
}

/** The width below which `narrow` is true. 767px is the boundary; this is the
 *  Tailwind-style `md` breakpoint the fleet already uses most (hadoku_site
 *  alone carries 67 `max-width: 768px` rules). */
export const NARROW_BREAKPOINT = 768

export const TOUCH_FIRST_QUERY = '(pointer: coarse) and (hover: none)'
export const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT - 1}px)`

/** SSG prerender and jsdom-without-a-polyfill both land here. Never throws;
 *  all-false means "assume desktop", which is the safe default because every
 *  consumer's desktop branch is the unconstrained one. */
function unsupported(): boolean {
  return typeof window === 'undefined' || !window.matchMedia
}

/**
 * Read the platform straight from the media queries.
 *
 * Both flags come from `matchMedia`, deliberately: `hadoku-task`'s hook seeded
 * from `window.innerWidth < 768` and then listened on `(max-width: 767px)` —
 * two mechanisms for one boundary. They disagree under fractional zoom, and
 * `innerWidth` reads stale during iOS `orientationchange`, which is exactly the
 * rotation case the listener exists to catch.
 */
export function detectPlatform(): PlatformSeed {
  if (unsupported()) return { touchFirst: false, narrow: false }
  return {
    touchFirst: window.matchMedia(TOUCH_FIRST_QUERY).matches,
    narrow: window.matchMedia(NARROW_QUERY).matches
  }
}

export function isSamePlatform(a: PlatformSeed, b: PlatformSeed): boolean {
  return a.touchFirst === b.touchFirst && a.narrow === b.narrow
}

/**
 * Mirror the flags onto an element as `data-touch-first` / `data-narrow`, so
 * CSS keys off the IDENTICAL source the JS does.
 *
 * This is what makes the two JS/CSS disagreements described at the top of this
 * file structurally impossible to reintroduce: a stylesheet writing
 * `[data-narrow] .lane { … }` cannot drift from the hook, because there is only
 * one query left. Present/absent rather than `="true"`/`="false"` so the plain
 * attribute selector works.
 */
export function stampPlatform(el: Element | null | undefined, platform: PlatformSeed): void {
  if (!el) return
  for (const [attr, on] of [
    ['data-touch-first', platform.touchFirst],
    ['data-narrow', platform.narrow]
  ] as const) {
    if (on) el.setAttribute(attr, '')
    else el.removeAttribute(attr)
  }
}

export interface PlatformStore {
  get(): PlatformSeed
  /** Fires on every real change. Returns the unsubscribe. */
  subscribe(listener: (platform: PlatformSeed) => void): () => void
}

/**
 * Framework-free equivalent of `usePlatform`, for consumers with no React
 * (hadoku-merchant is plain TS). Attaches its listeners on the first
 * `subscribe` and detaches when the last one unsubscribes, so an unused store
 * costs nothing.
 */
export function createPlatform(): PlatformStore {
  let current = detectPlatform()
  const listeners = new Set<(platform: PlatformSeed) => void>()
  let queries: MediaQueryList[] = []

  const sync = (): void => {
    const next = detectPlatform()
    if (isSamePlatform(current, next)) return
    current = next
    for (const listener of listeners) listener(current)
  }

  const attach = (): void => {
    if (unsupported()) return
    queries = [window.matchMedia(TOUCH_FIRST_QUERY), window.matchMedia(NARROW_QUERY)]
    for (const mq of queries) {
      // Safari < 14 only exposes the deprecated addListener signature.
      if (mq.addEventListener) mq.addEventListener('change', sync)
      else mq.addListener(sync)
    }
    // Resync: the queries may have changed between construction and the first
    // subscribe, and that change fired before anything was listening.
    sync()
  }

  const detach = (): void => {
    for (const mq of queries) {
      if (mq.removeEventListener) mq.removeEventListener('change', sync)
      else mq.removeListener(sync)
    }
    queries = []
  }

  return {
    get: () => current,
    subscribe(listener) {
      // Add BEFORE attaching: `attach` ends with a repair `sync()`, and a
      // listener registered after it would miss the very change that sync
      // exists to surface.
      listeners.add(listener)
      if (listeners.size === 1) attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) detach()
      }
    }
  }
}
