/**
 * SettingsModal component
 * Dialog for managing user settings and preferences
 */

import React, { useState } from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { UserPreferences } from '../../domain/types'
import { validateAndChangeKey } from '../../utils/auth'

export interface SettingsModalProps {
  isOpen: boolean
  preferences: UserPreferences
  showCompleteButton: boolean
  showDeleteButton: boolean
  showTagButton: boolean
  userType?: string
  onClose: () => void
  onSavePreferences: (updates: Partial<UserPreferences>) => Promise<void>
  onValidateKey: (key: string) => Promise<boolean>
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void
}

export function SettingsModal({
  isOpen,
  preferences,
  showCompleteButton,
  showDeleteButton,
  showTagButton,
  userType: _userType,
  onClose,
  onSavePreferences,
  onValidateKey,
  onShowToast
}: SettingsModalProps) {
  const [newKey, setNewKey] = useState('')
  const [keyValidationError, setKeyValidationError] = useState<string | null>(null)
  const [isValidatingKey, setIsValidatingKey] = useState(false)

  const [displayName, setDisplayName] = useState(preferences.displayName || '')
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [isUpdatingDisplayName, setIsUpdatingDisplayName] = useState(false)

  const handleKeyChange = async () => {
    if (!newKey.trim() || isValidatingKey) return

    setIsValidatingKey(true)
    setKeyValidationError(null)

    // Show toast that key is being validated
    onShowToast?.('Validating access key...', 'info')

    const result = await validateAndChangeKey(newKey, onValidateKey)

    if (!result.success) {
      setKeyValidationError(result.error || 'Failed to validate key')
      onShowToast?.(result.error || 'Invalid access key', 'error')
      setIsValidatingKey(false)
    }
    // If successful, page will redirect
  }

  const handleDisplayNameUpdate = async () => {
    const trimmedName = displayName.trim()

    // If unchanged, don't update
    if (trimmedName === preferences.displayName) {
      return
    }

    if (isUpdatingDisplayName) return

    setIsUpdatingDisplayName(true)
    setDisplayNameError(null)

    try {
      await onSavePreferences({ displayName: trimmedName || undefined })
      onShowToast?.('Display name updated!', 'success')
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update display name'
      setDisplayNameError(errorMsg)
      onShowToast?.(errorMsg, 'error')
    } finally {
      setIsUpdatingDisplayName(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Settings"
      onClose={onClose}
      onConfirm={onClose}
      confirmLabel="Close"
      cancelLabel="Close"
    >
      {/* User Management Section */}
      <div className="settings-section">
        <h4 className="settings-section-title">User Management</h4>

        {/* Display name - single editable field */}
        <div className="settings-field">
          <label className="settings-field-label">Display Name</label>
          <div className="settings-field-input-group">
            <input
              type="text"
              name="displayName"
              autoComplete="name"
              className="settings-text-input"
              value={displayName}
              onChange={e => {
                setDisplayName(e.target.value)
                setDisplayNameError(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && displayName.trim()) {
                  handleDisplayNameUpdate()
                }
              }}
              placeholder="Enter your display name"
              disabled={isUpdatingDisplayName}
            />
            {displayName !== (preferences.displayName || '') && (
              <button
                className="settings-field-button"
                onClick={handleDisplayNameUpdate}
                disabled={isUpdatingDisplayName}
              >
                {isUpdatingDisplayName ? <span className="spinner"></span> : '↵'}
              </button>
            )}
          </div>
          {displayNameError && <span className="settings-error">{displayNameError}</span>}
        </div>

        {/* Authentication key */}
        <div className="settings-field">
          <label className="settings-field-label">Enter New Key</label>
          <div className="settings-field-input-group">
            <input
              type="password"
              name="key"
              autoComplete="key"
              className="settings-text-input"
              value={newKey}
              onChange={e => {
                setNewKey(e.target.value)
                setKeyValidationError(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && newKey && !isValidatingKey) {
                  handleKeyChange()
                }
              }}
              placeholder="Enter authentication key"
              disabled={isValidatingKey}
            />
            {newKey && (
              <button
                className="settings-field-button"
                onClick={handleKeyChange}
                disabled={isValidatingKey}
              >
                {isValidatingKey ? <span className="spinner"></span> : '↵'}
              </button>
            )}
          </div>
          {keyValidationError && <span className="settings-error">{keyValidationError}</span>}
        </div>
      </div>

      {/* Preferences Section */}
      <div className="settings-section">
        <h4 className="settings-section-title">Preferences</h4>

        <label className="settings-option">
          <input
            type="checkbox"
            checked={preferences.experimentalThemes || false}
            onChange={e => {
              onSavePreferences({ experimentalThemes: e.target.checked })
            }}
          />
          <span className="settings-label">
            <strong>Experimental Themes</strong>
            <span className="settings-description">
              Enable access to experimental theme options
            </span>
          </span>
        </label>

        <label className="settings-option">
          <input
            type="checkbox"
            checked={preferences.alwaysVerticalLayout || false}
            onChange={e => {
              onSavePreferences({ alwaysVerticalLayout: e.target.checked })
            }}
          />
          <span className="settings-label">
            <strong>Always Use Vertical Layout</strong>
            <span className="settings-description">
              Use mobile-style vertical task layout on all devices
            </span>
          </span>
        </label>

        <label className="settings-option">
          <input
            type="checkbox"
            checked={!showCompleteButton}
            onChange={e => {
              onSavePreferences({ showCompleteButton: !e.target.checked })
            }}
          />
          <span className="settings-label">
            <strong>Disable Complete Button</strong>
            <span className="settings-description">
              Hide the checkmark (✓) button on task items
            </span>
          </span>
        </label>

        <label className="settings-option">
          <input
            type="checkbox"
            checked={!showDeleteButton}
            onChange={e => {
              onSavePreferences({ showDeleteButton: !e.target.checked })
            }}
          />
          <span className="settings-label">
            <strong>Disable Delete Button</strong>
            <span className="settings-description">Hide the delete (×) button on task items</span>
          </span>
        </label>

        <label className="settings-option">
          <input
            type="checkbox"
            checked={showTagButton}
            onChange={e => {
              onSavePreferences({ showTagButton: e.target.checked })
            }}
          />
          <span className="settings-label">
            <strong>Enable Tag Button</strong>
            <span className="settings-description">Show tag button on task items</span>
          </span>
        </label>
      </div>
    </Modal>
  )
}
