/**
 * ConfirmModal component
 * Generic in-app confirmation dialog.
 *
 * Exists because `window.confirm()` is not a dialog the app controls. Chrome's
 * "prevent this page from creating additional dialogs" checkbox — and Firefox's
 * equivalent — makes every later call return `false` WITHOUT showing anything,
 * so a guard written as `if (confirm(...)) { destroy() }` silently becomes a
 * permanent no-op. Deleting boards was unreachable for anyone who ticked it.
 * The same applies to `alert()` and `prompt()`: never put an action behind one.
 */

import React from 'react'
import { Modal } from '@wolffm/task-ui-components'

export interface ConfirmModalProps {
  isOpen: boolean
  title: string
  /** The body. A node, so callers can bold the thing being destroyed. */
  message: React.ReactNode
  confirmLabel?: string
  /** Red confirm button. On by default — everything routed here is destructive. */
  danger?: boolean
  /**
   * A failure from the last confirm attempt. Shown in the dialog and the
   * dialog stays open, because the alert() this would otherwise go to is
   * suppressed by the very setting that broke the confirm.
   */
  error?: string | null
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  error = null,
  onCancel,
  onConfirm
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      onConfirm={onConfirm}
      confirmLabel={confirmLabel}
      confirmDanger={danger}
      className="confirm-modal"
    >
      <p>{message}</p>
      {error && <div className="modal-error">{error}</div>}
    </Modal>
  )
}
