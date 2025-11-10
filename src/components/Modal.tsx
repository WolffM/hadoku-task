import React from 'react'

interface ModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  onConfirm: () => void | Promise<void>
  children?: React.ReactNode
  inputValue?: string
  onInputChange?: (value: string) => void
  inputPlaceholder?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmDisabled?: boolean
  confirmDanger?: boolean
}

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
  confirmDanger = false
}: ModalProps) {
  if (!isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !confirmDisabled) {
      e.preventDefault()
      onConfirm()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>

        {children}

        {onInputChange && (
          <input
            type="text"
            className="modal-input"
            value={inputValue || ''}
            onChange={e => onInputChange(e.target.value)}
            placeholder={inputPlaceholder}
            autoFocus
            onKeyDown={handleKeyDown}
          />
        )}

        <div className="modal-actions">
          <button className="modal-button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`modal-button ${confirmDanger ? 'modal-button--danger' : 'modal-button--primary'}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
