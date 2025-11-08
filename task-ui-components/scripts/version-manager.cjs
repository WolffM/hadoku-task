/**
 * Smart version manager for @wolffm/task-ui-components
 * Auto-increments patch version (with rollover at .20)
 */

const fs = require('fs')
const path = require('path')

const packagePath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

const [major, minor, patch] = pkg.version.split('.').map(Number)

console.log(`[UI Components Version Manager] Current version: ${major}.${minor}.${patch}`)

// Increment patch, rollover at 20
let newPatch = patch + 1
let newMinor = minor

if (newPatch > 20) {
  newPatch = 0
  newMinor++
}

const newVersion = `${major}.${newMinor}.${newPatch}`

console.log(`[UI Components Version Manager] ${patch === 20 ? '🔄 Rolling over to' : '📈 Incrementing patch version'}:`, newVersion)

// Update package.json
pkg.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`[UI Components Version Manager] ✅ Version updated: ${major}.${minor}.${patch} → ${newVersion}`)
