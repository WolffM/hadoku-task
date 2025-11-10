/**
 * SettingsModal Component
 * Generic settings dialog that can be customized with sections
 */

import React from 'react'
import { Modal } from './Modal'

export interface SettingsSection {
  id: string
  title: string
  fields: SettingsField[]
}

export type SettingsField =
  | SettingsToggleField
  | SettingsTextInputField
  | SettingsPasswordField
  | SettingsSelectField
  | SettingsButtonField
  | SettingsCustomField

export interface BaseSettingsField {
  id: string
  label: string
  description?: string
  disabled?: boolean
}

export interface SettingsToggleField extends BaseSettingsField {
  type: 'toggle'
  value: boolean
  onChange: (value: boolean) => void
}

export interface SettingsTextInputField extends BaseSettingsField {
  type: 'text'
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export interface SettingsPasswordField extends BaseSettingsField {
  type: 'password'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  showButton?: boolean
  buttonLabel?: string
  onButtonClick?: () => void | Promise<void>
  buttonDisabled?: boolean
  error?: string | null
  autoComplete?: string
}

export interface SettingsSelectField extends BaseSettingsField {
  type: 'select'
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

export interface SettingsButtonField extends BaseSettingsField {
  type: 'button'
  buttonLabel: string
  onClick: () => void | Promise<void>
  variant?: 'primary' | 'danger' | 'default'
}

export interface SettingsCustomField extends BaseSettingsField {
  type: 'custom'
  render: () => React.ReactNode
}

export interface SettingsModalProps {
  isOpen: boolean
  title?: string
  sections: SettingsSection[]
  onClose: () => void
  className?: string
  showCloseButton?: boolean
}

export function SettingsModal({
  isOpen,
  title = 'Settings',
  sections,
  onClose,
  className = '',
  showCloseButton = true
}: SettingsModalProps) {
  const renderField = (field: SettingsField) => {
    switch (field.type) {
      case 'toggle':
        return (
          <div key={field.id} className="settings-field">
            <div className="settings-field-header">
              <label className="settings-field-label" htmlFor={field.id}>
                {field.label}
              </label>
              <input
                type="checkbox"
                id={field.id}
                className="settings-toggle"
                checked={field.value}
                onChange={e => field.onChange(e.target.checked)}
                disabled={field.disabled}
              />
            </div>
            {field.description && <p className="settings-field-description">{field.description}</p>}
          </div>
        )

      case 'text':
        return (
          <div key={field.id} className="settings-field">
            <label className="settings-field-label" htmlFor={field.id}>
              {field.label}
            </label>
            {field.description && <p className="settings-field-description">{field.description}</p>}
            <input
              type="text"
              id={field.id}
              className="settings-text-input"
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
              placeholder={field.placeholder}
              disabled={field.disabled}
            />
          </div>
        )

      case 'password':
        return (
          <div key={field.id} className="settings-field">
            <label className="settings-field-label" htmlFor={field.id}>
              {field.label}
            </label>
            {field.description && <p className="settings-field-description">{field.description}</p>}
            <div className="settings-field-input-group">
              <input
                type="password"
                id={field.id}
                name={field.autoComplete || field.id}
                autoComplete={field.autoComplete || 'off'}
                className="settings-text-input"
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
                placeholder={field.placeholder}
                disabled={field.disabled}
              />
              {field.showButton && field.onButtonClick && (
                <button
                  className="settings-button"
                  onClick={field.onButtonClick}
                  disabled={field.buttonDisabled || field.disabled}
                >
                  {field.buttonLabel || 'Submit'}
                </button>
              )}
            </div>
            {field.error && <p className="settings-field-error">{field.error}</p>}
          </div>
        )

      case 'select':
        return (
          <div key={field.id} className="settings-field">
            <label className="settings-field-label" htmlFor={field.id}>
              {field.label}
            </label>
            {field.description && <p className="settings-field-description">{field.description}</p>}
            <select
              id={field.id}
              className="settings-select"
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
              disabled={field.disabled}
            >
              {field.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )

      case 'button':
        return (
          <div key={field.id} className="settings-field">
            {field.label && <label className="settings-field-label">{field.label}</label>}
            {field.description && <p className="settings-field-description">{field.description}</p>}
            <button
              className={`settings-button settings-button--${field.variant || 'default'}`}
              onClick={field.onClick}
              disabled={field.disabled}
            >
              {field.buttonLabel}
            </button>
          </div>
        )

      case 'custom':
        return (
          <div key={field.id} className="settings-field">
            {field.label && <label className="settings-field-label">{field.label}</label>}
            {field.description && <p className="settings-field-description">{field.description}</p>}
            {field.render()}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      onConfirm={showCloseButton ? onClose : undefined}
      confirmLabel="Close"
      showCancel={false}
      showConfirm={showCloseButton}
      className={`settings-modal ${className}`}
    >
      <div className="settings-content">
        {sections.map(section => (
          <div key={section.id} className="settings-section">
            <h4 className="settings-section-title">{section.title}</h4>
            {section.fields.map(field => renderField(field))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
