/**
 * Just enough markdown to read a plan.
 *
 * Plan notes are a known, narrow shape — headings, lists, the odd fenced block,
 * light inline emphasis — so this renders that and passes everything else
 * through as text. That buys the one thing a `<pre>` dump can't give: a document
 * whose structure you can see at a glance, without adding a markdown dependency
 * to a bundle that gets cold-load profiled.
 *
 * `##` headings are NOT handled here — parsePlanNotes() has already split the
 * document on them, and each section renders its own heading with its own
 * treatment (Questions is styled differently from the rest). This only ever sees
 * a section body.
 *
 * Everything is built as React elements. No dangerouslySetInnerHTML — notes are
 * agent-authored text and get rendered verbatim, never as markup.
 *
 * Task-list items (`- [ ]` / `- [x]`) render as real checkboxes, and ticking one
 * writes the same bytes a human typing `- [x]` would — see toggleChecklistItem
 * in planNotes.ts. That is the whole of plan approval in v3: no approvals table,
 * no `metadata.approved`, one format that both repos already parse.
 *
 * The one exception is a bare http(s) URL, which becomes an <a>. Notes carry
 * links worth following — a mirrored booking's join link, a PR — and a link you
 * have to select and copy is a link you don't follow. The URL pattern is the
 * whole allowlist: no other scheme can match, so `javascript:` never reaches an
 * href, and `[text](url)` stays unsupported rather than opening a second way to
 * put an arbitrary string there.
 */

import React from 'react'

const FENCE = /^\s*(?:```|~~~)(.*)$/
const SUBHEADING = /^(#{3,})\s+(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
/**
 * A task-list item's box, matched against an item's text AFTER the list marker
 * has been stripped: `[ ] Approve this plan` / `[x] Approve this plan`.
 * Mirrors TASK_ITEM in planNotes.ts, which matches the same thing against the
 * raw line — one recognises, the other rewrites.
 */
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/
/**
 * Inline code, then bold, then emphasis, then bare URLs — code first so `**`
 * inside it is literal, and URLs last so an underscore in a path is not read as
 * emphasis before the URL alternative gets a chance at it.
 */
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(https?:\/\/[^\s<>()]+)/g

/** Trailing punctuation that ends the sentence, not the URL. */
const URL_TAIL = /[.,;:!?]+$/

/** Emphasis and inline code within one line of text. Unmatched runs pass through. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  INLINE.lastIndex = 0

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (match[5]) {
      const href = token.replace(URL_TAIL, '')
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {href}
        </a>
      )
      // Whatever the tail regex trimmed is text, and must not be swallowed.
      out.push(token.slice(href.length))
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

interface ListItem {
  text: string
  ordered: boolean
  /** Tick state when the item is `- [ ]` / `- [x]`; undefined for a plain item. */
  checked?: boolean
}

export interface PlanMarkdownProps {
  body: string
  /**
   * How many task-list items appear in the document BEFORE this body, so a
   * checkbox here can name its position in the whole notes rather than in this
   * section. The popout accumulates it section by section; a caller with no
   * checkboxes to toggle can leave it at 0.
   */
  checkboxBase?: number
  /**
   * Toggle handler. Absent ⇒ boxes render read-only, which is what a viewer with
   * no save capability gets — an enabled checkbox that silently does nothing is
   * worse than a disabled one.
   */
  onToggleCheckbox?: (ordinal: number, checked: boolean) => void
  /** Boxes are disabled while a save is in flight. */
  busy?: boolean
}

export function PlanMarkdown({
  body,
  checkboxBase = 0,
  onToggleCheckbox,
  busy = false
}: PlanMarkdownProps) {
  const lines = body.split('\n')
  const blocks: React.ReactNode[] = []
  // Counts task-list items as they are emitted, so each one's ordinal is its
  // position in document order — the same order planNotes.checklistItems walks.
  let checkboxSeen = 0

  // Buffers for the two multi-line blocks we assemble as we scan.
  let paragraph: string[] = []
  let list: ListItem[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const text = paragraph.join(' ')
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>)
    paragraph = []
  }

  const flushList = () => {
    if (!list.length) return
    const ordered = list[0].ordered
    const items = list.map((item, i) => {
      const text = renderInline(item.text, `l${blocks.length}-${i}`)
      if (item.checked === undefined) return <li key={i}>{text}</li>
      // Ordinals are assigned here rather than at parse time because this is the
      // only place that knows the emission order survived the list-splitting
      // above (a marker change starts a new <ul>, but not a new document).
      const ordinal = checkboxBase + checkboxSeen++
      return (
        <li key={i} className="plan-md__task-item">
          <label className="plan-md__task-label">
            <input
              type="checkbox"
              className="plan-md__checkbox"
              checked={item.checked}
              disabled={!onToggleCheckbox || busy}
              onChange={e => onToggleCheckbox?.(ordinal, e.target.checked)}
            />
            <span>{text}</span>
          </label>
        </li>
      )
    })
    blocks.push(
      ordered ? (
        <ol key={`l-${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`l-${blocks.length}`}>{items}</ul>
      )
    )
    list = []
  }

  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++])
      blocks.push(
        <pre key={`c-${blocks.length}`} className="plan-md__code">
          <code>{code.join('\n')}</code>
        </pre>
      )
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    const subheading = SUBHEADING.exec(line)
    if (subheading) {
      flush()
      blocks.push(
        <h4 key={`h-${blocks.length}`} className="plan-md__subheading">
          {renderInline(subheading[2], `h${blocks.length}`)}
        </h4>
      )
      continue
    }

    const ordered = ORDERED.exec(line)
    const bullet = ordered ? null : BULLET.exec(line)
    if (ordered || bullet) {
      flushParagraph()
      const isOrdered = !!ordered
      // A list that switches marker type is two lists, not one.
      if (list.length && list[0].ordered !== isOrdered) flushList()
      const raw = (ordered ? ordered[3] : (bullet?.[2] ?? '')).trim()
      const box = CHECKBOX.exec(raw)
      list.push(
        box
          ? { text: box[2], ordered: isOrdered, checked: box[1] !== ' ' }
          : { text: raw, ordered: isOrdered }
      )
      continue
    }

    // An indented line directly under a list item continues that item — plans
    // wrap long questions across lines and they must not split into paragraphs.
    if (list.length && /^\s+\S/.test(line)) {
      list[list.length - 1].text += ` ${line.trim()}`
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flush()
  return <div className="plan-md">{blocks}</div>
}
