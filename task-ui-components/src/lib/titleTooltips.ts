/**
 * Card tooltips for every `title=` on a page, with no change to the markup.
 *
 *   import { installTitleTooltips } from '@wolffm/task-ui-components/title-tooltips'
 *   import '@wolffm/task-ui-components/tooltip.css'
 *   installTitleTooltips()
 *
 * hadoku_site calls this once from its shell, which covers every
 * micro-frontend at once; an app does not call it itself. Framework-free and
 * React-free on purpose: the shell has no React, and this must not pull a
 * second copy into the page.
 *
 * One delegated listener set on the document. On hover (mouse only — touch
 * never showed a native title either) or keyboard focus, the nearest element
 * carrying `title` lends it to the bubble: the attribute moves to
 * `data-hdk-title` for as long as the bubble is up, which is what stops the
 * browser drawing its own on top, and goes back the moment it closes. So
 * outside a hover the DOM is exactly what the app rendered, and code or a
 * framework that reads or re-sets `title` sees its own value. A title the
 * app changes mid-hover (a MutationObserver watches the anchor) re-stashes and
 * updates the open bubble.
 *
 * Same contract as <Tooltip>: hover or focus shows it, Escape dismisses it
 * until the pointer leaves, the pointer can move onto the bubble, a press
 * closes it, and the anchor gets `aria-describedby` while it is up (skipped
 * when the title only repeats the aria-label). The bubble is portalled into
 * the anchor's theme scope, so a nested `[data-theme]` gets its own colours.
 *
 * Opt out per subtree with `data-native-title`.
 */

import { themeScopeOf } from './themeScope'
import { placeTooltip, type TooltipPlacement } from './tooltipPlacement'

export interface TitleTooltipOptions {
  /** Hover delay before showing, ms. Focus shows immediately. */
  delay?: number
  placement?: TooltipPlacement
}

const HIDE_GRACE_MS = 120
const STASH = 'data-hdk-title'
const BUBBLE_ID = 'hdk-title-tooltip'

let uninstallCurrent: (() => void) | null = null

