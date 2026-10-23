/**
 * Tooltip Component
 * Themed replacement for `title=`. A native title tooltip is OS-drawn, waits
 * about a second, never appears on keyboard focus and cannot be themed.
 *
 * Meets WCAG 1.4.13 (content on hover or focus): it shows on hover AND focus,
 * Escape dismisses it, and the pointer can move onto the bubble without it
 * closing. The child gets `aria-describedby`, so the text is announced —
 * unless it is the child's own `aria-label`, which would read it twice. That
 * is the common case for an icon button: the label names it, and the tooltip
 * shows sighted users the same words.
 *
 * Like <Select>, the bubble is portalled into the anchor's theme scope (see
 * themeScopeOf), so it keeps the theme's tokens and is placed correctly even
 * under a transformed ancestor.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../tooltip.css'
import { themeScopeOf } from '../lib/themeScope'
import { placeTooltip, type Placed, type TooltipPlacement } from '../lib/tooltipPlacement'

export type { TooltipPlacement }
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
  /** A single element. Tooltip attaches its ref and pointer/focus handlers to it
   *  directly (composed with the child's own) and adds aria-describedby. */
  children: React.ReactElement<AnchorProps>
}

/** What Tooltip reads from, and adds to, its child. No wrapper element: a
 *  wrapper — even `display: contents` — still changes the DOM tree, and with it
 *  every `:last-child`, `>` and `+` selector aimed at the child. */
interface AnchorProps {
  'aria-describedby'?: string
  'aria-label'?: string
  ref?: React.Ref<HTMLElement>
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
  onPointerDown?: React.PointerEventHandler<HTMLElement>
  onFocus?: React.FocusEventHandler<HTMLElement>
  onBlur?: React.FocusEventHandler<HTMLElement>
}

/** The child's own ref: a prop in React 19, on the element in React 18 (where
 *  reading it from props is always undefined, and in 19 `element.ref` warns). */
function childRefOf(child: React.ReactElement<AnchorProps>): React.Ref<HTMLElement> | undefined {
  if (!React.version.startsWith('18')) return child.props.ref
  return (child as unknown as { ref?: React.Ref<HTMLElement> }).ref ?? undefined
}

const HIDE_GRACE_MS = 120

export function Tooltip({
  content,
  placement = 'top',
  variant = 'card',
  delay = 300,
  disabled = false,
  children
}: TooltipProps) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const [scope, setScope] = useState<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback((after: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setScope(themeScopeOf(anchorRef.current))
      setOpen(true)
    }, after)
  }, [])

  const hide = useCallback((after: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOpen(false)
      setPlaced(null)
    }, after)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const childRef = childRefOf(children)
  const setAnchor = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node
      if (typeof childRef === 'function') childRef(node)
      else if (childRef) (childRef as React.MutableRefObject<HTMLElement | null>).current = node
    },
    [childRef]
  )

  const place = useCallback(() => {
    const target = anchorRef.current
    const bubble = bubbleRef.current
    if (!target || !bubble) return
    setPlaced(
      placeTooltip(
        placement,
        target.getBoundingClientRect(),
        bubble.offsetWidth,
        bubble.offsetHeight
      )
    )
  }, [placement])

  useLayoutEffect(() => {
    if (open && scope) place()
  }, [open, scope, place, content])

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
  const restatesLabel = typeof content === 'string' && content === children.props['aria-label']
  const style: React.CSSProperties = placed
    ? ({
        left: placed.left,
        top: placed.top,
        '--hdk-tooltip-arrow': `${placed.arrow}px`
      } as React.CSSProperties)
    : { left: 0, top: 0 }

  const own = children.props
  return (
    <>
      {React.cloneElement(children, {
        ref: setAnchor,
        onPointerEnter: e => {
          own.onPointerEnter?.(e)
          if (e.pointerType === 'mouse') show(delay)
        },
        onPointerLeave: e => {
          own.onPointerLeave?.(e)
          if (e.pointerType === 'mouse') hide(HIDE_GRACE_MS)
        },
        // A press dismisses it, as it does a native title: the click usually
        // opens something (a menu, a dialog) the bubble would sit on top of.
        onPointerDown: e => {
          own.onPointerDown?.(e)
          hide(0)
        },
        onFocus: e => {
          own.onFocus?.(e)
          // Keyboard focus only — a mouse click focuses too, and the hover
          // path already handles that pointer.
          if (e.currentTarget.matches(':focus-visible')) show(0)
        },
        onBlur: e => {
          own.onBlur?.(e)
          hide(0)
        },
        'aria-describedby':
          [own['aria-describedby'], open && !restatesLabel ? tipId : null]
            .filter(Boolean)
            .join(' ') || undefined
      })}
      {open &&
        scope &&
        createPortal(
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
          </div>,
          scope
        )}
    </>
  )
}
