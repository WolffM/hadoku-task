/**
 * A board's widgets: a strip of tiles above the lanes. Two kinds, each shown
 * only to a tier that can use it:
 *
 *   - trackers (wife+): one tap on a tile's button logs, a tap anywhere else
 *     opens the tracker; an undo bar follows each log.
 *   - sequences (member+, where boards are stored): the tile's button is Play,
 *     which opens the player paused; elsewhere opens the widget's runs.
 *
 * Reads and writes go straight to the server. The strip re-reads every 30s
 * while visible, and on focus, so a hit from somewhere else (another device,
 * later a physical button, a run on a phone) shows up without a reload.
 *
 * With no widgets it renders nothing but the "Add a widget" dialog when asked
 * for it, and reports its count so the board can stop mounting it.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { ConfirmModal } from '../modals/ConfirmModal'
import { TrackerTile } from './TrackerTile'
import { TrackerDetail } from './TrackerDetail'
import { ReadingDialog } from './ReadingDialog'
import { AddTrackerDialog } from './AddTrackerDialog'
import type { TrackerApi } from '../../api/trackers'
import type { SequenceApi } from '../../api/sequences'
import type { SequenceBoardData, SequenceSummary, SequenceWidget } from '../../domain/sequences'
import { SequenceTile } from '../sequences/SequenceTile'
import { SequenceDetail } from '../sequences/SequenceDetail'
import {
  LazySequenceLibrary,
  LazySequencePlayer,
  preloadSequences
} from '../sequences/LazySequences'
import {
  counterTotalSince,
  describeEntry,
  formatTrackerNumber,
  startOfLocalDay
} from '../../domain/trackerStats'
import type { Tracker, TrackerBoardData, TrackerEntry, TrackerKind } from '../../domain/trackers'

const POLL_MS = 30_000
/** How long the undo bar stays after a log. */
const UNDO_MS = 6_000

export interface TrackerStripProps {
  /** The board reference: the slug for an own board, the handle for a shared one. */
  boardRef: string
  api: TrackerApi
  sequenceApi: SequenceApi
  /** The caller's tier can use trackers (wife+). */
  trackersEnabled: boolean
  /** The caller's tier can use sequence widgets (member+). */
  sequencesEnabled: boolean
  onError: (message: string) => void
  /** Show the "Add a widget" dialog. */
  adding: boolean
  /** The dialog closed (added or cancelled). */
  onAddingDone: () => void
  /** How many widgets the board holds, each time that is known. */
  onCount: (count: number) => void
}

/** Keep whichever copy of a tracker the server touched last — out-of-order replies can't roll it back. */
function newer(a: Tracker, b: Tracker): Tracker {
  return Date.parse(b.updatedAt) >= Date.parse(a.updatedAt) ? b : a
}

