/**
 * ViewSwitcher component
 * Toggle between Board and Calendar views
 */

import React from 'react'

export type ViewType = 'board' | 'calendar'

export interface ViewSwitcherProps {
  currentView: ViewType
  onViewChange: (view: ViewType) => void
}

export function ViewSwitcher({ currentView, onViewChange }: ViewSwitcherProps) {
  return (
    <div className="view-switcher">
      <button
        className={`pill-btn view-switcher__btn ${currentView === 'board' ? 'pill-btn--active view-switcher__btn--active' : ''}`}
        onClick={() => onViewChange('board')}
        title="Board view"
      >
        Board
      </button>
      <button
        className={`pill-btn view-switcher__btn ${currentView === 'calendar' ? 'pill-btn--active view-switcher__btn--active' : ''}`}
        onClick={() => onViewChange('calendar')}
        title="Calendar view"
      >
        Calendar
      </button>
    </div>
  )
}