export function installTitleTooltips(options: TitleTooltipOptions = {}): () => void {
  if (uninstallCurrent) return uninstallCurrent
  const delay = options.delay ?? 300
  const placement = options.placement ?? 'top'

  let anchor: Element | null = null
  let bubble: HTMLDivElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  // Escape closes the bubble until the pointer leaves that anchor (WCAG 1.4.13).
  let dismissed: Element | null = null

  const observer = new MutationObserver(() => {
    if (!anchor || !anchor.hasAttribute('title')) return
    stash(anchor)
    if (bubble) {
      bubble.textContent = anchor.getAttribute(STASH)
      place()
    }
  })

  function stash(el: Element) {
    el.setAttribute(STASH, el.getAttribute('title') ?? '')
    el.removeAttribute('title')
  }

  function restore(el: Element) {
    const text = el.getAttribute(STASH)
    if (text === null) return
    el.removeAttribute(STASH)
    if (!el.hasAttribute('title')) el.setAttribute('title', text)
  }

  function titledFrom(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null
    // The stash too: while the bubble is up the anchor carries data-hdk-title,
    // not title, and a pointerover on its own icon must still find IT rather
    // than a titled ancestor.
    const el = target.closest(`[title], [${STASH}]`)
    if (!el || el.tagName === 'IFRAME' || el.closest('[data-native-title]')) return null
    return (el.getAttribute('title') ?? el.getAttribute(STASH) ?? '').trim() ? el : null
  }

  function place() {
    if (!anchor || !bubble) return
    if (!anchor.isConnected) {
      hide(0)
      return
    }
    const p = placeTooltip(
      placement,
      anchor.getBoundingClientRect(),
      bubble.offsetWidth,
      bubble.offsetHeight
    )
    bubble.style.left = `${p.left}px`
    bubble.style.top = `${p.top}px`
    bubble.style.setProperty('--hdk-tooltip-arrow', `${p.arrow}px`)
    bubble.className = `hdk-tooltip hdk-tooltip--card hdk-tooltip--plain hdk-tooltip--${p.side} hdk-tooltip--visible`
  }

  /** Take the title off `el` now (before the browser's own ~1s delay runs
   *  out) and open the bubble after `after` ms. */
  function arm(el: Element, after: number) {
    clearTimeout(timer)
    if (el !== anchor) {
      release()
      anchor = el
      stash(el)
      observer.observe(el, { attributes: true, attributeFilter: ['title'] })
    }
    if (dismissed === el) return
    timer = setTimeout(open, after)
  }

  function open() {
    if (!anchor) return
    const scope = themeScopeOf(anchor)
    if (!scope) return
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.id = BUBBLE_ID
      bubble.setAttribute('role', 'tooltip')
      bubble.addEventListener('pointerenter', () => clearTimeout(timer))
      bubble.addEventListener('pointerleave', () => hide(HIDE_GRACE_MS))
    }
    const text = anchor.getAttribute(STASH) ?? ''
    bubble.textContent = text
    // Parked invisibly at the origin so it can be measured, then placed.
    bubble.className = `hdk-tooltip hdk-tooltip--card hdk-tooltip--plain hdk-tooltip--${placement}`
    bubble.style.left = '0px'
    bubble.style.top = '0px'
    if (bubble.parentNode !== scope) scope.appendChild(bubble)
    if (text !== anchor.getAttribute('aria-label')) {
      const ids = (anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      if (!ids.includes(BUBBLE_ID))
        anchor.setAttribute('aria-describedby', [...ids, BUBBLE_ID].join(' '))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
  }

  /** Close the bubble and hand the anchor its title back. */
  function release() {
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
    bubble?.remove()
    if (!anchor) return
    observer.disconnect()
    const ids = (anchor.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(id => id && id !== BUBBLE_ID)
    if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '))
    else anchor.removeAttribute('aria-describedby')
    restore(anchor)
    anchor = null
  }

  function hide(after: number) {
    clearTimeout(timer)
    if (after === 0) release()
    else timer = setTimeout(release, after)
  }

  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    if (bubble && bubble.contains(e.target as Node)) return
    // Back over the anchor of a bubble still up: just cancel the pending hide.
    // Over it with no bubble (inside the hide grace, or after a dismissal
    // that has since cleared), arm it again — otherwise it stays silent.
    const el = titledFrom(e.target)
    if (el && el === anchor && bubble?.isConnected) clearTimeout(timer)
    else if (el) arm(el, delay)
  }

  const onPointerOut = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const to = e.relatedTarget as Node | null
    // Checked before `anchor`: a dismissal has already released the anchor.
    if (dismissed && !(to && dismissed.contains(to))) dismissed = null
    if (!anchor || (to && (anchor.contains(to) || bubble?.contains(to)))) return
    hide(HIDE_GRACE_MS)
  }

  // A press closes it, as it does a native title: the click usually opens
  // something the bubble would sit on top of.
  const onPointerDown = () => {
    if (anchor) dismissed = anchor
    hide(0)
  }

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target
    if (!(target instanceof Element) || !target.matches(':focus-visible')) return
    const el = titledFrom(target)
    if (el) {
      dismissed = null
      arm(el, 0)
    }
  }

  const onFocusOut = (e: FocusEvent) => {
    if (anchor && anchor.contains(e.target as Node)) hide(0)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !anchor || !bubble?.isConnected) return
    dismissed = anchor
    hide(0)
  }

  document.addEventListener('pointerover', onPointerOver)
  document.addEventListener('pointerout', onPointerOut)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('keydown', onKeyDown)

  uninstallCurrent = () => {
    hide(0)
    document.removeEventListener('pointerover', onPointerOver)
    document.removeEventListener('pointerout', onPointerOut)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('keydown', onKeyDown)
    uninstallCurrent = null
  }
  return uninstallCurrent
}
