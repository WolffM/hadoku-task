/**
 * TaskPreferencesSection — the task app's own settings, rendered inside the
 * shared ConnectedSettings popout via its `children` extension slot (so there's
 * ONE unified gear + modal, with app-specific prefs under the divider).
 *
 * Only the two prefs that are genuinely task-specific live here; identity
 * (tier / display name / content level / auth key) is handled by the shared
 * ConnectedSettings, and Simple/Advanced theme mode lives in the ThemePicker.
 */
import React from 'react'
import type { UserPreferences } from '../domain/types'

export interface TaskPreferencesSectionProps {
  preferences: UserPreferences
  onSavePreferences: (updates: Partial<UserPreferences>) => Promise<void>
}

export function TaskPreferencesSection({
  preferences,
  onSavePreferences
}: TaskPreferencesSectionProps) {
  const showCompleteButton = preferences.showCompleteButton ?? true

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">Task preferences</h4>

      <label className="settings-option">
        <input
          type="checkbox"
          checked={!showCompleteButton}
          onChange={e => {
            void onSavePreferences({ showCompleteButton: !e.target.checked })
          }}
        />
        <span className="settings-label">
          <strong>Disable Complete Button</strong>
          <span className="settings-description">Hide the checkmark (✓) button on task items</span>
        </span>
      </label>

      <label className="settings-option">
        <input
          type="checkbox"
          checked={preferences.alwaysVerticalLayout || false}
          onChange={e => {
            void onSavePreferences({ alwaysVerticalLayout: e.target.checked })
          }}
        />
        <span className="settings-label">
          <strong>Always Use Vertical Layout</strong>
          <span className="settings-description">
            Use mobile-style vertical task layout on all devices
          </span>
        </span>
      </label>
    </div>
  )
}
