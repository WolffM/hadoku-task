/**
 * A tracker board: a card per tracker (count or latest value, today / 7-day
 * figures, and the controls to change it) plus the board's history log.
 *
 * Reads and writes go straight to the server. The board re-reads every 30s
 * while visible, and on focus, so a hit from somewhere else (another device,
 * later a physical button) shows up without a reload.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { ConfirmModal } from '../modals/ConfirmModal'
import { TrackerCard } from './TrackerCard'
import { TrackerHistory } from './TrackerHistory'
import { AddTrackerForm } from './AddTrackerForm'
import type { TrackerApi } from '../../api/trackers'
import type { Tracker, TrackerBoardData, TrackerEntry, TrackerKind } from '../../domain/trackers'

const POLL_MS = 30_000

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
    } catch (err) {
      report(err)
    }
  }

  const undoEntry = async (entry: TrackerEntry) => {
    try {
      const t = await api.deleteEntry(boardRef, entry.trackerId, entry.id)
      applyTracker(t, es => es.filter(e => e.id !== entry.id))
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
  return (
    <div className="tracker-board" data-testid="tracker-board">
      {loadError && (
        <div className="tracker-board__status tracker-board__status--error" role="alert">
          Showing the last good copy — refresh failed: {loadError}
        </div>
      )}
      <div className="tracker-grid">
        {trackers.map(t => (
          <TrackerCard
            key={t.id}
            tracker={t}
            entries={entries}
            now={now}
            canWrite={canWrite}
            onLog={body => void logEntry(t, body)}
            onRename={patch => void renameTracker(t, patch)}
            onDelete={() => {
              setDeleteError(null)
              setConfirmDelete(t)
            }}
          />
        ))}
        {canWrite && <AddTrackerForm onAdd={addTracker} />}
        {trackers.length === 0 && !canWrite && (
          <div className="tracker-board__status">Nothing is tracked on this board yet.</div>
        )}
      </div>

      <TrackerHistory
        trackers={trackers}
        entries={entries}
        now={now}
        canWrite={canWrite}
        onUndo={e => void undoEntry(e)}
      />

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