export function TrackerStrip({
  boardRef,
  api,
  sequenceApi,
  trackersEnabled,
  sequencesEnabled,
  onError,
  adding,
  onAddingDone,
  onCount
}: TrackerStripProps) {
  const [data, setData] = React.useState<TrackerBoardData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => new Date())
  const [confirmDelete, setConfirmDelete] = React.useState<Tracker | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [readingFor, setReadingFor] = React.useState<Tracker | null>(null)
  const [lastLogged, setLastLogged] = React.useState<TrackerEntry | null>(null)
  const undoTimer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  const [seqData, setSeqData] = React.useState<SequenceBoardData | null>(null)
  const [addMode, setAddMode] = React.useState<'tracker' | 'sequence'>('tracker')
  const [playing, setPlaying] = React.useState<SequenceWidget | null>(null)
  const [openWidgetId, setOpenWidgetId] = React.useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = React.useState<SequenceWidget | null>(null)
  const [removeError, setRemoveError] = React.useState<string | null>(null)

  // Known once every kind this tier sees has loaded.
  const count =
    (trackersEnabled && !data) || (sequencesEnabled && !seqData)
      ? undefined
      : (data?.trackers.length ?? 0) + (seqData?.widgets.length ?? 0)
  React.useEffect(() => {
    if (count !== undefined) onCount(count)
  }, [count, onCount])

  const load = React.useCallback(async () => {
    const results = await Promise.allSettled([
      trackersEnabled ? api.list(boardRef).then(setData) : null,
      sequencesEnabled ? sequenceApi.listWidgets(boardRef).then(setSeqData) : null
    ])
    const failed = results.find(r => r.status === 'rejected')
    setLoadError(failed ? ((failed.reason as Error).message ?? String(failed.reason)) : null)
    setNow(new Date())
  }, [api, sequenceApi, boardRef, trackersEnabled, sequencesEnabled])

  const widgetCount = seqData?.widgets.length ?? 0
  React.useEffect(() => {
    // A board with sequences: fetch the player now, so Play doesn't wait on it.
    if (widgetCount > 0) void preloadSequences().catch(() => undefined)
  }, [widgetCount])

  React.useEffect(() => {
    setData(null)
    setSeqData(null)
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
      // Added before the first list landed: that list may predate the add.
      if (!data) void load()
      // Now, not from the count effect: the dialog's close lands in this same
      // render, and a board that showed the strip only for the add would unmount
      // it before the effect could say there is a tracker to show.
      onCount((data?.trackers.length ?? 0) + (seqData?.widgets.length ?? 0) + 1)
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

  const addWidget = async (seq: SequenceSummary) => {
    try {
      const w = await sequenceApi.addWidget(boardRef, seq.id)
      setSeqData(d => d && { ...d, widgets: [...d.widgets, w] })
      if (!seqData) void load()
      onCount((data?.trackers.length ?? 0) + (seqData?.widgets.length ?? 0) + 1)
      return true
    } catch (err) {
      report(err)
      return false
    }
  }

  const applyWidget = (w: SequenceWidget) =>
    setSeqData(d => d && { ...d, widgets: d.widgets.map(x => (x.id === w.id ? w : x)) })

  const updateWidget = async (w: SequenceWidget) => {
    try {
      applyWidget(await sequenceApi.repinWidget(boardRef, w.id, w.sequence.latestVersion))
    } catch (err) {
      report(err)
    }
  }

  const removeWidget = async () => {
    if (!confirmRemove) return
    try {
      await sequenceApi.removeWidget(boardRef, confirmRemove.id)
      const id = confirmRemove.id
      setSeqData(d => d && { ...d, widgets: d.widgets.filter(w => w.id !== id) })
      setConfirmRemove(null)
      setRemoveError(null)
      setOpenWidgetId(null)
    } catch (err) {
      setRemoveError((err as Error).message)
    }
  }

  const closeAdd = () => {
    setAddMode('tracker')
    onAddingDone()
  }
  const showTrackerForm = adding && trackersEnabled && addMode === 'tracker'
  const addDialog = adding && (
    <>
      {showTrackerForm && (
        <AddTrackerDialog
          onAdd={addTracker}
          onClose={closeAdd}
          onChooseSequence={sequencesEnabled ? () => setAddMode('sequence') : undefined}
        />
      )}
      {!showTrackerForm && sequencesEnabled && (
        <LazySequenceLibrary
          api={sequenceApi}
          onError={onError}
          onPick={addWidget}
          onClose={closeAdd}
        />
      )}
    </>
  )

  const anyLoaded = data !== null || seqData !== null
  // Until the first list lands there is nothing to draw — no placeholder row —
  // but an add the user asked for opens now, not after the fetch.
  if (!anyLoaded && !loadError) return addDialog || null
  if (!anyLoaded) {
    return (
      <>
        <section className="tracker-strip" aria-label="Trackers" data-testid="tracker-strip">
          <div className="tracker-strip__status tracker-strip__status--error" role="alert">
            Couldn't load this board's widgets: {loadError}
            <button type="button" className="tracker-btn" onClick={() => void load()}>
              <Icon name="refresh" /> Retry
            </button>
          </div>
        </section>
        {addDialog}
      </>
    )
  }

  const trackers = data?.trackers ?? []
  const entries = data?.entries ?? []
  const widgets = seqData?.widgets ?? []
  const runs = seqData?.runs ?? []
  const canWrite = (data ?? seqData)?.canWrite ?? false
  if (trackers.length === 0 && widgets.length === 0) return addDialog || null

  const byId = new Map(trackers.map(t => [t.id, t]))
  const opened = openId ? byId.get(openId) : undefined
  const lastTracker = lastLogged ? byId.get(lastLogged.trackerId) : undefined
  const openWidget = openWidgetId ? widgets.find(w => w.id === openWidgetId) : undefined
  const runsOf = (w: SequenceWidget) => runs.filter(r => r.widgetId === w.id)
  const title = widgets.length === 0 ? 'Trackers' : trackers.length === 0 ? 'Sequences' : 'Widgets'

  return (
    <section className="tracker-strip" aria-label={title} data-testid="tracker-strip">
      <h2 className="tracker-strip__title">{title}</h2>
      {loadError && (
        <div className="tracker-strip__status tracker-strip__status--error" role="alert">
          Showing the last good copy — refresh failed: {loadError}
        </div>
      )}

      <div className="tracker-strip__row">
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
        {widgets.map(w => (
          <SequenceTile
            key={w.id}
            widget={w}
            runs={runsOf(w)}
            now={now}
            canPlay
            onPlay={() => setPlaying(w)}
            onOpen={() => setOpenWidgetId(w.id)}
          />
        ))}
      </div>

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

      {openWidget && (
        <SequenceDetail
          widget={openWidget}
          runs={runsOf(openWidget)}
          now={now}
          canWrite={canWrite}
          onPlay={() => {
            setOpenWidgetId(null)
            setPlaying(openWidget)
          }}
          onUpdate={() => void updateWidget(openWidget)}
          onRemove={() => {
            setRemoveError(null)
            setConfirmRemove(openWidget)
          }}
          onClose={() => setOpenWidgetId(null)}
        />
      )}

      {playing && (
        <LazySequencePlayer
          sequence={playing.sequence}
          api={sequenceApi}
          // A read-only grantee plays too; the run is theirs, not logged on the board.
          board={canWrite ? { ref: boardRef, widgetId: playing.id } : undefined}
          onError={onError}
          onRunEnded={() => void load()}
          onClose={() => setPlaying(null)}
        />
      )}

      {addDialog}

      <ConfirmModal
        isOpen={confirmRemove !== null}
        title="Remove sequence?"
        message={
          <>
            <strong>{confirmRemove?.sequence.name}</strong> comes off this board. It stays in the
            library, and past runs stay in each person's history.
          </>
        }
        confirmLabel="Remove"
        error={removeError}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={removeWidget}
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
    </section>
  )
}
