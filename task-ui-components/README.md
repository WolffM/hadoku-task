# @wolffm/task-ui-components

Beautiful, reusable UI components for task management applications.

## Components

### ThemePicker

A gorgeous theme picker with light/dark pill design. Fully customizable to work with any theme system.

## Installation

```bash
npm install @wolffm/task-ui-components
```

## Usage

### Quick Start with @wolffm/themes (Recommended)

The easiest way to use the ThemePicker is with the `@wolffm/themes` package, which provides pre-configured theme families with icons:

```tsx
import { ConnectedThemePicker } from '@wolffm/task-ui-components'
import { useTheme, THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'
import '@wolffm/task-ui-components/theme-picker.css'
import '@wolffm/themes/themes.css'

function App() {
  const { theme, setTheme } = useTheme()

  return (
    <ConnectedThemePicker
      themeFamilies={THEME_FAMILIES}
      currentTheme={theme}
      onThemeChange={setTheme}
      getThemeIcon={theme => {
        const Icon = THEME_ICON_MAP[theme]
        return Icon ? <Icon /> : null
      }}
    />
  )
}
```

### Using ConnectedThemePicker (Stateful)

`ConnectedThemePicker` manages its own open/close state, making it simpler to use:

```tsx
import { ConnectedThemePicker } from '@wolffm/task-ui-components'
import '@wolffm/task-ui-components/theme-picker.css'

function App() {
  const [theme, setTheme] = useState('light')

  return (
    <ConnectedThemePicker
      themeFamilies={THEME_FAMILIES}
      currentTheme={theme}
      onThemeChange={setTheme}
    />
  )
}
```

### Using ThemePicker (Manual State)

For full control over the picker's state:

```tsx
import { ThemePicker, SunIcon, MoonIcon } from '@wolffm/task-ui-components'
import '@wolffm/task-ui-components/theme-picker.css'

const THEME_FAMILIES = [
  {
    lightIcon: <SunIcon />,
    darkIcon: <MoonIcon />,
    lightTheme: 'light',
    darkTheme: 'dark',
    lightLabel: 'Light',
    darkLabel: 'Dark'
  }
  // ... more themes
]

function App() {
  const [theme, setTheme] = useState('light')
  const [showPicker, setShowPicker] = useState(false)

  return (
    <ThemePicker
      currentTheme={theme}
      isOpen={showPicker}
      themeFamilies={THEME_FAMILIES}
      onThemeChange={setTheme}
      onToggle={() => setShowPicker(!showPicker)}
      onSettingsClick={() => console.log('Settings clicked')}
    />
  )
}
```

### With Automatic Fallback Icons (No Icons Needed!)

Perfect when using your own theme system without the `@wolffm/themes` package:

```tsx
import { ThemePicker } from '@wolffm/task-ui-components'
import '@wolffm/task-ui-components/theme-picker.css'
import './my-custom-themes.css' // Your own theme CSS

const THEME_FAMILIES = [
  {
    // Icons will be automatically assigned (CircleIcon for first theme)
    lightTheme: 'ocean-light',
    darkTheme: 'ocean-dark',
    lightLabel: 'Ocean Light',
    darkLabel: 'Ocean Dark'
  },
  {
    // SquareIcon for second theme
    lightTheme: 'forest-light',
    darkTheme: 'forest-dark',
    lightLabel: 'Forest Light',
    darkLabel: 'Forest Dark'
  },
  {
    // TriangleIcon for third theme
    lightTheme: 'sunset-light',
    darkTheme: 'sunset-dark',
    lightLabel: 'Sunset Light',
    darkLabel: 'Sunset Dark'
  }
]

function App() {
  const [theme, setTheme] = useState('ocean-light')
  const [showPicker, setShowPicker] = useState(false)

  return (
    <ThemePicker
      currentTheme={theme}
      isOpen={showPicker}
      themeFamilies={THEME_FAMILIES}
      onThemeChange={setTheme}
      onToggle={() => setShowPicker(!showPicker)}
    />
  )
}
```

## CSS Variables

