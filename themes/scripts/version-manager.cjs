const fs = require('fs')
const { execSync } = require('child_process')

const packagePath = './package.json'
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const [major, minor, patch] = packageJson.version.split('.').map(Number)

console.log(`[Themes Version Manager] Current version: ${major}.${minor}.${patch}`)

// Roll over at .20
const newVersion = patch === 20 
  ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`

console.log(`[Themes Version Manager] ${patch === 20 ? '🔄 Rolling over to' : '📈 Incrementing patch version'}:`, newVersion)

packageJson.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n')

console.log(`[Themes Version Manager] ✅ Version updated: ${major}.${minor}.${patch} → ${newVersion}`)

// Update package-lock.json
try {
  execSync('npm install --package-lock-only', { stdio: 'inherit' })
} catch (error) {
  console.error('[Themes Version Manager] Warning: Could not update package-lock.json')
}
