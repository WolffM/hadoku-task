import React from 'react'
import { ACCOUNT_STYLES as S } from '../lib/accountApi'

/** Six digits from an authenticator app; anything else typed is dropped. */
export function CodeInput({
  value,
  onChange
}: {
  value: string
  onChange: (code: string) => void
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      aria-label="Authenticator code"
      className="settings-popout__input"
      style={S.code}
    />
  )
}

export const isCode = (code: string) => /^\d{6}$/.test(code)
