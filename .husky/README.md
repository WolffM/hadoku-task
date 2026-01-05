# Husky Git Hooks

Pre-commit hooks for linting, formatting, and automatic version bumping.

## Pre-commit Hook

Runs automatically before each commit:

1. **Lint & Format** - ESLint + Prettier (auto-fixes what it can)
2. **Version Bump** - Auto-increments package versions for source changes

### Version Bump Rules

| Package                      | Triggers on changes to                        |
| ---------------------------- | --------------------------------------------- |
| `@wolffm/task` (root)        | `src/`, `package.json`, `vite.config.*`       |
| `@wolffm/themes`             | `themes/src/`, `themes/package.json`          |
| `@wolffm/task-ui-components` | `task-ui-components/src/`, its `package.json` |

- Patch increments: `1.2.3` → `1.2.4`
- Rolls over at `.20`: `1.2.20` → `1.3.0`
- Documentation changes (`.md` files) do NOT trigger bumps

## Troubleshooting

```bash
# Hook not running?
pnpm run prepare

# Skip hook (not recommended)
git commit --no-verify -m "message"
```
