/**
 * NumberInput Component
 * A themed number field with its own stepper, for the OS spinner arrows that
 * no CSS can style (controls.css removes them from a bare <input type=number>).
 *
 * It is a real <input type="number"> with every input prop passed through, so
 * it works controlled (`value` + `onChange`) or uncontrolled (`defaultValue`),
 * submits in a form, and keeps native min/max/step validation and the arrow
 * keys. The buttons call the input's own stepUp()/stepDown() and then fire
 * `input` and `change`, so `onChange` sees an ordinary edit: React's value
 * tracker compares against what React last wrote, and stepUp() goes around it.
 *
 * Holding a button repeats, like the native spinner. The buttons are not tab
 * stops — the arrow keys on the field already step — but they are labelled.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@wolffm/themes'
import '../number-input.css'

export type NumberInputSize = 'sm' | 'md' | 'lg'

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: NumberInputSize
  /** Labels for the two buttons; default "Increase" / "Decrease". */
  increaseLabel?: string
  decreaseLabel?: string
}

const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 60
const ICON_SIZE: Record<NumberInputSize, number> = { sm: 12, md: 14, lg: 16 }

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      size = 'md',
      increaseLabel = 'Increase',
      decreaseLabel = 'Decrease',
      className,
      disabled,
      readOnly,
      onInput,
      ...rest
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null)
    const repeat = useRef<{
      delay?: ReturnType<typeof setTimeout>
      every?: ReturnType<typeof setInterval>
    }>({})
    // Mirrors the field so the buttons can disable at min/max, controlled or not.
    const [current, setCurrent] = useState<string>(String(rest.value ?? rest.defaultValue ?? ''))
    useEffect(() => {
      if (rest.value !== undefined) setCurrent(String(rest.value))
    }, [rest.value])

    const setRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )

    const stop = useCallback(() => {
      clearTimeout(repeat.current.delay)
      clearInterval(repeat.current.every)
      repeat.current = {}
    }, [])
    useEffect(() => stop, [stop])

    const stepOnce = useCallback((dir: 1 | -1) => {
      const input = inputRef.current
      if (!input || input.disabled || input.readOnly) return false
      const before = input.value
      if (dir === 1) input.stepUp()
      else input.stepDown()
      if (input.value === before) return false
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, [])

    const start = (dir: 1 | -1) => (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Keep focus (and the caret) in the field, as the native spinner does.
      e.preventDefault()
      inputRef.current?.focus({ preventScroll: true })
      stop()
      if (!stepOnce(dir)) return
      repeat.current.delay = setTimeout(() => {
        repeat.current.every = setInterval(() => {
          if (!stepOnce(dir)) stop()
        }, REPEAT_EVERY_MS)
      }, REPEAT_DELAY_MS)
    }

    const n = current === '' ? NaN : Number(current)
    const min = rest.min === undefined || rest.min === '' ? -Infinity : Number(rest.min)
    const max = rest.max === undefined || rest.max === '' ? Infinity : Number(rest.max)
    const locked = disabled || readOnly

    return (
      <span
        className={[
          'hdk-number',
          `hdk-number--${size}`,
          disabled && 'hdk-number--disabled',
          className
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <input
          ref={setRef}
          type="number"
          className="hdk-number__input"
          disabled={disabled}
          readOnly={readOnly}
          onInput={e => {
            setCurrent(e.currentTarget.value)
            onInput?.(e)
          }}
          {...rest}
        />
        <span className="hdk-number__steps">
          <button
            type="button"
            tabIndex={-1}
            className="hdk-number__step"
            aria-label={increaseLabel}
            disabled={locked || n >= max}
            onPointerDown={start(1)}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
          >
            <Icon name="chevron-up" size={ICON_SIZE[size]} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="hdk-number__step"
            aria-label={decreaseLabel}
            disabled={locked || n <= min}
            onPointerDown={start(-1)}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
          >
            <Icon name="chevron-down" size={ICON_SIZE[size]} />
          </button>
        </span>
      </span>
    )
  }
)
