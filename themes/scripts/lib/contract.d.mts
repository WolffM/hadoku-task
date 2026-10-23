/** Types for contract.mjs — see that file for the behaviour. */

export type RGBA = [number, number, number, number]
export type ThemeTokens = Record<string, string>
export type ThemeTokenMap = Record<string, ThemeTokens>
/** `{ [theme]: { [--color-token]: value } }` */
export type TokenEdits = Record<string, Record<string, string>>

export interface TokenChange {
  theme: string
  token: string
  from: string
  to: string
}

export interface ComfortMetric {
  id: string
  label: string
  value: number
  ok: boolean
  target: string
  display: string
}

export const THEMES: readonly string[]
export const FAMILIES: readonly string[]
export const STRUCTURAL: readonly string[]
export const AA_TEXT: number
export const WCAG_PAIR_COUNT: number

export function isDarkTheme(theme: string): boolean
export function parseThemes(css: string): ThemeTokenMap
export function checkTheme(theme: string, tokens: ThemeTokens): string[]
export function checkThemes(themes: ThemeTokenMap): string[]
export function comfortMetrics(theme: string, tokens: ThemeTokens): ComfortMetric[]
export function formatColor(rgba: number[]): string
export function normalizeColor(input: unknown): string
export function applyTokenEdits(
  css: string,
  edits: TokenEdits
): { css: string; changes: TokenChange[] }

export function parseColor(input: string | number[]): RGBA
export function flatten(color: string | number[], backdrop: string | number[]): RGBA
export function contrast(
  fg: string | number[],
  bg: string | number[],
  backdrop?: string | number[]
): number
export function luminance(rgb: number[]): number
export function ratio(n: number): number
export function toHex(rgb: number[]): string
export function rgbToOklch(rgb: number[]): { L: number; C: number; H: number }
export function oklchToRgbInGamut(lch: {
  L: number
  C: number
  H: number
}): [number, number, number]
