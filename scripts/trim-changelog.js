#!/usr/bin/env node

/**
 * Trim CHANGELOG.md to keep only the last 5 version entries
 * Looks for version blocks starting with: ## [x.x.x] - YYYY-MM-DD
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CHANGELOG_PATH = path.join(__dirname, '../docs/CHANGELOG.md')
const MAX_VERSIONS = 5

function trimChangelog() {
  try {
    const content = fs.readFileSync(CHANGELOG_PATH, 'utf8')
    const lines = content.split('\n')

    // Find all version block headers (lines starting with "## [")
    const versionIndices = []
    lines.forEach((line, index) => {
      if (line.match(/^## \[\d+\.\d+\.\d+\]/)) {
        versionIndices.push(index)
      }
    })

    console.log(`Found ${versionIndices.length} version blocks in CHANGELOG.md`)

    if (versionIndices.length <= MAX_VERSIONS) {
      console.log(`Keeping all ${versionIndices.length} versions (≤ ${MAX_VERSIONS})`)
      return
    }

    // Keep only the first MAX_VERSIONS version blocks
    const keepVersions = versionIndices.slice(0, MAX_VERSIONS)
    const lastVersionToKeep = keepVersions[keepVersions.length - 1]

    // Find the next version block start (or end of file) to know where to cut
    const nextVersionStart = versionIndices[MAX_VERSIONS]

    // Find the "---" separator before the next version block
    let cutPoint = nextVersionStart
    for (let i = nextVersionStart - 1; i >= 0; i--) {
      if (lines[i].trim() === '---') {
        cutPoint = i
        break
      }
    }

    // Keep everything up to the cut point
    const trimmedContent = lines.slice(0, cutPoint).join('\n')

    // Add footer
    const footer = `
---

## Version History

For versions prior to ${lines[lastVersionToKeep].match(/\[([\d.]+)\]/)[1]}, please refer to git commit history.

---

**Package:** \`@wolffm/task\`  
**Repository:** https://github.com/WolffM/hadoku-task  
**Registry:** https://npm.pkg.github.com
`

    const finalContent = trimmedContent + footer

    // Write back to file
    fs.writeFileSync(CHANGELOG_PATH, finalContent)

    const removedVersions = versionIndices.length - MAX_VERSIONS
    console.log(
      `✅ Trimmed CHANGELOG.md: kept ${MAX_VERSIONS} versions, removed ${removedVersions} old versions`
    )
  } catch (error) {
    console.error('❌ Failed to trim CHANGELOG.md:', error.message)
    process.exit(1)
  }
}

// Run if called directly
trimChangelog()

export default trimChangelog
