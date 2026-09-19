/**
 * The chip an agent reports itself through (autoland v3 §3.1).
 *
 * `status` is a generic board primitive — "an agent reports status on a task" —
 * not one pipeline's concept, which is why it is a first-class field and this
 * renderer knows nothing about autoland. `kind` picks the treatment, `label` is
 * the agent's own free text and is rendered verbatim and never parsed, and
 * `href` (when present) turns the whole chip into a link, usually to the PR.
 *
 * ── On hardcoding the four kinds ────────────────────────────────────────────
 *
 * TenHands asked for the vocabulary to be fetched from the presets endpoint, on
 * the lane precedent: lane names are data, so a rename shouldn't need a deploy.
 * The analogy doesn't carry. A lane's label is rendered AS TEXT, so fetching it
 * is sufficient — the renderer needs nothing else to draw a lane it has never
 * seen. A status `kind` is a styling contract: it resolves to a colour family
 * and a glyph, both of which are code. Downloading the string "queued" gets us a
 * name we have no rule for, so it would render as an unstyled chip either way,
 * and it would ALSO pass validation — turning a typo into a silent blank instead
 * of a 422 at the write. The half that genuinely is theirs, `label`, is already
 * free text nobody here interprets.
 *
 * If the set ever needs to grow, the honest change is a new kind here plus a
 * rule in task-items.css, shipped together — not a fetch that makes the failure
 * quieter without making it rarer.
 */

import React from 'react'
import type { TaskStatus, TaskStatusKind } from '../domain/types'
import { Icon, type IconName } from '@wolffm/themes'

/**
 * Kind → glyph. The colour comes from the stylesheet (one class per kind, tinted
 * with the matching `--color-<family>-bg` / `--color-on-<family>-bg` pair), so no
 * hue is ever named in TypeScript.
 */
const GLYPH: Record<TaskStatusKind, IconName> = {
  working: 'activity',
  waiting: 'hourglass',
  blocked: 'ban',
  done: 'check'
}

export function StatusChip({ status }: { status: TaskStatus | null | undefined }) {
  if (!status) return null
  // A row written before a kind was retired still renders — as the neutral chip,
  // which says "there is a status and we don't know this one" rather than
  // vanishing and making the task look untouched.
  const glyph: IconName = GLYPH[status.kind] ?? 'circle-dot'
  const className = `task-app__status-chip task-app__status-chip--${status.kind}`

  const inner = (
    <>
      <Icon name={glyph} />
      <span className="task-app__status-label">{status.label}</span>
    </>
  )

  // `href` is validated http(s)-only on write (normalizeTaskStatus), so nothing
  // else can reach this attribute.
  return status.href ? (
    <a
      className={`${className} task-app__status-chip--link`}
      href={status.href}
      target="_blank"
      rel="noopener noreferrer"
      title={status.label}
      // The card is draggable; a link inside it must not start an HTML5 drag of
      // its own href when the user is trying to click it.
      onDragStart={e => e.preventDefault()}
      onClick={e => e.stopPropagation()}
    >
      {inner}
    </a>
  ) : (
    <span className={className} title={status.label}>
      {inner}
    </span>
  )
}
