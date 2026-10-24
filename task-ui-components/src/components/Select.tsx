/**
 * Select Component
 * Themed single-select dropdown. The open list is a real ARIA listbox with
 * full keyboard support, so it can replace a native <select> wherever the
 * browser's own popup (unthemeable, OS-drawn) looks out of place.
 *
 * The list is portalled into the anchor's theme scope (see themeScopeOf) and
 * positioned fixed from the trigger's rect, so it keeps the theme's tokens and
 * escapes both `overflow: hidden` and transformed ancestors.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '@wolffm/themes'
import '../select.css'
import '../scrollbar.css'
import { themeScopeOf } from '../lib/themeScope'
import { placeMenu, type MenuPosition } from '../lib/menuPlacement'

export type SelectVariant = 'outline' | 'filled' | 'ghost' | 'underline'
export type SelectSize = 'sm' | 'md' | 'lg'

export interface SelectOption<V extends string = string> {
  value: V
  /** Plain text so typeahead can match it. */
  label: string
  icon?: IconName
  /** Secondary line under the label in the open list. */
  description?: string
  disabled?: boolean
}

export interface SelectProps<V extends string = string> {
  value: V | null
  onChange: (value: V) => void
  options: SelectOption<V>[]
  /** Shown while `value` is null. */
  placeholder?: string
  variant?: SelectVariant
  size?: SelectSize
  disabled?: boolean
  /** Required when no visible <label htmlFor={id}> names the control. */
  'aria-label'?: string
  id?: string
  className?: string
}

const TYPEAHEAD_RESET_MS = 600

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  variant = 'outline',
  size = 'md',
  disabled = false,
  'aria-label': ariaLabel,
  id,
  className
}: SelectProps<V>) {
  const autoId = useId()
  const triggerId = id ?? `${autoId}-trigger`
  const listId = `${autoId}-list`
  const optionId = (i: number) => `${autoId}-opt-${i}`

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const [scope, setScope] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ text: '', at: 0 })

  const selectedIndex = options.findIndex(o => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = 1; i <= options.length; i++) {
        const next = (from + dir * i + options.length) % options.length
        if (!options[next].disabled) return next
      }
      return from
    },
    [options]
  )

  const edge = useCallback(
    (dir: 1 | -1) => step(dir === 1 ? -1 : options.length, dir),
    [options.length, step]
  )

  const openMenu = (start?: 'first' | 'last') => {
    if (disabled || options.length === 0) return
    let initial = selectedIndex
    if (start === 'first' || initial < 0) initial = edge(1)
    if (start === 'last') initial = edge(-1)
    setActive(initial)
    setScope(themeScopeOf(triggerRef.current))
    setOpen(true)
  }

  const closeMenu = (refocus: boolean) => {
    setOpen(false)
    setPosition(null)
    if (refocus) triggerRef.current?.focus()
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    closeMenu(true)
  }

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    setPosition(placeMenu(trigger.getBoundingClientRect(), listRef.current?.scrollHeight ?? 0))
  }, [])

  // Measure once the list exists, then follow the trigger while open.
  useLayoutEffect(() => {
    if (open && scope) place()
  }, [open, scope, place])

  // Focus only once placed: until then the list is visibility: hidden, and a
  // hidden element silently refuses focus — keys would stay on the trigger.
  const placed = position !== null
  useLayoutEffect(() => {
    if (open && placed) listRef.current?.focus({ preventScroll: true })
  }, [open, placed])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      closeMenu(false)
    }
    // Capture, so scrolling ANY ancestor re-places the list.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, place])

  // Keep the active option in view as the keyboard moves it.
  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(`${autoId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, autoId])

  const matchTypeahead = (key: string) => {
    const now = Date.now()
    const t = typeahead.current
    t.text = now - t.at > TYPEAHEAD_RESET_MS ? key : t.text + key
    t.at = now
    const needle = t.text.toLowerCase()
    const start = Math.max(active, 0)
    for (let i = 0; i < options.length; i++) {
      // A single repeated key cycles; a longer prefix stays on the current match.
      const offset = t.text.length === 1 ? i + 1 : i
      const idx = (start + offset) % options.length
      const o = options[idx]
      if (!o.disabled && o.label.toLowerCase().startsWith(needle)) return idx
    }
    return -1
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu('last')
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typeahead on a closed select changes the value, like a native one.
      const idx = matchTypeahead(e.key)
      if (idx >= 0) onChange(options[idx].value)
    }
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive(a => step(a, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(a => step(a, -1))
        break
      case 'Home':
        e.preventDefault()
        setActive(edge(1))
        break
      case 'End':
        e.preventDefault()
        setActive(edge(-1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        // Stop here so an enclosing Modal does not close along with the list.
        e.preventDefault()
        e.stopPropagation()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu(false)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const idx = matchTypeahead(e.key)
          if (idx >= 0) setActive(idx)
        }
    }
  }

  const style: React.CSSProperties | undefined = position
    ? {
        left: position.left,
        minWidth: position.width,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight
      }
    : { visibility: 'hidden' }

  const iconSize = size === 'lg' ? 18 : size === 'sm' ? 14 : 16

  return (
    <div
      className={[
        'hdk-select',
        `hdk-select--${variant}`,
        `hdk-select--${size}`,
        open && 'hdk-select--open',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="hdk-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closeMenu(true) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {selected?.icon && <Icon name={selected.icon} size={iconSize} />}
        <span className={`hdk-select__value ${selected ? '' : 'hdk-select__value--placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" size={iconSize} className="hdk-select__chevron" />
      </button>

      {open &&
        scope &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={triggerId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            className="hdk-select__menu hdk-scroll hdk-scroll--thin"
            style={style}
            onKeyDown={onListKeyDown}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={i === selectedIndex}
                aria-disabled={o.disabled || undefined}
                className={[
                  'hdk-select__option',
                  i === active && 'hdk-select__option--active',
                  i === selectedIndex && 'hdk-select__option--selected'
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                {o.icon && <Icon name={o.icon} size={iconSize} />}
                <span className="hdk-select__option-text">
                  <span className="hdk-select__option-label">{o.label}</span>
                  {o.description && (
                    <span className="hdk-select__option-desc">{o.description}</span>
                  )}
                </span>
                {i === selectedIndex && (
                  <Icon name="check" size={iconSize} className="hdk-select__check" />
                )}
              </li>
            ))}
          </ul>,
          scope
        )}
    </div>
  )
}

export interface NativeSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  variant?: SelectVariant
  size?: SelectSize
}

/**
 * A native <select> wearing the same trigger as <Select>. Use it where the
 * OS picker is the better UX — long lists on mobile, forms that must submit
 * natively. The popup itself stays OS-drawn; `color-scheme` from the theme
 * gets it to the right light/dark mode.
 */
export function NativeSelect({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}: NativeSelectProps) {
  return (
    <span
      className={['hdk-select', `hdk-select--${variant}`, `hdk-select--${size}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <select className="hdk-select__trigger hdk-select__native" {...rest}>
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={size === 'lg' ? 18 : size === 'sm' ? 14 : 16}
        className="hdk-select__chevron hdk-select__chevron--native"
      />
    </span>
  )
}
