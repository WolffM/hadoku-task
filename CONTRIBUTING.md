# Contributing to Hadoku Task Manager

Thank you for your interest in contributing to Hadoku Task Manager! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/hadoku-task.git
   cd hadoku-task
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Run the development server**:
   ```bash
   npm run dev
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the coding guidelines below

3. **Test your changes** thoroughly:
   - Test with `userType=public` mode
   - Test with different themes
   - Test drag and drop functionality
   - Verify localStorage persistence

4. **Build to verify**:
   ```bash
   npm run build:all
   ```

### Submitting Changes

1. **Commit your changes** with clear, descriptive messages:

   ```bash
   git commit -m "Add feature: description of what you added"
   ```

   **Note:** Pre-commit hooks will automatically:
   - Run ESLint and auto-fix any linting issues
   - Format code with Prettier
   - Bump package versions if source code changed (see below)
   - Stage all changes for commit

2. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

3. **Open a Pull Request** on GitHub with:
   - Clear title describing the change
   - Description of what was changed and why
   - Any relevant issue numbers (e.g., "Fixes #123")

### Automatic Version Bumping

This project uses Husky pre-commit hooks to automatically bump package versions when source code changes are detected:

- **Root package** (`@wolffm/task`): Bumped when files in `src/`, `package.json`, or build configs change
- **Themes package** (`@wolffm/themes`): Bumped when files in `themes/src/`, `themes/package.json`, or theme build configs change
- **UI Components package** (`@wolffm/task-ui-components`): Bumped when files in `task-ui-components/src/`, `task-ui-components/package.json`, or UI build configs change

**Version bump rules:**

- Patch versions increment automatically (e.g., `1.2.3` → `1.2.4`)
- At patch `.20`, automatically rolls over to next minor version (e.g., `1.2.20` → `1.3.0`)
- Only packages with actual source changes are bumped
- Documentation-only changes do NOT trigger version bumps

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Provide proper type definitions
- Avoid `any` types when possible

### File Organization

- Keep files under 250 lines
- Extract reusable logic into utilities
- Place components in `src/components/`
- Place utilities in `src/utils/` or `src/domain/utils/`

### Styling

- Use CSS custom properties (CSS variables) for all colors and spacing
- Add new styles to the appropriate modular CSS file:
  - `variables.css` - Theme colors and design tokens
  - `main.css` - Layout and structure
  - `buttons.css` - Button styles
  - `modal.css` - Modal dialogs
  - `task-items.css` - Task card styles
- Follow the existing theme pattern when adding new themes

### Adding New Features

#### New Theme

1. Add theme definition in `src/styles/variables.css`
2. Define all ~45 CSS variables
3. Update theme type union in `src/app/App.tsx`
4. Add theme picker option with icon

#### New Component

1. Create in `src/components/`
2. Add appropriate styles in `src/styles/`
3. Import and use in parent components

#### New API Endpoint

1. Add handler in `src/domain/handlers/handlers.ts`
2. Update types in `src/domain/types.ts` if needed
3. Export in `src/server/index.ts`
4. Document in `docs/API.md`

## Code Style

- **Indentation**: 2 spaces
- **Semicolons**: Yes (except in JSON)
- **Quotes**: Single quotes for strings
- **Trailing commas**: Yes in multiline objects/arrays
- **Line length**: Aim for 100 characters, max 120

## Documentation

- Update `README.md` if adding user-facing features
- Update `docs/ARCHITECTURE.md` if changing architecture
- Update `docs/API.md` if adding/changing API endpoints
- Add entries to `docs/CHANGELOG.md` for significant changes

## Testing

Currently, this project does not have automated tests. When testing manually:

- Test all user types: `public`, `friend`, `admin`
- Test on different screen sizes (mobile, tablet, desktop)
- Test all themes
- Test localStorage persistence across page reloads
- Test cross-tab synchronization (open multiple tabs)
- Test drag and drop operations

## Questions?

Feel free to open an issue for:

- Bug reports
- Feature requests
- Questions about the codebase
- Clarifications on documentation

## License

By contributing to Hadoku Task Manager, you agree that your contributions will be licensed under the MIT License.
