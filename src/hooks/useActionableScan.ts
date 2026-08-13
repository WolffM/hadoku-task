/**
 * "Automate open items" (§5.6) — scan a board's repo on load, offer what's new.
 *
 * The shape of this hook follows from one constraint: the scan is a network call
 * a person didn't ask for, made while their board is loading. So it runs only
 * where it can possibly produce a button (an automation board, with a repo, that
 * this viewer can write to), it never blocks or fails a render, and an outage
 * shows nothing rather than a wrong "0 items".
 *
 * Dedup is against the board ALREADY in memory — no second request — which is
 * also the whole idempotency story: an item that has a task isn't offered, so a
 * double-click, a reload, or two tabs can't duplicate anything. See
 * `newActionableItems`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionableItem, ActionableScan, Board, Task } from '../domain/types'
import { actionableNotes, newActionableItems } from '../domain/utils/actionable'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'

export interface UseActionableScanProps {
  /** The board on screen. Undefined while boards are still loading. */
  board: Board | undefined
  /** Every task on that board, completed included (see newActionableItems). */
  tasks: Task[]
  userType: string
  listActionable: (boardRef: string) => Promise<ActionableScan>
  /** Creates tasks verbatim — no `#tag` parsing (titles contain `#42`). */
  createTasks: (items: Array<{ title: string; notes?: string | null }>) => Promise<number>
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void
}

export interface ActionableScanState {
  /** Items with no task yet. 0 ⇒ render no button. */
  count: number
  /** A run is in flight, or this scan's items have all been created. */
  disabled: boolean
  automate: () => Promise<void>
}

export function useActionableScan({
  board,
  tasks,
  userType,
  listActionable,
  createTasks,
  onShowToast
}: UseActionableScanProps): ActionableScanState {
  const [items, setItems] = useState<ActionableItem[]>([])
  const [busy, setBusy] = useState(false)
  // Sticks until the next scan. The count usually drops to zero on its own once
  // the created tasks land, but that repaint is a round-trip away and the button
  // must not stay clickable in between.
  const [done, setDone] = useState(false)

  const ref = board?.handle ?? board?.id
  // Every condition that must hold for the scan to be worth a request. `access`
  // is absent on boards that predate sharing, which means owner.
  const eligible =
    userType !== 'public' &&
    !!ref &&
    board?.mode === 'automation' &&
    !!board?.repo?.trim() &&
    board?.access !== 'readonly'

  useEffect(() => {
    setItems([])
    setDone(false)
    if (!eligible || !ref) return
    let cancelled = false
    void listActionable(ref)
      .then(scan => {
        if (cancelled) return
        // ok:false is "we don't know" — a provider outage, a missing binding, a
        // 403. Showing nothing is the only honest render; showing "0 items"
        // would claim the backlog is clear when we never saw it.
        if (!scan.ok) {
          if (scan.reason)
            logger.info('[actionable] scan unavailable', { ref, reason: scan.reason })
          return
        }
        setItems(scan.items)
      })
      .catch(err => {
        // listActionable already swallows its own failures; this is the belt for
        // anything the caller's implementation throws.
        logger.warn('[actionable] scan failed', { ref, error: formatError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [eligible, ref, listActionable])

  // Recomputed against live tasks, so the count falls as tasks appear — the
  // button disappears by itself once the board repaints.
  const fresh = useMemo(() => newActionableItems(items, tasks), [items, tasks])

  // The click reads the CURRENT fresh list without making it a dependency of the
  // callback — a handler that changed identity on every task edit would be a new
  // prop on every render for no gain.
  const freshRef = useRef(fresh)
  freshRef.current = fresh

  // The synchronous half of the double-click guard. `busy` disables the button,
  // but only after a render — two clicks in one tick would both read the old
  // state and both create the tasks, and the "already has a task" rule can't
  // help there because neither task exists yet.
  const runningRef = useRef(false)

  const automate = useCallback(async () => {
    const pending = freshRef.current
    if (pending.length === 0 || busy || runningRef.current) return
    runningRef.current = true
    setBusy(true)
    try {
      const created = await createTasks(
        pending.map(item => ({ title: item.suggestedTitle, notes: actionableNotes(item) }))
      )
      // Disable on the way out, not on the way in: a failed run should leave the
      // button clickable, because retrying is the right next move and the
      // idempotency rule makes it safe.
      setDone(true)
      logger.info('[actionable] created tasks from open items', { ref, created })
      onShowToast?.(`Added ${created} task${created === 1 ? '' : 's'} from open items`, 'success')
    } catch (err) {
      logger.error('[actionable] could not create tasks', { ref, error: formatError(err) })
      onShowToast?.('Could not add the open items', 'error')
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [busy, createTasks, onShowToast, ref])

  return { count: fresh.length, disabled: busy || done, automate }
}
