/**
 * Where a dropdown list goes under (or over) its trigger, shared by <Select>
 * and installSelectMenus so both lists sit and flip identically.
 */

export const MENU_GAP = 4
export const MENU_MAX_HEIGHT = 280

export interface MenuPosition {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/** `listHeight` is the list's full scrollHeight, so a short list never flips. */
export function placeMenu(rect: DOMRect, listHeight: number): MenuPosition {
  const below = window.innerHeight - rect.bottom - MENU_GAP
  const above = rect.top - MENU_GAP
  // Flip up only when the list does not fit below AND there is more room above.
  const flip = below < Math.min(MENU_MAX_HEIGHT, listHeight) && above > below
  return {
    left: rect.left,
    width: rect.width,
    ...(flip
      ? { bottom: window.innerHeight - rect.top + MENU_GAP }
      : { top: rect.bottom + MENU_GAP }),
    maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, flip ? above : below) - 8)
  }
}
