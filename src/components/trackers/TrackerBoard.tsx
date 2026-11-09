/**
 * A tracker board: a tile per tracker (one tap on its button logs, a tap
 * anywhere else opens the tracker), an undo bar after each log, and today's
 * entries across every tracker. Each tracker's full history is in its detail.
 *
 * Reads and writes go straight to the server. The board re-reads every 30s
 * while visible, and on focus, so a hit from somewhere else (another device,
 * later a physical button) shows up without a reload.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { ConfirmModal } from '../modals/ConfirmModal'
import { TrackerTile } from './TrackerTile'
import { TrackerDetail } from './TrackerDetail'
import { ReadingDialog } from './ReadingDialog'
import { AddTrackerDialog } from './AddTrackerDialog'
import type { TrackerApi } from '../../api/trackers'
import {
  counterTotalSince,
  describeEntry,
  formatClock,
  formatTrackerNumber,
  startOfLocalDay
} from '../../domain/trackerStats'
import type { Tracker, TrackerBoardData, TrackerEntry, TrackerKind } from '../../domain/trackers'

const POLL_MS = 30_000
/** How long the undo bar stays after a log. */
const UNDO_MS = 6_000
/** Today's list shows this many until expanded. */
const TODAY_SHOWN = 8

export interface TrackerBoardProps {
  /** The board reference: the slug for an own board, the handle for a shared one. */
  boardRef: string
  boardName: string
  api: TrackerApi
  onError: (message: string) => void
}

/** Keep whichever copy of a tracker the server touched last — out-of-order replies can't roll it back. */
function newer(a: Tracker, b: Tracker): Tracker {
  return Date.parse(b.updatedAt) >= Date.parse(a.updatedAt) ? b : a
}

