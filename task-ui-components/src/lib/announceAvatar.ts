/**
 * Fire AVATAR_EVENT with the new settings: every avatar change made from the
 * header (the avatar builder, Connections, the verify dialog's links) goes
 * through this. Apart from avatarEvent.ts, which the package entry exports and
 * must carry no prefs-client type.
 */
import type { AvatarSettings } from '@wolffm/prefs-client/avatar'
import { AVATAR_EVENT } from './avatarEvent'

export function announceAvatar(next: AvatarSettings): void {
  window.dispatchEvent(new window.CustomEvent<AvatarSettings>(AVATAR_EVENT, { detail: next }))
}
