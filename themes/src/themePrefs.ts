/**
 * Canonical theme-preferences client for the hadoku ecosystem.
 *
 * This file used to exist, byte-for-byte, in every child app under
 * `src/prefs/themePrefs.ts` — its own header said "This module is identical
 * across every child app and the portfolio shell." A module that documents
 * itself as copy-paste is a module that belongs in a package, so here it is.
 *
 * Theme is platform-global: every app and the portfolio shell read/write the
 * SAME row, so it lives under the shared appId 'portfolio' (NOT any app's own
 * id). A per-app id would fragment the theme across apps. Scope is 'device' so
 * "dark on phone, light on desktop" survives.
 *
 * App-specific settings do NOT belong here — declare them in their own
 * prefs client under THAT app's appId.
 */
import { z } from 'zod'
import { createPrefsClient } from '@wolffm/prefs-client'
import { resolvePrefsApiBase } from './prefsApiBase'

// Turn off Zod's JIT before the schema below is CONSTRUCTED. Building a
// z.object runs Zod v4's one-time `allowsEval` probe — `new Function("")` —
// and caches the answer. hadoku.me's CSP grants no 'unsafe-eval', so on every
// page that loads this module the browser recorded a script-src violation
// (harmless: Zod catches it and uses its non-JIT parser). This module is
// evaluated before any app code, so only this module can get ahead of the
// probe: an app calling config() later is too late (watchparty tried it and
// verified it ineffective, 2026-10-05). The config lives on globalThis and is
// shared by every Zod copy on the page. Issue: WolffM/hadoku-task#93.
z.config({ jitless: true })

export const ThemePrefsSchema = z.object({
  theme: z.string().optional(),
  themeMode: z.enum(['simple', 'advanced']).optional(),
  // Unlocks the experimental theme families in the picker. This lived in the
  // TASK app's own prefs, which meant the extra themes existed for exactly one
  // app — a per-app fork of a control that is supposed to be identical
  // everywhere. It is a property of the theme, and of the person, so it lives
  // with the other two.
  experimentalThemes: z.boolean().optional()
})

export type ThemePrefs = z.infer<typeof ThemePrefsSchema>

export const themePrefs = createPrefsClient({
  appId: 'portfolio',
  schema: ThemePrefsSchema,
  // Undefined in production, so the SDK's own default applies. Set only by a
  // local dev/E2E stack pointing at the real prefs-api on localhost — see
  // ./prefsApiBase.
  apiBase: resolvePrefsApiBase(),
  // No default theme on purpose: an absent `theme` means "nothing persisted",
  // so a fresh read never overrides the inline FOUC script's browser-preference
  // fallback. We adopt the SDK theme only when it's actually present.
  //
  // Mirror theme to sessionStorage['hadoku-theme'] on every read so the inline
  // <head> FOUC script keeps applying theme before React mounts.
  bootstrapToSessionStorage: { theme: 'hadoku-theme' }
})
