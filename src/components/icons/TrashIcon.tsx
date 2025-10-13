import React from 'react'

interface TrashIconProps {
  size?: number
  className?: string
}

export function TrashIcon({ size = 16, className = '' }: TrashIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M6 2V1H10V2H13V3H3V2H6Z"
        fill="currentColor"
      />
      <path
        d="M4 4H12V14C12 14.5523 11.5523 15 11 15H5C4.44772 15 4 14.5523 4 14V4Z"
        fill="currentColor"
      />
      <path
        d="M6 6H7V13H6V6Z"
        fill="currentColor"
        opacity="0.4"
      />
      <path
        d="M9 6H10V13H9V6Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  )
}
