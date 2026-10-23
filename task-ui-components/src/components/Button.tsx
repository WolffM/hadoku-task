/**
 * Button Component
 * Themed button in five treatments x five colour families, so an app never
 * falls back to the browser's default button chrome.
 */

import React from 'react'
import { Icon, type IconName } from '@wolffm/themes'
import '../button.css'

export type ButtonVariant = 'solid' | 'gradient' | 'soft' | 'outline' | 'ghost'
export type ButtonFamily = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonShape = 'rounded' | 'pill' | 'square'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  family?: ButtonFamily
  size?: ButtonSize
  shape?: ButtonShape
  /** Registry icon before the label. */
  icon?: IconName
  /** Registry icon after the label (e.g. `chevron-down` on a menu button). */
  iconEnd?: IconName
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean
  /** Stretch to the container width. */
  block?: boolean
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

export function Button({
  variant = 'soft',
  family = 'primary',
  size = 'md',
  shape = 'rounded',
  icon,
  iconEnd,
  loading = false,
  block = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  // An icon with no label is a square button; it still needs an aria-label.
  const iconOnly = !children && (icon || iconEnd)
  const classes = [
    'hdk-btn',
    `hdk-btn--${variant}`,
    `hdk-btn--${family}`,
    `hdk-btn--${size}`,
    `hdk-btn--${shape}`,
    iconOnly && 'hdk-btn--icon-only',
    block && 'hdk-btn--block',
    loading && 'hdk-btn--loading',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="hdk-btn__spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={ICON_SIZE[size]} />
      )}
      {children}
      {iconEnd && <Icon name={iconEnd} size={ICON_SIZE[size]} />}
    </button>
  )
}
