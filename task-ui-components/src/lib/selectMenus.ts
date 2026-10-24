/**
 * The themed list for every native <select> on a page, with no change to the
 * markup.
 *
 *   import { installSelectMenus } from '@wolffm/task-ui-components/select-menus'
 *   import '@wolffm/task-ui-components/select.css'
 *   installSelectMenus()
 *
 * hadoku_site calls this once from its shell, which covers every
 * micro-frontend; an app does not call it itself. Framework-free and
 * React-free, like installTitleTooltips, for the same reason.
 *
 * A native select's closed box takes CSS, but its open list is drawn by the
 * OS and takes almost none. So a mouse press or an opening key on the select
 * is intercepted (preventDefault on mousedown is what stops the OS list) and
 * the same list <Select> renders opens instead, built from the select's own
 * <option>s and <optgroup>s at that moment.
 *
 * The <select> stays the source of truth. Choosing sets its selectedIndex and
 * fires `input` and `change` exactly as the OS list would, so every framework
 * (React's onChange included) and every plain listener sees an ordinary
 * change, and a form still submits the select's value.
 *
 * Left native on purpose:
 *   - touch: a phone's own picker is the better control there
 *   - `multiple` or `size > 1`, which render as an inline list, not a popup
 *   - anything under `data-native-select`
 */

import { themeScopeOf } from './themeScope'
import { placeMenu } from './menuPlacement'

const TYPEAHEAD_RESET_MS = 600
const LIST_ID = 'hdk-select-menu'
// `check` from the @wolffm/themes registry (Lucide circle-check), inlined so
// this entry does not pull the whole registry into the shell.
const CHECK_SVG =
  '<svg class="hdk-icon hdk-select__check" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>'

const OPEN_KEYS = new Set(['ArrowDown', 'ArrowUp', ' ', 'F4'])

let uninstallCurrent: (() => void) | null = null

function eligible(el: Element | null): el is HTMLSelectElement {
  return (
    el instanceof HTMLSelectElement &&
    !el.multiple &&
    el.size <= 1 &&
    !el.disabled &&
    !el.closest('[data-native-select]')
  )
}

