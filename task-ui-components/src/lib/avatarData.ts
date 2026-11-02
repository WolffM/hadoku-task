/**
 * What the avatar dialog reads: the person's avatar settings (prefs-api, through
 * `@wolffm/prefs-client/avatar`) and watchparty's public character table, which
 * gives each character its portrait and the colour every name cosmetic derives
 * from.
 */
import { createAvatarClient, AvatarError } from '@wolffm/prefs-client/avatar'

export const avatarClient = createAvatarClient({ baseUrl: '/prefs' })

/** watchparty's public character table: GET /watchparty/api/characters. */
const CHARACTERS_URL = '/watchparty/api/characters'
const WATCHPARTY_BASE = '/watchparty'

export interface Character {
  id: string
  name: string
  color: string
  portrait: string
}
export interface CharacterSet {
  id: string
  characters: Character[]
}

export async function fetchCharacters(): Promise<CharacterSet[]> {
  const r = await fetch(CHARACTERS_URL)
  if (!r.ok) throw new Error(`Could not load the characters (HTTP ${r.status})`)
  return ((await r.json()) as { sets: CharacterSet[] }).sets
}

export function portraitUrl(c: Character): string {
  return c.portrait.startsWith('/') ? `${WATCHPARTY_BASE}${c.portrait}` : c.portrait
}

/** A failure as the dialog shows it. */
export function avatarErrorText(err: unknown): string {
  if (err instanceof AvatarError && err.status === 401) return 'Sign in to set an avatar.'
  return err instanceof Error ? err.message : String(err)
}
