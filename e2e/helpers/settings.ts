/**
 * Shared selectors for the settings popout (@wolffm/task-ui-components
 * ConnectedSettings), which both the local build and production render.
 */

/**
 * The key-swap submit button.
 *
 * Published @wolffm/task-ui-components 2.2.0 labels it "Switch"; the workspace
 * source (2.2.1+) renames it to "Apply". A local run and production can sit on
 * either side of that rename at any given moment, so match both rather than
 * pinning to one label and breaking the moment the package version flips.
 */
export const KEY_SUBMIT_LABEL = /^(Apply|Switch)$/
