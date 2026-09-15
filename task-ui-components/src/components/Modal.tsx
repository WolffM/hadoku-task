/**
 * Modal Component
 * Generic modal dialog with keyboard shortcuts and customizable actions
 *
 * Styles ship with the package: import '@wolffm/task-ui-components/modal.css'
 */

import React, { useEffect, useId, useRef } from 'react'

export interface ModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  onConfirm?: () => void | Promise<void>
  children?: React.ReactNode
  inputValue?: string
  onInputChange?: (value: string) => void
  inputPlaceholder?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmDisabled?: boolean
  confirmDanger?: boolean
  showCancel?: boolean
  showConfirm?: boolean
  className?: string
  overlayClassName?: string
  /**
   * Replaces the whole action row. A wizard has Back/Cancel/Regenerate/Create,
   * which the fixed Cancel+Confirm pair cannot express — and that is what
   * pushes an app to hand-roll its own dialog instead of adopting this one.
   *
   * `null` means *no* row at all (a progress step, a viewer); omitting it means
   * "use the default row". `??` collapses those two, so the check below is
   * against `undefined` explicitly.
   */
  actions?: React.ReactNode
  /** Rendered left of the title, e.g. a wizard's Back button. */
  lead?: React.ReactNode
}

/**
 * Open dialogs, outermost first. Each mounted-and-open Modal pushes a token
 * and pops it on close, so the handler can tell whether it is the one the
 * keypress is meant for.
 */
const escapeStack: symbol[] = []

export function Modal({
  isOpen,
  title,
  onClose,
  onConfirm,
  children,
  inputValue,
  onInputChange,
  inputPlaceholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  confirmDanger = false,
  showCancel = true,
  showConfirm = true,
  className = '',
  overlayClassName = '',
  actions,
  lead
}: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  // Escape closes from anywhere in the dialog, not just from a focused input.
  // Bound to the document rather than the card so it works before anything
  // inside has been focused — previously the handler hung off the optional
  // text input, so a dialog without one could not be dismissed by keyboard.
  //
  // Only the TOP-MOST open dialog answers, which is what makes a confirm
  // nested inside another modal usable: the parent's document listener is
  // still live underneath it, so without the stack one Escape closes both.
  // onClose is read through a ref so a caller passing an unmemoised handler
  // cannot re-run this effect and shuffle itself back to the top of the stack.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!isOpen) return
    const id = Symbol('modal')
    escapeStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (escapeStack[escapeStack.length - 1] !== id) return
      e.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = escapeStack.lastIndexOf(id)
      if (at >= 0) escapeStack.splice(at, 1)
    }
  }, [isOpen])

  // Move focus into the dialog on open, so the keyboard starts inside it.
  useEffect(() => {
    if (!isOpen) return
    const card = cardRef.current
    if (!card) return
    const focusable = card.querySelector<HTMLElement>(
      'input:not([type=hidden]), textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
    ;(focusable ?? card).focus()
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className={`modal-overlay ${overlayClassName}`.trim()} onClick={onClose}>
      <div
        ref={cardRef}
        className={`modal-card ${className}`.trim()}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          {lead}
          <h3 id={titleId}>{title}</h3>
        </div>

        {children}

        {onInputChange && (
          <input
            type="text"
            className="modal-input"
            value={inputValue || ''}
            onChange={e => onInputChange(e.target.value)}
            placeholder={inputPlaceholder}
            onKeyDown={e => {
              if (e.key === 'Enter' && !confirmDisabled && onConfirm) {
                e.preventDefault()
                void onConfirm()
              }
            }}
          />
        )}

        {actions !== undefined ? (
          actions
        ) : (
          <div className="modal-actions">
            {showCancel && (
              <button className="modal-button" onClick={onClose}>
                {cancelLabel}
              </button>
            )}
            {showConfirm && onConfirm && (
              <button
                className={`modal-button ${confirmDanger ? 'modal-button--danger' : 'modal-button--primary'}`}
                onClick={() => void onConfirm()}
                disabled={confirmDisabled}
              >
                {confirmLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
