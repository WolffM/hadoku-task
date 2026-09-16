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

/**
 * TenHands' per-pass bookkeeping footer, which they render as the last line of
 * every plan document:
 *
 *     — pass 1
 *     — pass 2 · confidence 0.8
 *
 * It is THEIR state, not the human's text, and it has to come out before any
 * sectioning happens. `## Questions` is the last section of any plan that
 * proposes no acceptance criteria, so the footer lands inside the Questions
 * body, where `parseQuestionsBody` reads a list, a blank line and then prose —
 * the exact shape of a human's trailing reply. That mis-read is not just a bad
 * badge: it makes `questionsAnswered` true the moment the plan is written, so
 * the false → true transition `notesWriteClosesQuestions` fires the runner wake
 * on never happens, and answering a prose question falls back to the ~15 minute
 * cron instead of the ~18s dispatch. Their own `parse()` has always stripped
 * this for the same reason; the predicates are newer and did not inherit it.
 *
 * Permissive on the VALUES on purpose. TenHands learned on their side that a
 * strict pattern made the whole footer fail to match on a junk confidence, which
 * silently reset the pass counter and let the planning loop run past its cap.
 * So the pass token and everything after a separator are `\S+`/`.*`, while the
 * STRUCTURE stays tight enough that a human sentence starting with a dash
 * ("— pass the buck to legal") is not eaten: the tail must be absent or open
 * with a separator.
 */
const PASS_FOOTER = /^[—–]\s*pass\s+\S+(?:\s*[·•|,]\s*.*)?$/

/**
 * A GitHub-flavoured task-list item: `- [ ] text` / `- [x] text`.
 *
 * Captures the marker+bracket prefix, the box contents, and the text, so a
 * toggle can rewrite ONE character of the original line and leave every other
 * byte — indentation, marker style, spacing — exactly as the agent wrote it.
 */
const TASK_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)(.*)$/

/**
 * The tick state of a list item: `true` ticked, `false` unticked, `null` when the
 * item isn't a task-list item at all. `null` is the interesting case — it is what
 * keeps every existing prose question counting exactly as it did before.
 */
function taskItemState(item: string): boolean | null {
  const m = TASK_ITEM.exec(item)
  if (!m) return null
  return m[2] !== ' '
}

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
    // Drop the emitter's own footer wherever it stands, outside a fence, so it
    // can never be read back as content. Not just a trailing line: when
    // Questions is the LAST section, `appendAnswerToNotes` puts the human's
    // reply AFTER the footer, so a trailing-only rule would stop matching the
    // moment someone answers and fold our bookkeeping into their reply text.
    // Fence-aware like every other line rule here, so a plan quoting the format
    // in a fenced example keeps it.
    if (!inFence && PASS_FOOTER.test(line)) continue
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
 * A TASK-LIST item (`- [ ] Approve this plan`) is counted on its own terms: a
 * reply does not tick a box, so an unticked one keeps counting after the prose
 * questions have gone quiet, and a ticked one never counts at all. Its own state
 * is the answer, which is why it is exempt from both the `?` rule and the reply
 * rule. A section with no task-list items counts exactly as it always did.
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
  const unticked = items.filter(item => taskItemState(item) === false).length
  const prose = items.filter(item => taskItemState(item) === null)

  const openProse =
    reply !== undefined
      ? 0
      : prose.some(item => item.includes('?'))
        ? prose.filter(item => item.includes('?')).length
        : prose.length

  return unticked + openProse
}

/**
 * True once the human has done their part with a Questions section that actually
 * asked something — the signal behind the "Answered questions" badge, which takes
 * over from "N open questions" the moment the section goes quiet and reverts the
 * moment a replan rewrites it with a fresh, un-answered list.
 *
 * "Their part" is two things, and BOTH must hold:
 *   - every task-list item is ticked (an unticked box is an outstanding ask that
 *     no amount of prose answers — ticking it is the answer);
 *   - the prose questions, if there are any, have a reply trailing them.
 *
 * With no task-list items this is byte-for-byte the old rule. It is also the
 * predicate the worker fires the runner wake on (`notifyNotesWrite`), so a tick
 * and a typed reply are the same event to both repos — which is the whole point
 * of not opening a second channel for approval.
 */