export function TrackerBoard({ boardRef, boardName, api, onError }: TrackerBoardProps) {
  const [data, setData] = React.useState<TrackerBoardData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => new Date())
  const [confirmDelete, setConfirmDelete] = React.useState<Tracker | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [readingFor, setReadingFor] = React.useState<Tracker | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [lastLogged, setLastLogged] = React.useState<TrackerEntry | null>(null)
  const [allToday, setAllToday] = React.useState(false)
  const undoTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  const load = React.useCallback(async () => {
    try {
      const fresh = await api.list(boardRef)
      setData(fresh)
      setLoadError(null)
      setNow(new Date())
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [api, boardRef])

  React.useEffect(() => {
    setData(null)
    void load()
    const tick = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const id = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [load])

  const applyTracker = (t: Tracker, entries?: (e: TrackerEntry[]) => TrackerEntry[]) =>
    setData(
      d =>
        d && {
          ...d,
          trackers: d.trackers.map(x => (x.id === t.id ? newer(x, t) : x)),
          entries: entries ? entries(d.entries) : d.entries
        }
    )

  const report = (err: unknown) => onError((err as Error).message)

  const logEntry = async (tracker: Tracker, body: { delta?: number; value?: number }) => {
    try {
      const { tracker: t, entry } = await api.logEntry(boardRef, tracker.id, body)
      applyTracker(t, es => [entry, ...es])
      setNow(new Date())
      setLastLogged(entry)
      window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setLastLogged(null), UNDO_MS)
    } catch (err) {
      report(err)
    }
  }

  const undoEntry = async (entry: TrackerEntry) => {
    try {
      const t = await api.deleteEntry(boardRef, entry.trackerId, entry.id)
      applyTracker(t, es => es.filter(e => e.id !== entry.id))
      setLastLogged(last => (last?.id === entry.id ? null : last))
    } catch (err) {
      report(err)
    }
  }

  const addTracker = async (input: { name: string; kind: TrackerKind; unit: string | null }) => {
    try {
      const t = await api.createTracker(boardRef, input)
      setData(d => d && { ...d, trackers: [...d.trackers, t] })
      return true
    } catch (err) {
      report(err)
      return false
    }
  }

  const renameTracker = async (tracker: Tracker, patch: { name: string; unit: string | null }) => {
    try {
      applyTracker(await api.updateTracker(boardRef, tracker.id, patch))
    } catch (err) {
      report(err)
    }
  }

  const deleteTracker = async () => {
    if (!confirmDelete) return
    try {
      await api.deleteTracker(boardRef, confirmDelete.id)
      const id = confirmDelete.id
      setData(
        d =>
          d && {
            ...d,
            trackers: d.trackers.filter(t => t.id !== id),
            entries: d.entries.filter(e => e.trackerId !== id)
          }
      )
      setConfirmDelete(null)
      setDeleteError(null)
      setOpenId(null)
    } catch (err) {
      setDeleteError((err as Error).message)
    }
  }

  if (!data) {
    return (
      <div className="tracker-board" data-testid="tracker-board">
        {loadError ? (
          <div className="tracker-board__status tracker-board__status--error" role="alert">
            Couldn't load {boardName}: {loadError}
            <button type="button" className="tracker-btn" onClick={() => void load()}>
              <Icon name="refresh" /> Retry
            </button>
          </div>
        ) : (
          <div className="tracker-board__status">Loading trackers…</div>
        )}
      </div>
    )
  }

  const { canWrite, trackers, entries } = data
  const byId = new Map(trackers.map(t => [t.id, t]))
  const opened = openId ? byId.get(openId) : undefined
  const todayStart = startOfLocalDay(now).getTime()
  const todays = entries
    .filter(e => byId.has(e.trackerId) && Date.parse(e.at) >= todayStart)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const lastTracker = lastLogged ? byId.get(lastLogged.trackerId) : undefined

  return (
    <div className="tracker-board" data-testid="tracker-board">
      {loadError && (
        <div className="tracker-board__status tracker-board__status--error" role="alert">
          Showing the last good copy — refresh failed: {loadError}
        </div>
      )}

      {canWrite && (
        <div className="tracker-board__bar">
          <button type="button" className="tracker-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" /> New tracker
          </button>
        </div>
      )}

      {trackers.length === 0 ? (
        <div className="tracker-board__status">
          {canWrite
            ? 'Nothing tracked yet. Add a tracker to start counting.'
            : 'Nothing is tracked on this board yet.'}
        </div>
      ) : (
        <div className="tracker-grid">
          {trackers.map(t => (
            <TrackerTile
              key={t.id}
              tracker={t}
              entries={entries}
              now={now}
              canWrite={canWrite}
              onIncrement={() => void logEntry(t, { delta: 1 })}
              onLogReading={() => setReadingFor(t)}
              onOpen={() => setOpenId(t.id)}
            />
          ))}
        </div>
      )}

      {lastLogged && lastTracker && (
        <div className="tracker-undo" role="status" data-testid="tracker-undo">
          <span className="tracker-undo__text">
            {lastTracker.name} {describeEntry(lastLogged, lastTracker.unit)}
            {lastTracker.kind === 'counter' &&
              ` · ${formatTrackerNumber(counterTotalSince(entries, lastTracker.id, startOfLocalDay(now)))} today`}
          </span>
          <button
            type="button"
            className="tracker-btn tracker-btn--primary"
            onClick={() => void undoEntry(lastLogged)}
          >
            Undo
          </button>
        </div>
      )}

      <section className="tracker-today" aria-label="Today">
        <h3 className="tracker-today__title">Today</h3>
        {todays.length === 0 ? (
          <p className="tracker-today__empty">Nothing logged today.</p>
        ) : (
          <ol className="tracker-today__list">
            {(allToday ? todays : todays.slice(0, TODAY_SHOWN)).map(e => {
              const t = byId.get(e.trackerId) as Tracker
              return (
                <li key={e.id} className="tracker-today__item" data-testid="tracker-today-item">
                  <time className="tracker-today__time" dateTime={e.at}>
                    {formatClock(e.at)}
                  </time>
                  <button
                    type="button"
                    className="tracker-today__name"
                    onClick={() => setOpenId(t.id)}
                  >
                    {t.name}
                  </button>
                  <span className="tracker-today__change">{describeEntry(e, t.unit)}</span>
                  {e.source === 'button' && (
                    <span className="tracker-today__source" title="From a button">
                      <Icon name="zap" />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {todays.length > TODAY_SHOWN && (
          <button type="button" className="tracker-btn" onClick={() => setAllToday(a => !a)}>
            {allToday ? 'Show fewer' : `Show all ${todays.length}`}
          </button>
        )}
      </section>

      {opened && (
        <TrackerDetail
          tracker={opened}
          entries={entries}
          now={now}
          canWrite={canWrite}
          onLog={body => void logEntry(opened, body)}
          onUndo={e => void undoEntry(e)}
          onRename={patch => void renameTracker(opened, patch)}
          onDelete={() => {
            setDeleteError(null)
            setConfirmDelete(opened)
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      {readingFor && (
        <ReadingDialog
          tracker={readingFor}
          onLog={value => void logEntry(readingFor, { value })}
          onClose={() => setReadingFor(null)}
        />
      )}

      {adding && <AddTrackerDialog onAdd={addTracker} onClose={() => setAdding(false)} />}

      <ConfirmModal
        isOpen={confirmDelete !== null}
        title="Delete tracker?"
        message={
          <>
            <strong>{confirmDelete?.name}</strong> and its whole history will be deleted.
          </>
        }
        confirmLabel="Delete"
        error={deleteError}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={deleteTracker}
      />
    </div>
  )
}
