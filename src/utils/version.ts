/**
 * Package version utilities
 * Logs version information for debugging cache issues
 */

import { logger } from '@wolffm/task-ui-components'

// Import package.json to get actual versions at build time
import packageJson from '../../package.json'
import uiComponentsPackageJson from '../../task-ui-components/package.json'
import themesPackageJson from '../../themes/package.json'

/**
 * Log all @wolffm package versions for debugging
 * This helps identify when the page is using a cached version
 */
export function logPackageVersions(): void {
  const versions = {
    '@wolffm/task': packageJson.version,
    '@wolffm/task-ui-components': uiComponentsPackageJson.version,
    '@wolffm/themes': themesPackageJson.version
  }

  logger.info('📦 Package Versions:', versions)
}
