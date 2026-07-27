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
 */

import React from 'react'

const FENCE = /^\s*(?:```|~~~)(.*)$/
const SUBHEADING = /^(#{3,})\s+(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
/** Inline code, then bold, then emphasis — code first so `**` inside it is literal. */
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g

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
}

export function PlanMarkdown({ body }: { body: string }) {
  const lines = body.split('\n')
  const blocks: React.ReactNode[] = []

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
    const items = list.map((item, i) => (
      <li key={i}>{renderInline(item.text, `l${blocks.length}-${i}`)}</li>
    ))
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
      list.push({ text: (ordered ? ordered[3] : (bullet?.[2] ?? '')).trim(), ordered: isOrdered })
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
