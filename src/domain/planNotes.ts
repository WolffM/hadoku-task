/**
 * Plan-notes shape (the human half of the automation protocol).
 *
 * An agent parks a task in `plan-review` with a plan written into `notes`, and a
 * human reads it and answers there. The provider's contract fixes the shape:
 * markdown, `## ` headings, rewritten wholesale each pass (never appended to),
 * capped at 64 KiB. The canonical headings, in order:
 *
 *   ## What I think you want   ## Questions   ## How we'll know it worked
 *   ## Plan                    ## Settled     ## Blast radius
 *
 * We deliberately do NOT validate against that list. The contract's own rule is
 * "we parse what we wrote and pass through what we didn't" — the human answers
 * however they like, inline under Questions or dumped at the top. So this module
 * only splits on headings and flags which section is Questions; anything else
 * (unknown headings, a bare paragraph before the first heading) survives
 * untouched. Notes that aren't plan-shaped at all come back as one preamble
 * section, which renders exactly like the plain body it is.
 */

export interface PlanSection {
  /** Heading text with `## ` stripped. Empty string for the pre-heading preamble. */
  title: string
  /** Everything under the heading, up to the next one. Trailing blank lines trimmed. */
  body: string
  /** The one section that asks something of the human. */
  isQuestions: boolean
}

/** What an agent writes when it has nothing to ask. Matched loosely, on purpose. */
const NO_QUESTIONS = /^no open questions\.?$/i

/** `## Heading` — two-or-more hashes, so `###` sub-headings stay inside a section. */
const HEADING = /^(#{2,})\s+(.*)$/

/** ``` or ~~~ opening/closing a fenced block. */
const FENCE = /^\s*(```|~~~)/

/** `- item`, `* item`, `+ item`, `1. item`, `1) item`. */
const LIST_ITEM = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/

function isQuestionsHeading(title: string): boolean {
  // Tolerate "Questions:", "Open questions", "## questions" — the heading is
  // written by an agent each pass and a strict match would silently lose the
  // one section the human is here for.
  return /^(?:open\s+)?questions\b/i.test(title.trim())
}

/**
 * Strip a leading list marker and surrounding `*`/`_` emphasis so the "no open
 * questions" sentinel is recognized regardless of the markdown an agent wraps
 * it in — e.g. `_No open questions._` or `- No open questions.`. Mirrors the
 * tolerant-heading pattern above: written each pass by an agent, so a strict
 * match would silently miscount.
 */
function stripSentinelMarkup(text: string): string {
  let s = text.trim()
  const listMatch = LIST_ITEM.exec(s)
  if (listMatch) s = s.slice(listMatch[0].length).trim()
  const emphasisMatch = /^(\*{1,3}|_{1,3})([\s\S]*)\1$/.exec(s)
  if (emphasisMatch) s = emphasisMatch[2].trim()
  return s
}

/**
 * Split a plan into its `## ` sections. Content before the first heading becomes
 * a leading section with an empty title. Never throws, never drops input.
 */
export function parsePlanNotes(notes: string | null | undefined): PlanSection[] {
  if (!notes) return []

  const sections: PlanSection[] = []
  let title = ''
  let lines: string[] = []
  let inFence = false

  const flush = () => {
    const body = lines.join('\n').replace(/\s+$/, '')
    // Drop only a wholly empty preamble; an empty *named* section is meaningful
    // (an empty Questions section is the "nothing to answer" signal).
    if (title || body) sections.push({ title, body, isQuestions: isQuestionsHeading(title) })
    lines = []
  }

  for (const line of notes.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence
    const heading = inFence ? null : HEADING.exec(line)
    // Only `##` starts a section; `###` and deeper belong to the current one.
    if (heading && heading[1].length === 2) {
      flush()
      title = heading[2].trim()
      continue
    }
    lines.push(line)
  }
  flush()

  return sections
}

/** The Questions section, if the plan has one. */
export function questionsSection(sections: PlanSection[]): PlanSection | undefined {
  return sections.find(s => s.isQuestions)
}

/**
 * Group a section body into list items, folding each item's wrapped
 * continuation lines back into it, and pull out a trailing reply paragraph if
 * one follows the list after a blank line.
 *
 * `appendAnswerToNotes` always inserts a human's reply as its own
 * blank-line-separated paragraph after the question list — never as another
 * list item, never glued onto one with a wrapped-line continuation. So a
 * non-list line immediately following an item (no blank line between) is a
 * wrapped continuation of that item, same as before; but once a blank line has
 * been seen after the list, a non-list line starts (or continues) the reply
 * block instead of merging into the last item. Text before the first marker is
 * still its own item, so a prose-only section counts as something.
 */
function parseQuestionsBody(body: string): { items: string[]; reply: string | undefined } {
  const items: string[] = []
  let reply: string[] | undefined
  let blankSinceLastItem = false

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (items.length) blankSinceLastItem = true
      continue
    }
    if (LIST_ITEM.test(line)) {
      items.push(trimmed)
      blankSinceLastItem = false
      reply = undefined
      continue
    }
    if (items.length && blankSinceLastItem) {
      ;(reply ??= []).push(trimmed)
    } else if (items.length) {
      items[items.length - 1] += ` ${trimmed}`
    } else {
      items.push(trimmed)
    }
  }

  return { items: items.filter(Boolean), reply: reply?.join(' ') }
}

