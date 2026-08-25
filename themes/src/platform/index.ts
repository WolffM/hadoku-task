/**
 * Platform context — the one device-detection module for the hadoku ecosystem.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Six independent implementations across the fleet, using four different
 * thresholds (768, 820, 900, 1000) to answer three different questions.
 * `hadoku-task` asked about viewport WIDTH and `hadoku-dataplatform` about
 * POINTER TYPE — the same "am I on mobile?" question, answered two ways, and
 * neither app could tell you which one it meant from the name `useIsMobile`.
 * Those two are what this replaces.
 *
 * (The other three turned out on inspection to be component CAPACITY
 * thresholds, each already agreeing with its own stylesheet — pygmalion's 900
 * is "room for three panes", merchant's 1000 is "room for a second column".
 * Those are legitimately local and are NOT candidates for this module. An
 * earlier draft catalogued them as drift; that was a bad read.)
 *
 * The failure this DOES fix is the same one as the eight hand-copied
 * `useTheme.ts` files this package already absorbed — see the header of
 * ../useTheme.tsx — so it gets the same fix: one definition here, a seed passed
 * down by the host on mount, and a shared hook that owns the live value.
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
 * A stylesheet writing `[data-narrow] .lane { … }` cannot drift from the hook,
 * because there is only one query left to keep in step. `hadoku-dataplatform`
 * already did exactly this for itself with an `is-mobile` class it set from the
 * same value it branched on — this is that idea with one fleet-wide name.
 * Present/absent rather than `="true"`/`="false"` so the plain attribute
 * selector works.
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
