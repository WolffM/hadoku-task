import React from 'react'

interface Props {
  pullDistance: number
  isRefreshing: boolean
  threshold: number
}

export function PullToRefreshIndicator({ pullDistance, isRefreshing, threshold }: Props) {
  if (pullDistance <= 0 && !isRefreshing) return null

  const progress = Math.min(pullDistance / threshold, 1)
  const reached = progress >= 1
  const rotation = isRefreshing ? 0 : progress * 360
  const opacity = Math.min(0.3 + progress * 0.7, 1)

  return (
    <div
      className={`task-app__pull-refresh ${isRefreshing ? 'task-app__pull-refresh--spinning' : ''}`}
      style={{
        transform: `translate(-50%, ${pullDistance - 40}px)`,
        opacity
      }}
      aria-hidden="true"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform: `rotate(${rotation}deg)`,
          color: reached || isRefreshing ? 'var(--color-primary)' : 'var(--color-text-muted)'
        }}
      >
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </div>
  )
}
