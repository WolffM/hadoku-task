/**
 * usePlatform — the React half of the platform contract. See ./index.ts for why
 * this exists and what it replaces.
 *
 * Shape deliberately mirrors `useTheme`: a seed passed down by the host on
 * mount, and a hook that owns every value after that.
 */
import { useState, useEffect, useRef, type RefObject } from 'react'
import {
  detectPlatform,
  isSamePlatform,
  stampPlatform,
  TOUCH_FIRST_QUERY,
  NARROW_QUERY,
  type PlatformSeed
} from './index'

export interface UsePlatformOptions {
  /**
   * Platform seeded by a parent shell, from its mount props.
   *
   * A SEED, not an override — unlike `UseThemeOptions.propsTheme`, which wins
   * over everything. The host and the app are in the same document looking at
   * the same viewport, so the host has no privileged knowledge here; the seed
   * only saves the first render from a flash of the wrong layout. The media
   * queries take over from the first effect onward, which is what keeps a
   * rotation from being lost.
   */
  propsPlatform?: PlatformSeed

  /**
   * Mirror `data-touch-first` / `data-narrow` onto a container element, so this
   * app's CSS can key off the same source as its JS. Same escape hatch
   * `useTheme` gives micro-frontend mounts via `containerRef`.
   */
  containerRef?: RefObject<HTMLElement | null>
}

export function usePlatform(options: UsePlatformOptions = {}): PlatformSeed {
  const { propsPlatform, containerRef } = options

  // The seed governs the first render only. When there is no seed — a
  // standalone mount, a Capacitor shell, an older host that predates the prop —
  // this detects for itself, so there is no "missing prop" branch for an app
  // author to get wrong.
  const [platform, setPlatform] = useState<PlatformSeed>(() => propsPlatform ?? detectPlatform())

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const queries = [window.matchMedia(TOUCH_FIRST_QUERY), window.matchMedia(NARROW_QUERY)]

    const sync = (): void => {
      const next = detectPlatform()
      // Returning the previous object bails out of the re-render, so the
      // resync below is free when the seed was already right.
      setPlatform(prev => (isSamePlatform(prev, next) ? prev : next))
    }

    for (const mq of queries) {
      // Safari < 14 only exposes the deprecated addListener signature.
      if (mq.addEventListener) mq.addEventListener('change', sync)
      else mq.addListener(sync)
    }

    // Repair a stale seed. The host computes it at DOMContentLoaded and the
    // bundle is then imported dynamically, so a rotation inside that window
    // fires its `change` event before anything is listening — without this the
    // app would stay on the wrong value until the NEXT change.
    sync()

    return () => {
      for (const mq of queries) {
        if (mq.removeEventListener) mq.removeEventListener('change', sync)
        else mq.removeListener(sync)
      }
    }
  }, [])

  // Stamp on every change. No cleanup here on purpose — clearing and
  // re-setting on every flip would churn the attribute for no reason.
  const stampedRef = useRef<Element | null>(null)
  useEffect(() => {
    stampedRef.current = containerRef?.current ?? null
    stampPlatform(stampedRef.current, platform)
  }, [containerRef, platform])

  // Clear on unmount only. The host's mount root outlives the app it holds —
  // mf-loader re-mounts watchparty into the same element — so leaving the
  // attributes behind would hand the next tenant a stale value.
  useEffect(
    () => () => {
      stampPlatform(stampedRef.current, { touchFirst: false, narrow: false })
    },
    []
  )

  return platform
}
