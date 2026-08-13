/**
 * "Automate open items" — turning a repo's open issues/PRs into tasks (§5.6).
 *
 * The two decisions that need to be identical everywhere they're made:
 *
 *   1. WHICH items are new. Dedup is by title, against the board already in
 *      memory — no extra request, and no metadata on the task to keep in sync.
 *      That is also what makes the button idempotent: an item that has a task is
 *      not offered, so a double-click or a reload can't duplicate anything.
 *   2. WHAT a created task says. The notes are the entire brief the runner gets;
 *      it never sees the ActionableItem.
 *
 * Pure on purpose — asserted directly in src/test/actionable-verify.ts.
 */
import type { ActionableItem, Task } from '../types'

/**
 * The canonical dedup key for an item: `issue:42` / `pr:17`.
 *
 * Kind AND number, because an issue and a PR can share a number in the same repo
 * (GitHub numbers them from one sequence per repo, but nothing in this payload
 * guarantees the provider only ever sends one kind).
 */
export function actionableKey(item: Pick<ActionableItem, 'kind' | 'number'>): string {
  return `${item.kind}:${item.number}`
}

/** "Address #42" / "Address PR #17", the titles the provider suggests and this
 * feature creates. Anchored at the start so a task someone renamed to
 * "Address #42 (blocked on infra)" still counts as covering the item. */
const ADDRESS_TITLE = /^address\s+(pr\s+)?#(\d+)\b/i

/**
 * The item an existing task covers, or null if it doesn't look like one of ours.
 * Reading it off the TITLE is what lets a task created before this feature (or by
 * hand, or by an earlier run) suppress the item just as well as one we created.
 */
export function taskAddressKey(title: string): string | null {
  const m = ADDRESS_TITLE.exec(title.trim())
  if (!m) return null
  return `${m[1] ? 'pr' : 'issue'}:${m[2]}`
}

/**
 * The items with no task on this board yet.
 *
 * Matches on the address key OR the exact suggested title: the key handles the
 * normal case, and the title fallback covers a provider that suggests something
 * other than "Address #N" — without it, such an item would be re-created on
 * every single board load.
 *
 * `tasks` must be EVERY task on the board, completed included. Filtering to
 * active ones would re-offer each item the moment its task was completed, which
 * is precisely when the work is done.
 */
export function newActionableItems(items: ActionableItem[], tasks: Task[]): ActionableItem[] {
  const covered = new Set<string>()
  for (const t of tasks) {
    const title = (t.title ?? '').trim()
    if (!title) continue
    const key = taskAddressKey(title)
    if (key) covered.add(key)
    covered.add(`title:${title.toLowerCase()}`)
  }
  return items.filter(
    i =>
      !covered.has(actionableKey(i)) &&
      !covered.has(`title:${i.suggestedTitle.trim().toLowerCase()}`)
  )
}

/**
 * The task body for an item: where the work is, what it is, and what to do about
 * it. The closing line is an INSTRUCTION rather than a description because it is
 * read by an agent that has to act on it, and "issue" vs "PR" implies two
 * genuinely different first moves — reproduce-then-fix, or check out the branch
 * that already exists and finish it.
 */
export function actionableNotes(item: ActionableItem): string {
  const instruction =
    item.kind === 'pr'
      ? item.headRef
        ? `Check out branch ${item.headRef} and address the outstanding review/CI feedback.`
        : // No head ref is a provider gap, not a reason to ship a task that reads
          // "check out branch undefined". Name the PR and let the runner find it.
          `Check out the branch for PR #${item.number} and address the outstanding review/CI feedback.`
      : 'Reproduce if needed, fix it, and open a PR.'
  return [item.url, item.title, '', item.bodySnippet ?? '', '', instruction]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The button's label. Singular/plural, because "1 open items" is the kind of
 * thing that makes a person distrust the count. */
export function automateLabel(count: number): string {
  return `Automate ${count} open item${count === 1 ? '' : 's'}`
}
