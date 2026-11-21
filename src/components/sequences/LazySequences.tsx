/**
 * The sequence player and the exercise library, in their own chunk.
 *
 * Neither is needed to draw a board — a sequence tile is a few lines in the
 * widget strip's chunk — so the player, the builders and the library load
 * only when one is opened. `preloadSequences()` lets the strip start the fetch
 * as soon as a board shows a sequence, so pressing Play doesn't wait.
 *
 * Like the strip, a stale tab can lack the chunk after a deploy; the boundary
 * turns that into a reload prompt instead of a blank dialog.
 */
import { lazy, Suspense, type ComponentProps } from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import { ErrorBoundary } from '../ErrorBoundary'

let chunk: Promise<typeof import('./SequencesChunk')> | undefined

export function preloadSequences() {
  chunk ??= import('./SequencesChunk').catch((err: unknown) => {
    chunk = undefined
    throw err
  })
  return chunk
}

const Player = lazy(() => preloadSequences().then(m => ({ default: m.SequencePlayer })))
const Library = lazy(() => preloadSequences().then(m => ({ default: m.SequenceLibrary })))

function Fallback({ onClose }: { onClose: () => void }) {
  return (
    <Modal isOpen title="Couldn't load" onClose={onClose} actions={null}>
      <p className="sequence-form__error" role="alert">
        The app may have been updated since this page loaded.
        <button type="button" className="sequence-btn" onClick={() => window.location.reload()}>
          <Icon name="refresh" /> Reload
        </button>
      </p>
    </Modal>
  )
}

export function LazySequencePlayer(props: ComponentProps<typeof Player>) {
  return (
    <ErrorBoundary fallback={<Fallback onClose={props.onClose} />}>
      <Suspense fallback={null}>
        <Player {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}

export function LazySequenceLibrary(props: ComponentProps<typeof Library>) {
  return (
    <ErrorBoundary fallback={<Fallback onClose={props.onClose} />}>
      <Suspense fallback={null}>
        <Library {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