/**
 * How many things the plan is waiting on a human for — the number behind the
 * badge on the card and in the popout header.
 *
 * The wrinkle is that a human's answer is appended into this same section (the
 * protocol takes free text anywhere, so there is no marker separating the two),
 * and a naively counted answer reads as another question. Since the count is the
 * one signal that says "you are needed here", counting a reply as a question
 * makes it lie in exactly the direction that erodes trust in it.
 *
 * So: when the section asks anything with a question mark, only the items
 * bearing one count, which excludes a typical answer. When nothing in the
 * section has a `?` at all, the questions are phrased imperatively ("Confirm the
 * repo.") and every item counts. The "No open questions." sentinel is 0.
 *
 * Once a reply paragraph trails the list (see `parseQuestionsBody`), the
 * question(s) it answers are done — the count goes to 0 rather than nagging
 * forever. `questionsAnswered` is the signal for what to show instead.
 *
 * It cannot be exact — free text is the point — but it errs toward the count
 * going quiet once you have answered rather than nagging forever.
 */
export function openQuestionCount(sections: PlanSection[]): number {
  const section = questionsSection(sections)
  if (!section) return 0

  const body = section.body.trim()
  if (!body || NO_QUESTIONS.test(stripSentinelMarkup(body))) return 0

  const { items, reply } = parseQuestionsBody(body)
  if (reply !== undefined) return 0

  if (!items.some(item => item.includes('?'))) return items.length
  return items.filter(item => item.includes('?')).length
}

/**
 * True once a human has replied to a Questions section that actually asked
 * something — the signal behind the "Answered questions" badge, which takes
 * over from "N open questions" the moment a reply lands and reverts the moment
 * a replan rewrites the section with a fresh, un-replied list.
 */
export function questionsAnswered(sections: PlanSection[]): boolean {
  const section = questionsSection(sections)
  if (!section) return false

  const body = section.body.trim()
  if (!body || NO_QUESTIONS.test(stripSentinelMarkup(body))) return false

  const { items, reply } = parseQuestionsBody(body)
  return items.length > 0 && reply !== undefined
}

/**
 * Put the human's answer into the notes, under `## Questions` when there is one.
 *
 * Appending is safe despite the doc being rewritten each pass: the agent reads
 * the whole body, folds answers into `## Settled`, and emits a fresh document.
 * Placing the text under Questions keeps an answer next to what it answers; with
 * no Questions section we fall back to the end of the doc, which the contract
 * explicitly allows ("a sentence dumped at the top" is equally valid). No
 * marker, no prefix, no imposed format — constraining the reply is the one thing
 * the protocol asks us not to do.
 */
export function appendAnswerToNotes(notes: string | null | undefined, answer: string): string {
  const reply = answer.trim()
  if (!reply) return notes ?? ''

  const body = notes ?? ''
  if (!body.trim()) return reply

  const lines = body.split('\n')
  let inFence = false
  let questionsStart = -1
  let insertAt = -1

  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence
    if (inFence) continue
    const heading = HEADING.exec(lines[i])
    if (!heading || heading[1].length !== 2) continue

    if (questionsStart >= 0) {
      // First `##` after Questions — the answer goes just above it.
      insertAt = i
      break
    }
    if (isQuestionsHeading(heading[2])) questionsStart = i
  }

  if (questionsStart < 0) return `${body.replace(/\s+$/, '')}\n\n${reply}\n`
  if (insertAt < 0) insertAt = lines.length

  // Trim the blank lines the section already ends with so we control the spacing.
  let end = insertAt
  while (end > questionsStart + 1 && lines[end - 1].trim() === '') end--

  const next = [...lines.slice(0, end), '', reply, '', ...lines.slice(insertAt)]
  return next.join('\n').replace(/\s+$/, '') + '\n'
}
