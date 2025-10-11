# Publishing to GitHub Packages

## Automated Publishing

The package is **automatically published** on every push to `main`:

```bash
git add .
git commit -m "your changes"
git push
```

That's it! GitHub Actions will:
1. Build the package
2. Auto-version it with the commit hash (e.g., `1.0.0-abc1234`)
3. Publish to GitHub Packages using `GITHUB_TOKEN`

## Manual Publishing (Alternative)

If you need to publish manually:

### 1. Create GitHub Personal Access Token
- Go to: https://github.com/settings/tokens
- Create token with `write:packages` and `read:packages` permissions

### 2. Authenticate and Publish
```bash
npm login --registry=https://npm.pkg.github.com
# Username: your-github-username
# Password: your-personal-access-token
# Email: your-email@example.com

npm run build:all
npm publish
```

## Using in Parent Repo (hadoku-site)

### 1. Create `.npmrc` in parent repo root
```
@hadoku:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 2. Install in parent repo
```bash
# Set your token as environment variable
export GITHUB_TOKEN=your_personal_access_token

# Install the package
npm install @wolffm/task

# Or install in specific directory
npm install --prefix ./workers/task-api @wolffm/task
```

### 3. Import in your code
```typescript
// Import API (server-side)
import { createTaskRouter } from '@wolffm/task/api'

// Import frontend (client-side)
import { mount } from '@wolffm/task/frontend'
```

## Package Exports

- `@wolffm/task/api` - Server-side router, handlers, types
- `@wolffm/task/frontend` - Client-side mount function and UI

## Version Bumping

Before publishing a new version:
```bash
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0
```

Then build and publish:
```bash
npm run build:all
npm publish
```
