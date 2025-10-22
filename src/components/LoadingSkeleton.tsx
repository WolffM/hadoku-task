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
        <div className="skeleton-header"></div>
        <div className="skeleton-boards">
          <div className="skeleton-board"></div>
          <div className="skeleton-board"></div>
          <div className="skeleton-board"></div>
        </div>
        <div className="skeleton-input"></div>
        <div className="skeleton-filters">
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
        </div>
        <div className="skeleton-tasks">
          <div className="skeleton-task"></div>
          <div className="skeleton-task"></div>
          <div className="skeleton-task"></div>
        </div>
      </div>
    </div>
  )
}