The ThemePicker requires these CSS variables to be defined by your theme system:

```css
:root {
  --color-text: #000000;
  --color-primary: #3b82f6;
  --color-primary-hover: rgba(59, 130, 246, 0.1);
  --color-primary-bg: rgba(59, 130, 246, 0.05);
  --color-bg-card: #ffffff;
  --color-text-secondary: #64748b;
  --shadow-focus-sm: 0 0 0 2px rgba(59, 130, 246, 0.25);
  --shadow-md: 0 2px 4px rgba(0, 0, 0, 0.1);
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.15);
  --transition-fast: 0.15s ease;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --font-size-lg: 18px;
  --font-weight-semibold: 600;
}
```

## Icons

### Theme-Specific Icons

Available themed icons for specific aesthetics:

- `SunIcon` - Sun/light mode icon
- `MoonIcon` - Moon/dark mode icon
- `StrawberryIcon` - Strawberry fruit icon
- `WaveIcon` - Ocean wave icon
- `ZapIcon` - Lightning bolt icon (cyberpunk)
- `CoffeeIcon` - Coffee cup icon
- `FlowerIcon` - Flower/lavender icon
- `HeartIcon` - Heart icon (pink theme)
- `LeafIcon` - Leaf icon (nature theme)
- `SettingsIcon` - Gear/settings icon
- `TagIcon` - Tag/label icon
- `SpaIcon` - Hot spring/spa icon (izakaya theme)

### Generic/Fallback Icons

When you don't have specific icons for your themes, use generic shape icons for visual differentiation:

- `CircleIcon` - Simple circle
- `SquareIcon` - Rounded square
- `TriangleIcon` - Triangle
- `DiamondIcon` - Diamond shape
- `StarIcon` - Star shape
- `HexagonIcon` - Hexagon
- `PentagonIcon` - Pentagon
- `OctagonIcon` - Octagon

**Automatic Fallback:**

The `ThemePicker` component automatically uses fallback icons if you don't provide any:

```tsx
import { ThemePicker } from '@wolffm/task-ui-components'

const THEME_FAMILIES = [
  {
    // No icons provided - will use CircleIcon automatically
    lightTheme: 'custom-light',
    darkTheme: 'custom-dark',
    lightLabel: 'Custom Light',
    darkLabel: 'Custom Dark'
  },
  {
    // No icons provided - will use SquareIcon automatically
    lightTheme: 'another-light',
    darkTheme: 'another-dark',
    lightLabel: 'Another Light',
    darkLabel: 'Another Dark'
  }
]
```

**Manual Fallback Usage:**

You can also manually use fallback icons:

```tsx
import { getFallbackIcon, FALLBACK_ICONS } from '@wolffm/task-ui-components'

// Get icon by index (0-7, repeats after 8)
const icon = getFallbackIcon(0) // Returns CircleIcon
const icon2 = getFallbackIcon(5) // Returns HexagonIcon

// Or use the array directly
const CircleIconComponent = FALLBACK_ICONS[0]
const iconElement = <CircleIconComponent />
```

**Fallback Icon Sequence:**

When icons are omitted from `ThemeFamily`, they're assigned in this order:

1. `CircleIcon` (index 0)
2. `SquareIcon` (index 1)
3. `TriangleIcon` (index 2)
4. `DiamondIcon` (index 3)
5. `StarIcon` (index 4)
6. `HexagonIcon` (index 5)
7. `PentagonIcon` (index 6)
8. `OctagonIcon` (index 7)
9. Pattern repeats from `CircleIcon` for 9+ themes

This ensures each theme gets a visually distinct icon while maintaining consistency across app reloads.

## Logger

Production-safe logging utility that respects development mode and admin status.

### Basic Usage

```typescript
import { logger } from '@wolffm/task-ui-components'

// Informational logs (dev/admin only)
logger.info('[Component] Loading data', { userId: '123' })

// Debug logs (dev/admin only)
logger.debug('[Component] State updated', { isOpen: true, count: 5 })

// Warnings (always shown)
logger.warn('[Component] Deprecated API used', { feature: 'old-api' })

// Errors (always shown)
logger.error('[Component] Failed to save', {
  error: err instanceof Error ? err.message : String(err),
  taskId: 'task-123'
})
```