export function questionsAnswered(sections: PlanSection[]): boolean {
  const section = questionsSection(sections)
  if (!section) return false

  const body = section.body.trim()
  if (!body || NO_QUESTIONS.test(stripSentinelMarkup(body))) return false

  const { items, reply } = parseQuestionsBody(body)
  if (items.length === 0) return false

  const boxes = items.map(taskItemState).filter((s): s is boolean => s !== null)
  if (boxes.some(ticked => !ticked)) return false

  const prose = items.filter(item => taskItemState(item) === null)
  if (prose.length > 0) return reply !== undefined
  return boxes.length > 0
}

/** One `- [ ] …` / `- [x] …` row, addressed by its position in the document. */
export interface ChecklistItem {
  /**
   * Zero-based position among ALL task-list items in the notes, counted in
   * document order. This is the item's identity for a toggle: the rendered text
   * isn't unique (two `- [ ] Approve this plan` rows are legal) and a line number
   * would shift the moment anything above it is edited.
   */
  ordinal: number
  checked: boolean
  /** The text after the box, with no marker and no brackets. */
  text: string
}

/**
 * Every task-list item in a body, in document order. Fence-aware, so a `- [ ]`
 * inside a fenced example is text, not a checkbox — the same rule
 * `parsePlanNotes` applies to headings.
 *
 * Callers pass either the whole notes or one section body; ordinals are relative
 * to whatever was passed, which is why the popout accumulates a per-section base
 * before handing them to the renderer.
 */
export function checklistItems(body: string | null | undefined): ChecklistItem[] {
  if (!body) return []
  const out: ChecklistItem[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = TASK_ITEM.exec(line)
    if (m) out.push({ ordinal: out.length, checked: m[2] !== ' ', text: m[4].trim() })
  }
  return out
}

/**
 * Tick or untick the nth task-list item, returning the whole document back.
 *
 * Rewrites exactly the one character inside the brackets and copies every other
 * byte through — indentation, marker style, the spacing after the `]`, the
 * trailing newline (or its absence). That is the contract §4 of the v3 design
 * asks for: tapping the box must produce the same bytes a human typing `- [x]`
 * would, so there is one format and one predicate on both sides rather than an
 * approvals table shadowing the notes.
 *
 * An out-of-range ordinal returns the notes unchanged — a stale render that
 * addresses an item a replan has already removed must not corrupt the document.
 */
export function toggleChecklistItem(
  notes: string | null | undefined,
  ordinal: number,
  checked: boolean
): string {
  const body = notes ?? ''
  if (!body) return body
  const lines = body.split('\n')
  let inFence = false
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = TASK_ITEM.exec(lines[i])
    if (!m) continue
    if (seen === ordinal) {
      lines[i] = `${m[1]}${checked ? 'x' : ' '}${m[3]}${m[4]}`
      return lines.join('\n')
    }
    seen++
  }
  return body
}

/**
 * An approval item is a task-list row whose text starts with "Approve" — the
 * shape TenHands' plans end `## Questions` with (`- [ ] Approve this plan`).
 *
 * Matched structurally and case-insensitively on the leading word only, so the
 * wording after it is theirs to change. Scanned across the WHOLE document rather
 * than only the Questions section: the section is where it belongs by
 * convention, but a plan that puts it elsewhere still gets the button, and
 * nothing about approval depends on the heading being spelled right.
 *
 * Returns the first UNTICKED one. Once it is ticked there is nothing to approve
 * and the button goes away — the notes are the only state.
 */
export function pendingApproval(notes: string | null | undefined): ChecklistItem | undefined {
  return checklistItems(notes).find(item => !item.checked && /^approve\b/i.test(item.text))
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
