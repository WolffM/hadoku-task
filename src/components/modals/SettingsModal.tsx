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
  userName?: string
  onClose: () => void
  onSavePreferences: (updates: Partial<UserPreferences>) => Promise<void>
  onValidateKey: (key: string) => Promise<boolean>
  onUpdateUserName?: (userName: string) => Promise<{ success: boolean; error?: string }>
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void
}

export function SettingsModal({
  isOpen,
  preferences,
  showCompleteButton,
  showDeleteButton,
  showTagButton,
  userType,
  userName,
  onClose,
  onSavePreferences,
  onValidateKey,
  onUpdateUserName,
  onShowToast
}: SettingsModalProps) {
  const [newKey, setNewKey] = useState('')
  const [keyValidationError, setKeyValidationError] = useState<string | null>(null)
  const [isValidatingKey, setIsValidatingKey] = useState(false)

  const [newUserName, setNewUserName] = useState('')
  const [userNameError, setUserNameError] = useState<string | null>(null)
  const [isUpdatingUserName, setIsUpdatingUserName] = useState(false)

  const isAuthenticatedUser = userType !== 'public'

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

  const handleUserNameUpdate = async () => {
    if (!newUserName.trim() || isUpdatingUserName || !onUpdateUserName) return

    setIsUpdatingUserName(true)
    setUserNameError(null)

    onShowToast?.('Updating display name...', 'info')

    const result = await onUpdateUserName(newUserName.trim())

    if (result.success) {
      onShowToast?.('Display name updated successfully!', 'success')
      setNewUserName('') // Clear input
    } else {
      setUserNameError(result.error || 'Failed to update name')
      onShowToast?.(result.error || 'Failed to update display name', 'error')
    }

    setIsUpdatingUserName(false)
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
      {/* User Management Section - Only for authenticated users */}
      {isAuthenticatedUser && (
        <div className="settings-section">
          <h4 className="settings-section-title">User Management</h4>

          {/* Display current username */}
          {userName && (
            <div className="settings-field">
              <label className="settings-field-label">Current Display Name</label>
              <div className="settings-field-value">{userName}</div>
            </div>
          )}

          {/* Update username */}
          <div className="settings-field">
            <label className="settings-field-label">Update Display Name</label>
            <div className="settings-field-input-group">
              <input
                type="text"
                name="displayName"
                autoComplete="name"
                className="settings-text-input"
                value={newUserName}
                onChange={e => {
                  setNewUserName(e.target.value)
                  setUserNameError(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newUserName.trim() && !isUpdatingUserName) {
                    handleUserNameUpdate()
                  }
                }}
                placeholder="Enter new display name"
                disabled={isUpdatingUserName}
              />
              {newUserName.trim() && (
                <button
                  className="settings-field-button"
                  onClick={handleUserNameUpdate}
                  disabled={isUpdatingUserName}
                >
                  {isUpdatingUserName ? <span className="spinner"></span> : '↵'}
                </button>
              )}
            </div>
            {userNameError && <span className="settings-error">{userNameError}</span>}
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
      )}

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
