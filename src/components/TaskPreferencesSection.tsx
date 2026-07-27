/**
 * TaskPreferencesSection — the task app's own settings, rendered inside the
 * shared ConnectedSettings popout via its `children` extension slot (so there's
 * ONE unified gear + modal, with app-specific prefs under the divider).
 *
 * Identity (tier / display name / content level / auth key) is handled by the
 * shared ConnectedSettings, and Simple/Advanced theme mode lives in the
 * ThemePicker — only genuinely task-specific prefs live here.
 *
 * The action-button block covers all three card controls (notes / complete /
 * delete). It used to expose only "Disable Complete Button", which left anyone
 * whose showDeleteButton had been turned off with no way to turn it back on.
 * The preview underneath is a REAL <TaskItem>, not a mock-up, so it can't drift
 * from what the board actually renders.
 */
import React, { useMemo } from 'react'
import type { Task, UserPreferences } from '../domain/types'
import { TaskItem } from './TaskItem'

export interface TaskPreferencesSectionProps {
  preferences: UserPreferences
  onSavePreferences: (updates: Partial<UserPreferences>) => Promise<void>
}

/** The three card controls, in the order TaskItem renders them. */
const ACTION_TOGGLES = [
  { key: 'showNotesButton', label: 'Notes', glyph: '📝' },
  { key: 'showCompleteButton', label: 'Complete', glyph: '✓' },
  { key: 'showDeleteButton', label: 'Delete', glyph: '×' }
] as const

const noop = () => {}
const noopAsync = async () => {}

export function TaskPreferencesSection({
  preferences,
  onSavePreferences
}: TaskPreferencesSectionProps) {
  // The preview card. Memoized so React keeps one instance across toggles; the
  // age line is relative to render time, which is why it isn't a module const.
  const previewTask: Task = useMemo(
    () => ({
      id: 'preview-task',
      title: 'Example task',
      tag: 'preview',
      state: 'Active',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    }),
    []
  )
  const noPendingOperations = useMemo(() => new Set<string>(), [])

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">Task preferences</h4>

      <div className="settings-field">
        <span className="settings-field-label">Task buttons</span>
        <span className="settings-description">Choose which buttons appear on a task card.</span>

        <div className="settings-toggle-row">
          {ACTION_TOGGLES.map(({ key, label, glyph }) => (
            <label key={key} className="settings-toggle-chip">
              <input
                type="checkbox"
                checked={preferences[key] ?? true}
                onChange={e => {
                  void onSavePreferences({ [key]: e.target.checked })
                }}
              />
              <span className="settings-toggle-chip-glyph" aria-hidden="true">
                {glyph}
              </span>
              <span>{label}</span>
            </label>
          ))}
        </div>

        <span className="settings-preview-caption">Preview</span>
        {/* A real TaskItem with no-op handlers, so the buttons render exactly as
            they do on the board; the stage makes it inert to clicks. */}
        <ul className="task-app__list settings-preview-stage">
          <TaskItem
            task={previewTask}
            isDraggable={false}
            pendingOperations={noPendingOperations}
            onComplete={noop}
            onDelete={noop}
            onEditTag={noop}
            onSetNotes={noopAsync}
            showNotesButton={preferences.showNotesButton ?? true}
            showCompleteButton={preferences.showCompleteButton ?? true}
            showDeleteButton={preferences.showDeleteButton ?? true}
            showTagButton={preferences.showTagButton ?? false}
          />
        </ul>
      </div>

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
