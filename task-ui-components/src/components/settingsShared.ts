/**
 * What ConnectedSettings (eager, on every page) and SettingsSiteTabs (its lazy
 * chunk) both need. Kept tiny: everything here ships on every page.
 */

/** Rejection sink for fire-and-forget settings actions. The client helpers
 *  already resolve to null on failure (state reflects it), so this only trips
 *  on truly unexpected throws — log rather than swallow silently. */
export function reportErr(err: unknown) {
  // task-ui-components v2 dropped its logger; keep the package dependency-free.
  console.error('[ConnectedSettings] action failed', (err as Error)?.message ?? err)
}

/** Save passkey pulses while the gear's dot is asking for it. */
export const PASSKEY_PULSE_CLASS = 'settings-popout__btn--pulse'
