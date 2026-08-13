/**
 * React `<Icon>` — a thin wrapper over the string registry.
 *
 * The glyph is emitted as real JSX children rather than dangerouslySetInnerHTML: the
 * markup is ours and build-time-generated, but React apps run under the same strict
 * CSP as the frontpage, and parsing 78 vendored strings at runtime buys nothing when
 * the shapes can be elements. So the paths are parsed once, lazily, per icon actually
 * rendered — an app that uses six icons never touches the other seventy-two.
 */
import React from 'react'
import { ICON_MARKUP } from './registry.generated'
import type { IconName } from './registry.generated'
import type { IconFamily, IconVariant } from './index'

export interface IconProps {
  name: IconName
  /** CSS length. Defaults to `1em` so the glyph scales with surrounding text. */
  size?: string | number
  /**
   * Which family token colours this icon. Applies to `accent` (the glyph itself)
   * and to `tint`/`filled` (the tile). Ignored for `bare`, which inherits
   * `currentColor` by design.
   */
  family?: IconFamily
  /** `bare` (default), `accent`, `tint`, or `filled` — see IconVariant. */
  variant?: IconVariant
  /** Round the accent tile. No effect when `variant` is `bare`. */
  round?: boolean
  /**
   * Accessible name. Omit for decorative icons — those render `aria-hidden` so a
   * screen reader does not announce a glyph that repeats an adjacent text label.
   */
  title?: string
  className?: string
  /** Stroke width in the 24x24 viewBox. Lucide's default is 2. */
  strokeWidth?: number
}

/** `<path d="..." />` etc. -> React elements. Parsed once per icon, then cached. */
const parsed = new Map<IconName, React.ReactNode[]>()

const SELF_CLOSING = /<([a-z]+)\s+([^>]*?)\/>/g
const ATTR = /([a-z-]+)="([^"]*)"/g

/** SVG presentation attributes we emit, mapped to their React prop names. */
const PROP_NAMES: Record<string, string> = {
  d: 'd',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  x: 'x',
  y: 'y',
  x1: 'x1',
  x2: 'x2',
  y1: 'y1',
  y2: 'y2',
  rx: 'rx',
  ry: 'ry',
  width: 'width',
  height: 'height',
  points: 'points',
  transform: 'transform',
  fill: 'fill'
}

function parseMarkup(name: IconName): React.ReactNode[] {
  const cached = parsed.get(name)
  if (cached) return cached

  const nodes: React.ReactNode[] = []
  const markup = ICON_MARKUP[name]
  let match: RegExpExecArray | null
  SELF_CLOSING.lastIndex = 0
  let i = 0
  while ((match = SELF_CLOSING.exec(markup)) !== null) {
    const [, tag, attrString] = match
    const props: Record<string, string> = { key: String(i++) }
    let attr: RegExpExecArray | null
    ATTR.lastIndex = 0
    while ((attr = ATTR.exec(attrString)) !== null) {
      const prop = PROP_NAMES[attr[1]]
      if (prop) props[prop] = attr[2]
    }
    nodes.push(React.createElement(tag, props))
  }
  parsed.set(name, nodes)
  return nodes
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = '1em',
  family = 'warning',
  variant = 'bare',
  round = false,
  title,
  className,
  strokeWidth = 2
}) => {
  if (ICON_MARKUP[name] === undefined) {
    throw new Error(
      `<Icon>: "${String(name)}" is not in the icon registry. ` +
        `Add it to themes/src/icons/sources.json and run \`pnpm run generate:icons\`.`
    )
  }

  const dim = typeof size === 'number' ? `${size}px` : size
  const a11y = title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true, focusable: 'false' } as const)

  // `bare` and `accent` render the <svg> as the outermost element, so the caller's
  // className belongs on it. `tint`/`filled` wrap it in a tile, and the className
  // goes there instead — in both cases it lands on the element you get back.
  const isTile = variant === 'tint' || variant === 'filled'
  const svgClass = [
    'hdk-icon',
    variant === 'accent' ? `hdk-icon--${family}` : '',
    !isTile && className ? className : ''
  ]
    .filter(Boolean)
    .join(' ')

  const svg = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={svgClass}
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {parseMarkup(name)}
    </svg>
  )

  if (!isTile) return svg

  const tile =
    `hdk-icon-tile hdk-icon-tile--${variant} hdk-icon-tile--${family}` +
    (round ? ' hdk-icon-tile--round' : '') +
    (className ? ` ${className}` : '')

  return <span className={tile}>{svg}</span>
}
