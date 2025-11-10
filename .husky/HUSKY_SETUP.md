# Husky Auto-Versioning Setup

Quick guide to replicate the automatic version bumping on commit.

## What It Does

- Auto-increments patch version on every commit
- Rolls over to next minor version at `.20` (e.g., `3.1.20` → `3.2.0`)
- Updates `package.json` and `package-lock.json`
- Stages the changes automatically

## Setup

### 1. Install Husky

```bash
npm install --save-dev husky
npx husky init
```

### 2. Create Version Manager Script

Create `scripts/version-manager.js`:

```javascript
const fs = require('fs')
const { execSync } = require('child_process')

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const [major, minor, patch] = packageJson.version.split('.').map(Number)

// Roll over at .20
const newVersion = patch === 20 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`

packageJson.version = newVersion
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n')

console.log(`Version bumped: ${major}.${minor}.${patch} → ${newVersion}`)

// Update package-lock.json
execSync('npm install --package-lock-only', { stdio: 'inherit' })

// Stage the changes
execSync('git add package.json package-lock.json', { stdio: 'inherit' })
```

### 3. Add NPM Script

In `package.json`:

```json
{
  "scripts": {
    "version:smart": "node scripts/version-manager.js"
  }
}
```

### 4. Create Husky Pre-Commit Hook

Create `.husky/pre-commit`:

```bash
npm run version:smart
```

## Usage

Just commit normally:

```bash
git commit -m "your message"
# Version auto-increments!
```

## Customization

**Change rollover threshold**: Modify `patch === 20` in version-manager.js

**Disable rollover**: Use regular increment:

```javascript
const newVersion = `${major}.${minor}.${patch + 1}`
```

**Different versioning**: Adjust the logic in version-manager.js

## Files Needed

- `scripts/version-manager.js` - Version bumping logic
- `.husky/pre-commit` - Husky hook
- `package.json` - Version:smart script

That's it!
