/**
 * useClickOutside hook
 * Generic hook for detecting clicks outside of a ref element
 * Useful for closing dropdowns, modals, context menus, etc.
 */

import { useEffect, type RefObject } from 'react'

/**
 * Hook to handle clicks outside of a referenced element
 * @param ref - React ref to the element to monitor
 * @param isOpen - Whether the element is currently open/visible
 * @param onClose - Callback to run when clicking outside
 * @param excludeSelector - Optional CSS selector for elements to exclude from outside clicks
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
  excludeSelector?: string
): void {
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // Check if click is inside the ref element
      if (ref.current && ref.current.contains(target)) {
        return
      }

      // Check if click is on an excluded element
      if (excludeSelector && target.closest(excludeSelector)) {
        return
      }

      // Click was outside - close
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [ref, isOpen, onClose, excludeSelector])
}
