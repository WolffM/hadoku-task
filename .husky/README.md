# Husky Git Hooks

This directory contains Git hooks managed by Husky to ensure code quality and consistency.

## Pre-commit Hook

The pre-commit hook automatically runs before each commit to:

1. **Lint & Format Code**
   - Runs ESLint with auto-fix on all files
   - Formats code with Prettier
   - Fails commit if unfixable linting errors exist

2. **Version Bumping** (Workspace-aware)
   - Automatically bumps package versions when source code changes
   - Supports monorepo with multiple packages
   - Intelligently detects which packages changed

### Version Bump Logic

The hook detects changes in these patterns and bumps the corresponding package:

| Package                      | Trigger Patterns                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@wolffm/task` (root)        | `src/`, `package.json`, `vite.config.*`, `tsconfig.*`                                                                             |
| `@wolffm/themes`             | `themes/src/`, `themes/package.json`, `themes/tsconfig.*`, `themes/vite.config.*`                                                 |
| `@wolffm/task-ui-components` | `task-ui-components/src/`, `task-ui-components/package.json`, `task-ui-components/tsconfig.*`, `task-ui-components/vite.config.*` |

**Version bump rules:**

- Patch version increments by 1 (e.g., `1.2.3` → `1.2.4`)
- When patch reaches `.20`, rolls over to next minor (e.g., `1.2.20` → `1.3.0`)
- Only packages with actual source changes are bumped
- Documentation changes (`docs/`, `*.md` files) do NOT trigger version bumps
- The `pnpm-lock.yaml` is automatically updated after version bumps

### What Gets Staged

After the pre-commit hook runs:

- All linting/formatting changes are staged (`git add -u`)
- Updated `package.json` files are staged (for bumped packages)
- Updated `pnpm-lock.yaml` is staged (if versions changed)

### Troubleshooting

**Hook not running?**

```bash
# Reinstall husky
pnpm run prepare
```

**Linting errors that can't be auto-fixed?**

- The commit will fail with an error message
- Fix the errors manually
- Try committing again

**Version bumped unexpectedly?**

- Check what files are staged: `git diff --cached --name-only`
- The hook only bumps versions for source code changes
- Documentation-only commits should NOT trigger bumps

**Need to skip the hook (not recommended)?**

```bash
git commit --no-verify -m "Your message"
```

## Future Hooks

Additional hooks can be added here as needed:

- `pre-push` - Run tests before pushing
- `commit-msg` - Validate commit message format
- `post-merge` - Install dependencies after merging

## How It Works

Husky creates a `.git/hooks/` directory with symlinks to these scripts. When you run `git commit`, Git automatically executes the pre-commit hook before creating the commit.

The hook is a shell script that:

1. Runs in the repository root directory
2. Has access to Git commands and environment
3. Can fail the commit by exiting with non-zero status
4. Can modify staged files before the commit is created

## Maintenance

When modifying hooks:

1. Test thoroughly before committing
2. Keep the `.husky/pre-commit.backup` file for rollback
3. Document any changes in this README
4. Ensure hooks work on all platforms (Windows, Mac, Linux)

---

**Last Updated:** November 20, 2025  
**Hook Version:** 2.0 (Workspace-aware version bumping)
