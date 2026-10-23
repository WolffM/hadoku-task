/**
 * Tooltip Component
 * Themed replacement for `title=`. A native title tooltip is OS-drawn, waits
 * about a second, never appears on keyboard focus and cannot be themed.
 *
 * Meets WCAG 1.4.13 (content on hover or focus): it shows on hover AND focus,
 * Escape dismisses it, and the pointer can move onto the bubble without it
 * closing. The child gets `aria-describedby`, so the text is announced.
 *
 * Like <Select>, the bubble renders in place with `position: fixed` rather
 * than in a portal, so it keeps the theme tokens scoped to the app container.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import '../tooltip.css'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'
export type TooltipVariant = 'inverse' | 'card' | 'primary'

export interface TooltipProps {
  content: React.ReactNode
  /** Preferred side; flips to the opposite one when it would leave the viewport. */
  placement?: TooltipPlacement
  variant?: TooltipVariant
  /** Hover delay before showing, ms. Focus shows immediately. */
  delay?: number
  /** Render the child alone, e.g. while a menu it belongs to is open. */
  disabled?: boolean
  /** A single element. It receives aria-describedby. */
  children: React.ReactElement<{ 'aria-describedby'?: string }>
}

const GAP = 8
const EDGE = 8
const HIDE_GRACE_MS = 120

const OPPOSITE: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
}

interface Placed {
  side: TooltipPlacement
  left: number
  top: number
  /** Arrow offset along the bubble edge, so it still points at the anchor after clamping. */
  arrow: number
}

function fits(side: TooltipPlacement, a: DOMRect, w: number, h: number) {
  if (side === 'top') return a.top - GAP - h >= EDGE
  if (side === 'bottom') return a.bottom + GAP + h <= window.innerHeight - EDGE
  if (side === 'left') return a.left - GAP - w >= EDGE
  return a.right + GAP + w <= window.innerWidth - EDGE
}

function compute(preferred: TooltipPlacement, a: DOMRect, w: number, h: number): Placed {
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

export function Tooltip({
  content,
  placement = 'top',
  variant = 'inverse',
  delay = 300,
  disabled = false,
  children
}: TooltipProps) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback((after: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), after)
  }, [])

  const hide = useCallback((after: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOpen(false)
      setPlaced(null)
    }, after)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const place = useCallback(() => {
    // The span is display: contents, so measure the element it wraps.
    const target = anchorRef.current?.firstElementChild ?? anchorRef.current
    const bubble = bubbleRef.current
    if (!target || !bubble) return
    setPlaced(
      compute(placement, target.getBoundingClientRect(), bubble.offsetWidth, bubble.offsetHeight)
    )
  }, [placement])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, content])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide(0)
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, place, hide])

  if (disabled || content == null || content === '') return children

  const visible = open && placed !== null
  const style: React.CSSProperties = placed
    ? ({
        left: placed.left,
        top: placed.top,
        '--hdk-tooltip-arrow': `${placed.arrow}px`
      } as React.CSSProperties)
    : { left: 0, top: 0 }

  return (
    <span
      ref={anchorRef}
      className="hdk-tooltip-anchor"
      onPointerEnter={e => e.pointerType === 'mouse' && show(delay)}
      onPointerLeave={e => e.pointerType === 'mouse' && hide(HIDE_GRACE_MS)}
      onFocus={e => {
        // Keyboard focus only — a mouse click focuses too, and the hover
        // path already handles that pointer.
        if (e.target.matches(':focus-visible')) show(0)
      }}
      onBlur={() => hide(0)}
    >
      {React.cloneElement(children, {
        'aria-describedby':
          [children.props['aria-describedby'], open ? tipId : null].filter(Boolean).join(' ') ||
          undefined
      })}
      {open && (
        <div
          ref={bubbleRef}
          id={tipId}
          role="tooltip"
          className={[
            'hdk-tooltip',
            `hdk-tooltip--${variant}`,
            `hdk-tooltip--${placed?.side ?? placement}`,
            visible && 'hdk-tooltip--visible'
          ]
            .filter(Boolean)
            .join(' ')}
          style={style}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={() => hide(HIDE_GRACE_MS)}
        >
          {content}
        </div>
      )}
    </span>
  )
}
