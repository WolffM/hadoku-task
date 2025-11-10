#!/usr/bin/env node

/**
 * Smart version management script
 *
 * Logic:
 * - If current version is x.y.20, increment to x.(y+1).0
 * - Otherwise, increment patch: x.y.z -> x.y.(z+1)
 *
 * This prevents patch versions from growing too high by rolling over
 * every 20 patch versions to the next minor version.
 */

import fs from 'fs'
import path from 'path'

const packageJsonPath = path.join(process.cwd(), 'package.json')

try {
  // Read current package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const currentVersion = packageJson.version

  console.log(`[Version Manager] Current version: ${currentVersion}`)

  // Parse version parts
  const versionParts = currentVersion.split('.').map(Number)
  if (versionParts.length !== 3) {
    throw new Error(`Invalid version format: ${currentVersion}`)
  }

  const [major, minor, patch] = versionParts

  let newVersion

  if (patch === 20) {
    // Roll over to next minor version
    newVersion = `${major}.${minor + 1}.0`
    console.log(`[Version Manager] 🚀 Rolling over to minor version: ${newVersion}`)
  } else {
    // Regular patch increment
    newVersion = `${major}.${minor}.${patch + 1}`
    console.log(`[Version Manager] 📈 Incrementing patch version: ${newVersion}`)
  }

  // Update package.json
  packageJson.version = newVersion
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')

  console.log(`[Version Manager] ✅ Version updated: ${currentVersion} → ${newVersion}`)
} catch (error) {
  console.error(`[Version Manager] ❌ Error:`, error.message)
  process.exit(1)
}
