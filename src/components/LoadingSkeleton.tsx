/**
 * LoadingSkeleton component
 * Displays a loading skeleton while preferences are being loaded
 */

import React from 'react'

export interface LoadingSkeletonProps {
  isDarkTheme: boolean
}

export function LoadingSkeleton({ isDarkTheme }: LoadingSkeletonProps) {
  return (
    <div className="task-app-loading" data-dark-theme={isDarkTheme ? 'true' : 'false'}>
      <div className="task-app-loading__skeleton">
        {/* Header */}
        <div className="skeleton-header-row">
          <div className="skeleton-header"></div>
          <div className="skeleton-theme-button"></div>
        </div>

        {/* Boards */}
        <div className="skeleton-boards">
          <div className="skeleton-board"></div>
          <div className="skeleton-board"></div>
          <div className="skeleton-board-add"></div>
        </div>

        {/* Input */}
        <div className="skeleton-input"></div>

        {/* Tag filters */}
        <div className="skeleton-filters">
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter-add"></div>
        </div>

        {/* Task column */}
        <div className="skeleton-column">
          <div className="skeleton-column-header"></div>
          <div className="skeleton-task"></div>
          <div className="skeleton-task"></div>
          <div className="skeleton-task"></div>
        </div>
      </div>
    </div>
  )
}