### Advanced Features

**Enable admin mode** for production debugging:

```typescript
// After user authentication
if (userIsAdmin) {
  logger.setAdminStatus(true)
}
```

**Specialized log methods**:

```typescript
// Component lifecycle logging
logger.component('mount', 'ThemePicker', { props })
logger.component('update', 'TaskList', { taskCount: 42 })

// Theme changes
logger.theme('strawberry-dark', { source: 'user-preference' })
logger.theme('ocean-light', { source: 'system' })
```

### Best Practices

**Always use structured logging** with a message and context object:

```typescript
// ✅ Good - Structured with context
logger.info('[TaskList] Loading tasks', { boardId, filter })

// ❌ Bad - String concatenation
logger.info(`Loading tasks for board ${boardId}`)

// ✅ Good - Proper error extraction
logger.error('[API] Request failed', {
  error: err instanceof Error ? err.message : String(err),
  endpoint: '/api/tasks'
})

// ❌ Bad - Logging error object directly
logger.error('Request failed:', err)
```

**Use component prefixes** for easy filtering:

```typescript
// Component-based prefixes
logger.info('[TaskList] Mounted')
logger.info('[ThemePicker] Theme changed')

// Feature-based prefixes
logger.info('[API] Request completed')
logger.info('[Auth] User logged in')
```

### Behavior

| Mode                 | Development | Production (Admin) | Production (User) |
| -------------------- | ----------- | ------------------ | ----------------- |
| `logger.info()`      | ✅          | ✅                 | ❌                |
| `logger.debug()`     | ✅          | ✅                 | ❌                |
| `logger.component()` | ✅          | ✅                 | ❌                |
| `logger.theme()`     | ✅          | ✅                 | ❌                |
| `logger.warn()`      | ✅          | ✅                 | ✅                |
| `logger.error()`     | ✅          | ✅                 | ✅                |

**Development Detection:**

- Automatically enabled on `localhost` or `127.0.0.1`
- Or when `import.meta.env.DEV` is true

**Admin Mode:**

- Call `logger.setAdminStatus(true)` after authentication
- Enables all logs in production for debugging
- Useful for troubleshooting production issues

## Props

### ThemePicker

| Prop              | Type                           | Required | Description                                     |
| ----------------- | ------------------------------ | -------- | ----------------------------------------------- |
| `currentTheme`    | `string`                       | ✅       | Currently active theme name                     |
| `isOpen`          | `boolean`                      | ✅       | Whether the picker dropdown is visible          |
| `themeFamilies`   | `ThemeFamily[]`                | ✅       | Array of theme families to display              |
| `onThemeChange`   | `(theme: string) => void`      | ✅       | Callback when theme is selected                 |
| `onToggle`        | `() => void`                   | ✅       | Callback to toggle picker visibility            |
| `onSettingsClick` | `() => void`                   | ❌       | Optional callback for settings button           |
| `getThemeIcon`    | `(theme: string) => ReactNode` | ❌       | Optional function to get icon for current theme |
| `className`       | `string`                       | ❌       | Optional CSS class for container                |

### ThemeFamily

| Prop         | Type        | Required | Description                                       |
| ------------ | ----------- | -------- | ------------------------------------------------- |
| `lightIcon`  | `ReactNode` | ❌       | Icon for light variant (auto-fallback if omitted) |
| `darkIcon`   | `ReactNode` | ❌       | Icon for dark variant (auto-fallback if omitted)  |
| `lightTheme` | `string`    | ✅       | Theme name for light variant                      |
| `darkTheme`  | `string`    | ✅       | Theme name for dark variant                       |
| `lightLabel` | `string`    | ✅       | Label for light variant (tooltip)                 |
| `darkLabel`  | `string`    | ✅       | Label for dark variant (tooltip)                  |

## License

MIT
