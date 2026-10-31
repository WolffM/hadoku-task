/**
 * Fired on `window` after every avatar change made in the settings popout
 * (AvatarPicker), with the new avatar settings as `detail` (hadoku_site's
 * `AvatarSettings`, @wolffm/prefs-client/avatar). A host page listens to update
 * what it shows (watchparty sends the new character to its room) without
 * polling prefs-api.
 *
 * Its own module, free of imports, so exporting it from the package entry adds
 * no type dependency on prefs-client for consumers.
 */
export const AVATAR_EVENT = 'hadoku:avatar'
