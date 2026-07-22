/**
 * Shared selectors for the settings popout (@wolffm/task-ui-components
 * ConnectedSettings).
 */

/**
 * The key-swap submit button as rendered by the LOCAL build.
 *
 * Local specs resolve @wolffm/task-ui-components to the workspace source (see
 * the `workspace:*` dep in themes/package.json — without it, vite pre-bundles
 * the published tarball instead and local edits are invisible). So this is an
 * exact match on purpose: renaming the button in the workspace source SHOULD
 * fail this spec.
 */
export const KEY_SUBMIT_LABEL = 'Apply'

/**
 * The same button as rendered by PRODUCTION, which serves the last published
 * build and can therefore trail the workspace by a publish cycle. The label was
 * "Switch" up to published 2.2.0 and "Apply" from 2.2.1, so a prod-targeting
 * spec must tolerate both rather than break during a deploy lag.
 */
export const KEY_SUBMIT_LABEL_PROD = /^(Apply|Switch)$/
