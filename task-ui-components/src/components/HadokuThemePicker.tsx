/**
 * HadokuThemePicker — the platform theme picker, placeable anywhere, and
 * configurable nowhere.
 *
 * WHY THIS EXISTS
 * ---------------
 * Locking the picker inside AppHeader made it uniform, but it also made it
 * unreachable for an app that has no header row. watchpart2 is that app: its
 * UI is an overlay on a video surface, and its picker lives in the chat panel's
 * button strip. Under a header-only API its only options were to grow a header
 * it does not want, or keep hand-rolling — and hand-rolling is what this whole
 * effort removes.
 *
 * So the enforcement is not "you may not PLACE the picker", it is "you may not
 * CONFIGURE it". This component takes no props at all. There is no themeFamilies
 * to pass a different list to, no getThemeIcon to slip a debug logger into, no
 * className to restyle it with, no isOpen to manage differently — those props
 * are exactly how the old ConnectedThemePicker drifted. Everything comes from
 * <HadokuThemeRoot>.
 *
 * AppHeader renders this internally. An app with no header renders it directly.
 * Both get the identical control, because there is no way to ask for a
 * different one.
 */
import React from 'react'
import { ConnectedThemePicker } from './ConnectedThemePicker'
import { useHadokuTheme } from '@wolffm/themes'

export function HadokuThemePicker() {
  const t = useHadokuTheme()
  return (
    <ConnectedThemePicker
      themeFamilies={t.themeFamilies}
      currentTheme={t.theme}
      onThemeChange={t.setTheme}
      getThemeIcon={t.getThemeIcon}
    />
  )
}
