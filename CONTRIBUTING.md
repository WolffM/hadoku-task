# Contributing to Hadoku Task Manager

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/hadoku-task.git
cd hadoku-task
pnpm install
pnpm run dev
```

## Development Workflow

1. **Create a feature branch**: `git checkout -b feature/your-feature`
2. **Make changes** following guidelines below
3. **Test** - user types, themes, drag & drop, localStorage, cross-tab sync
4. **Build**: `pnpm run build:all`
5. **Commit** - pre-commit hooks auto-lint and bump versions (see `.husky/README.md`)
6. **Open a Pull Request** with clear description

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Provide proper type definitions, avoid `any`

### File Organization

- Keep files under 250 lines
- Components in `src/components/`
- Utilities in `src/utils/` or `src/domain/utils/`

### Styling

- Use CSS custom properties for colors/spacing
- Add styles to appropriate CSS file (`base.css`, `main.css`, `buttons.css`, etc.)

## Adding Features

### New Theme

1. Add definition in `themes/src/style.css` (~40 CSS variables: 34 color + 6 shadow)
2. Update `THEMES` array in `themes/src/index.ts`
3. Add theme family entry in `src/app/themeConfig.tsx`

### New API Endpoint

1. Add handler in `src/domain/handlers/handlers.ts`
2. Update types in `src/domain/types.ts`
3. Export in `src/server/index.ts`
4. Document in `docs/API.md`

## Code Style

- 2 space indentation
- Semicolons, single quotes, trailing commas

## Critical Build Files

Some manually-maintained files must be committed despite `.gitignore` patterns:

- `src/app/entry.d.ts` - Public API type definitions
- `themes/src/style.css` - Theme CSS source
- CSS files in `task-ui-components/src/` (theme-picker.css, toaster.css, context-menu.css)

If CI fails with "file missing" errors, check these files exist and are committed.

## License

MIT License
