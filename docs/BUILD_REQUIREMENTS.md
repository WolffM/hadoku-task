# Build Requirements

This document lists files that are **manually maintained** and **must be committed** to the repository, even though they might match ignore patterns in `.gitignore`.

## Critical Files

### Main Package (`@wolffm/task`)

#### `src/app/entry.d.ts`

- **Purpose**: TypeScript type definitions for the package's public API
- **Used by**: `vite.config.ts` (copy-types plugin)
- **Exported as**: `./frontend` types in `package.json`
- **Why it's special**: While most `.d.ts` files are auto-generated, this one is manually maintained to define the public interface
- **Exception in .gitignore**: `!src/app/entry.d.ts`

**Contents:**

- `TaskAppProps` interface - Configuration props for mounting the app
- `ThemeName` type - Available theme names
- `mount()` and `unmount()` function signatures

### UI Components Package (`@wolffm/task-ui-components`)

#### CSS Files (in `src/`)

- `theme-picker.css` - Standalone styles for theme picker component
- `toaster.css` - Standalone styles for toast notifications
- `context-menu.css` - Standalone styles for context menus

**Why they're special**: These are source files that get copied to `dist/` during the build process (via `copy-css` script) to allow consumers to import them separately from the main bundle.

### Themes Package (`@wolffm/themes`)

#### `src/style.css`

- **Purpose**: Main theme definitions and CSS variables
- **Exported as**: `./style.css` in `package.json`
- **Why it's special**: Source CSS file that consumers import directly

## Validation

The CI pipeline (`.github/workflows/publish.yml`) includes a **"Validate required source files"** step that runs before the build. This step checks that all critical files exist and provides helpful error messages if they're missing.

If a file is missing, the build will fail early with a message like:

```
❌ ERROR: src/app/entry.d.ts is missing!
   This file should be committed (exception in .gitignore)
```

## Adding New Critical Files

If you need to add a new manually-maintained file that matches an ignore pattern:

1. **Add an exception to `.gitignore`**:

   ```gitignore
   # Exception: manually maintained type definitions
   !src/app/entry.d.ts
   !src/path/to/new-file.ts
   ```

2. **Add validation in `.github/workflows/publish.yml`**:

   ```bash
   if [ ! -f "src/path/to/new-file.ts" ]; then
     echo "❌ ERROR: src/path/to/new-file.ts is missing!"
     missing_files=1
   fi
   ```

3. **Document it here** in this file with:
   - What the file is for
   - Why it needs to be committed
   - What uses it in the build process

## Common Issues

### "ENOENT: no such file or directory" during build

This usually means a file that should be committed is being ignored by `.gitignore`. Check:

1. Does the file exist locally? (`git status --ignored`)
2. Is it being ignored? (`git check-ignore -v <filename>`)
3. If needed, add an exception pattern starting with `!` in `.gitignore`
4. Force add the file: `git add -f <filename>`

### Build works locally but fails in CI

This is a classic sign that a required file is in your local directory but not committed to the repo, likely due to `.gitignore` patterns.
