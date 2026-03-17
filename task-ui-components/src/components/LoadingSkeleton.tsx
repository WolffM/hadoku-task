/**
 * LoadingSkeleton Component
 * Displays a loading skeleton with theme support
 * Can be customized with different layouts
 */

import React from 'react'

export interface LoadingSkeletonProps {
  isDarkTheme?: boolean
  className?: string
  layout?: 'default' | 'minimal' | 'custom'
  customContent?: React.ReactNode
}

export function LoadingSkeleton({
  isDarkTheme = false,
  className = '',
  layout = 'default',
  customContent
}: LoadingSkeletonProps) {
  if (layout === 'custom' && customContent) {
    return (
      <div
        className={`loading-skeleton ${className}`}
        data-dark-theme={isDarkTheme ? 'true' : 'false'}
      >
        {customContent}
      </div>
    )
  }

  if (layout === 'minimal') {
    return (
      <div
        className={`loading-skeleton loading-skeleton--minimal ${className}`}
        data-dark-theme={isDarkTheme ? 'true' : 'false'}
      >
        <div className="skeleton-spinner"></div>
      </div>
    )
  }

  // Default layout - task app specific but can be overridden
  return (
    <div
      className={`loading-skeleton ${className}`}
      data-dark-theme={isDarkTheme ? 'true' : 'false'}
    >
      <div className="loading-skeleton__content">
        {/* Header */}
        <div className="skeleton-header-row">
          <div className="skeleton-header"></div>
          <div className="skeleton-button"></div>
        </div>

        {/* Navigation */}
        <div className="skeleton-nav">
          <div className="skeleton-nav-item"></div>
          <div className="skeleton-nav-item"></div>
          <div className="skeleton-nav-item"></div>
        </div>

        {/* Input */}
        <div className="skeleton-input"></div>

        {/* Filters */}
        <div className="skeleton-filters">
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
          <div className="skeleton-filter"></div>
        </div>

        {/* Content */}
        <div className="skeleton-content">
          <div className="skeleton-content-header"></div>
          <div className="skeleton-item"></div>
          <div className="skeleton-item"></div>
          <div className="skeleton-item"></div>
        </div>
      </div>
    </div>
  )
}
