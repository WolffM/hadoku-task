/**
 * Where a tooltip bubble goes, shared by <Tooltip> and installTitleTooltips so
 * the React and framework-free bubbles sit, flip and clamp identically.
 */

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface Placed {
  side: TooltipPlacement
  left: number
  top: number
  /** Arrow offset along the bubble edge, so it still points at the anchor after clamping. */
  arrow: number
}

const GAP = 8
const EDGE = 8

const OPPOSITE: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
}

function fits(side: TooltipPlacement, a: DOMRect, w: number, h: number) {
  if (side === 'top') return a.top - GAP - h >= EDGE
  if (side === 'bottom') return a.bottom + GAP + h <= window.innerHeight - EDGE
  if (side === 'left') return a.left - GAP - w >= EDGE
  return a.right + GAP + w <= window.innerWidth - EDGE
}

export function placeTooltip(
  preferred: TooltipPlacement,
  a: DOMRect,
  w: number,
  h: number
): Placed {
  const side =
    fits(preferred, a, w, h) || !fits(OPPOSITE[preferred], a, w, h)
      ? preferred
      : OPPOSITE[preferred]
  const clamp = (v: number, max: number) => Math.min(Math.max(v, EDGE), max - EDGE)
  if (side === 'top' || side === 'bottom') {
    const left = clamp(a.left + a.width / 2 - w / 2, window.innerWidth - w)
    const top = side === 'top' ? a.top - GAP - h : a.bottom + GAP
    return { side, left, top, arrow: a.left + a.width / 2 - left }
  }
  const top = clamp(a.top + a.height / 2 - h / 2, window.innerHeight - h)
  const left = side === 'left' ? a.left - GAP - w : a.right + GAP
  return { side, left, top, arrow: a.top + a.height / 2 - top }
}
