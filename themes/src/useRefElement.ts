/**
 * The element a caller's `RefObject` points at, as state — so an effect can
 * depend on it and re-run when it attaches.
 *
 * `useTheme` and `usePlatform` stamp attributes onto an app's container, and
 * every app hands them a plain `useRef()` object. Assigning `ref.current` does
 * not re-render anything, so an effect keyed on the ref object alone runs once
 * and never learns that the div attached later. Task's container mounts only
 * after its loading skeleton gives way, which left it without `data-theme`
 * whenever the skeleton outlived the hook's first passes (#102).
 *
 * React attaches an object ref by writing `ref.current = el` during commit, so
 * this swaps `current` for an accessor that turns that write into a state
 * update. Callers keep passing what they pass today, which is the point: 16
 * apps hand over a `RefObject`, and none of them has to change. The plain data
 * property comes back on cleanup.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

// useLayoutEffect, so the element is read before paint; useEffect on the server,
// where neither runs but React 18 warns about the layout variant.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useRefElement<T extends Element>(ref?: RefObject<T | null>): T | null {
  const [element, setElement] = useState<T | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (!ref) {
      setElement(null)
      return
    }
    // Refs attach child-first, before this parent's layout effect, so a
    // container rendered in the same commit is already here.
    let current = ref.current
    Object.defineProperty(ref, 'current', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (next: T | null) => {
        current = next
        setElement(next)
      }
    })
    setElement(current)
    return () => {
      Object.defineProperty(ref, 'current', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: current
      })
    }
  }, [ref])

  return element
}
