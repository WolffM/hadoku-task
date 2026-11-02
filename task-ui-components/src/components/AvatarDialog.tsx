/**
 * AvatarDialog — the avatar picker in its own dialog, opened from the settings
 * popout's "Change". The popout is 300px wide; the picker (and the cosmetics
 * that will join it) needs the room.
 *
 * Rendered into document.body, so no ancestor of the popout (a transform, an
 * overflow, a stacking context) can clip or trap it. The popout stays open
 * underneath: closing the dialog returns to it, and focus goes back to Change.
 *
 * Styles are inline for the reason AvatarPicker's are: apps compile this
 * package's CSS at their own build, so a new stylesheet rule reaches an app only
 * when it rebuilds. Tokens only.
 */
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AvatarPicker } from './AvatarPicker'

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    // Above the popout's panel (100) and its click-catcher (99).
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    boxSizing: 'border-box',
    padding: '6vh 16px',
    background: 'var(--color-bg-overlay)'
  },
  card: {
    boxSizing: 'border-box',
    width: 'min(720px, 100%)',
    maxHeight: '88vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 20,
    borderRadius: 12,
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18)',
    color: 'var(--color-text)',
    // Outside the app's root, so nothing passes the app's font down to it.
    fontFamily: 'var(--font-family)',
    outline: 'none'
  },
  head: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { margin: 0, flex: 1, fontSize: '1.05rem', fontWeight: 600 }
}

export interface AvatarDialogProps {
  open: boolean
  onClose: () => void
  /** Where focus goes when the dialog closes (the Change button). */
  returnFocus?: React.RefObject<HTMLElement | null>
}

export function AvatarDialog({ open, onClose, returnFocus }: AvatarDialogProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    cardRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Stop it here: closing re-arms the popout's own Escape listener on window
      // (React flushes a keypress's effects at once), and this same keypress
      // would reach it next and close the popout too.
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const back = returnFocus?.current
    return () => {
      document.removeEventListener('keydown', onKey)
      back?.focus()
    }
  }, [open, returnFocus])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div style={S.overlay} onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={S.card}
        onClick={e => e.stopPropagation()}
      >
        <div style={S.head}>
          <h2 id={titleId} style={S.title}>
            Avatar
          </h2>
          <button
            type="button"
            className="settings-popout__btn settings-popout__btn--primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
        <AvatarPicker />
      </div>
    </div>,
    document.body
  )
}