export function installSelectMenus(): () => void {
  if (uninstallCurrent) return uninstallCurrent

  let lastPointer = 'mouse'
  let select: HTMLSelectElement | null = null
  let list: HTMLUListElement | null = null
  let options: HTMLOptionElement[] = []
  let items: HTMLLIElement[] = []
  let active = -1
  const typeahead = { text: '', at: 0 }

  function setActive(i: number) {
    if (items[active]) items[active].classList.remove('hdk-select__option--active')
    active = i
    const item = items[i]
    if (!item || !list) return
    item.classList.add('hdk-select__option--active')
    list.setAttribute('aria-activedescendant', item.id)
    item.scrollIntoView({ block: 'nearest' })
  }

  function step(from: number, dir: 1 | -1) {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + dir * i + options.length) % options.length
      if (!isOff(next)) return next
    }
    return from
  }

  const edge = (dir: 1 | -1) => step(dir === 1 ? -1 : options.length, dir)

  function matchTypeahead(key: string) {
    const now = Date.now()
    typeahead.text = now - typeahead.at > TYPEAHEAD_RESET_MS ? key : typeahead.text + key
    typeahead.at = now
    const needle = typeahead.text.toLowerCase()
    const start = Math.max(active, 0)
    for (let i = 0; i < options.length; i++) {
      // A single repeated key cycles; a longer prefix stays on the current match.
      const idx = (start + (typeahead.text.length === 1 ? i + 1 : i)) % options.length
      const o = options[idx]
      if (!isOff(idx) && labelOf(o).toLowerCase().startsWith(needle)) return idx
    }
    return -1
  }

  const labelOf = (o: HTMLOptionElement) => o.label || o.text
  // A disabled <optgroup> disables its options too.
  const isOff = (i: number) =>
    options[i].disabled ||
    (options[i].parentElement as HTMLOptGroupElement | null)?.disabled === true

  function place() {
    if (!select || !list) return
    if (!select.isConnected) {
      close(false)
      return
    }
    const p = placeMenu(select.getBoundingClientRect(), list.scrollHeight)
    list.style.left = `${p.left}px`
    list.style.minWidth = `${p.width}px`
    list.style.top = p.top === undefined ? '' : `${p.top}px`
    list.style.bottom = p.bottom === undefined ? '' : `${p.bottom}px`
    list.style.maxHeight = `${p.maxHeight}px`
    list.style.visibility = ''
  }

  function open(el: HTMLSelectElement, start?: 'last') {
    close(false)
    const scope = themeScopeOf(el)
    if (!scope) return
    select = el
    options = Array.from(el.options).filter(o => !o.hidden)
    if (options.length === 0) return

    list = document.createElement('ul')
    list.id = LIST_ID
    list.setAttribute('role', 'listbox')
    list.tabIndex = -1
    list.className = 'hdk-select__menu hdk-scroll hdk-scroll--thin'
    const name = el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent?.trim()
    if (name) list.setAttribute('aria-label', name)
    // The list is portalled, so it cannot inherit the select's type size.
    const cs = getComputedStyle(el)
    list.style.fontSize = cs.fontSize
    list.style.fontFamily = cs.fontFamily
    list.style.visibility = 'hidden'

    let group: HTMLOptGroupElement | null = null
    items = options.map((o, i) => {
      const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null
      if (g && g !== group) {
        const head = document.createElement('li')
        head.setAttribute('role', 'presentation')
        head.className = 'hdk-select__group'
        head.textContent = g.label
        list?.append(head)
      }
      group = g
      const item = document.createElement('li')
      item.id = `${LIST_ID}-${i}`
      item.setAttribute('role', 'option')
      const selected = o.index === el.selectedIndex
      item.setAttribute('aria-selected', String(selected))
      if (o.disabled || g?.disabled) item.setAttribute('aria-disabled', 'true')
      item.className = `hdk-select__option${selected ? ' hdk-select__option--selected' : ''}`
      const text = document.createElement('span')
      text.className = 'hdk-select__option-label'
      text.textContent = labelOf(o)
      const wrap = document.createElement('span')
      wrap.className = 'hdk-select__option-text'
      wrap.append(text)
      item.append(wrap)
      if (selected) item.insertAdjacentHTML('beforeend', CHECK_SVG)
      item.addEventListener('pointermove', () => {
        if (!isOff(i) && i !== active) setActive(i)
      })
      item.addEventListener('click', () => choose(i))
      list?.append(item)
      return item
    })
    list.addEventListener('keydown', onListKeyDown)
    scope.appendChild(list)
    el.setAttribute('aria-expanded', 'true')
    el.setAttribute('aria-controls', LIST_ID)

    const current = options.findIndex(o => o.index === el.selectedIndex)
    setActive(start === 'last' ? edge(-1) : current >= 0 && !isOff(current) ? current : edge(1))
    place()
    list.focus({ preventScroll: true })
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
  }

  function close(refocus: boolean) {
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', place)
    list?.remove()
    list = null
    if (!select) return
    select.removeAttribute('aria-expanded')
    select.removeAttribute('aria-controls')
    if (refocus) select.focus({ preventScroll: true })
    select = null
    items = []
    options = []
    active = -1
  }

  function choose(i: number) {
    const el = select
    const o = options[i]
    if (!el || !o || isOff(i)) return
    const changed = o.index !== el.selectedIndex
    close(true)
    if (!changed) return
    el.selectedIndex = o.index
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Scrolling the list itself must not re-place (or close) it.
  const onScroll = (e: Event) => {
    if (list && e.target instanceof Node && list.contains(e.target)) return
    place()
  }

  function onListKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive(step(active, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(step(active, -1))
        break
      case 'Home':
      case 'PageUp':
        e.preventDefault()
        setActive(edge(1))
        break
      case 'End':
      case 'PageDown':
        e.preventDefault()
        setActive(edge(-1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        // Stop here so an enclosing modal does not close along with the list.
        e.preventDefault()
        e.stopPropagation()
        close(true)
        break
      case 'Tab':
        close(true)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const idx = matchTypeahead(e.key)
          if (idx >= 0) setActive(idx)
        }
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    lastPointer = e.pointerType
    const target = e.target as Node
    if (list && !list.contains(target) && target !== select) close(false)
  }

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || lastPointer === 'touch') return
    const el = (e.target as Element | null)?.closest?.('select') ?? null
    if (!eligible(el)) return
    // This is what keeps the OS list from opening.
    e.preventDefault()
    if (select === el) {
      close(true)
      return
    }
    el.focus({ preventScroll: true })
    open(el)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as Element | null
    if (!eligible(el) || select === el) return
    if (!OPEN_KEYS.has(e.key) || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    open(el, e.key === 'ArrowUp' && !e.altKey ? 'last' : undefined)
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('keydown', onKeyDown, true)

  uninstallCurrent = () => {
    close(false)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    uninstallCurrent = null
  }
  return uninstallCurrent
}
