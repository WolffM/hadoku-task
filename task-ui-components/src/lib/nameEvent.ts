/**
 * Fired on `window` after every successful rename made in the settings popout
 * (ConnectedSettings' Display name row, `POST /session/name`), with
 * `{ name }` as `detail`. `onNameChange` only reaches the one ConnectedSettings
 * that rendered the gear; a component elsewhere on the page (hadoku-cardtable's
 * embedded watchparty room chrome) listens for this to rename its roster entry
 * without a reconnect. The name twin of AVATAR_EVENT.
 *
 * Its own module, free of imports, like avatarEvent.ts.
 */
export const NAME_EVENT = 'hadoku:name'

export interface NameEventDetail {
  name: string
}
