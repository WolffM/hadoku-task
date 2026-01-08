# @wolffm/task-ui-components

Reusable UI components for task management applications. Production-ready and fully typed.

## Installation

```bash
npm install @wolffm/task-ui-components
```

## SSR Configuration (Astro/Next.js)

If using this package in an SSR environment (Astro, Next.js, etc.), add this one-time configuration:

```js
// astro.config.mjs
export default defineConfig({
  vite: {
    ssr: {
      noExternal: ['@wolffm/task-ui-components']
    }
  }
})
```

```js
// next.config.js
module.exports = {
  transpilePackages: ['@wolffm/task-ui-components']
}
```

This allows the package to bundle its CSS automatically. **This is a one-time setup** - all future component updates will work automatically without additional configuration.

## Components

### ThemePicker (Overview)

A gorgeous theme picker with light/dark pill design. Fully customizable to work with any theme system.

### Modal (Overview)

Generic modal dialog with keyboard shortcuts, customizable actions, and optional input field.

### ContextMenu (Overview)

Position-based context menu with customizable items and danger states.

### LoadingSkeleton (Overview)

Flexible loading skeleton with multiple layouts (default, minimal, custom) and dark theme support.

### SettingsModal (Overview)

Generic settings dialog with section-based organization and multiple field types (toggle, text, password, select, button, custom).

### Toast & Toaster

Toast notification system with success, error, and info variants.

## Usage

### Quick Start with @wolffm/themes (Recommended)

The easiest way to use the ThemePicker is with the `@wolffm/themes` package:

```tsx
import { ConnectedThemePicker } from '@wolffm/task-ui-components'
import { useTheme, THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'
import '@wolffm/themes/style.css'

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

**Note:** CSS is automatically imported by components - no manual CSS imports needed!

### Using ConnectedThemePicker (Stateful)

`ConnectedThemePicker` manages its own open/close state:

```tsx
import { ConnectedThemePicker } from '@wolffm/task-ui-components'

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

Perfect when using your own theme system:

```tsx
import { ThemePicker } from '@wolffm/task-ui-components'
import './my-custom-style.css' // Your own theme CSS

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

---

## Additional Components Documentation

### Modal (API Reference)

Generic modal dialog with keyboard shortcuts and customizable actions.

**Features:**

- Keyboard shortcuts (Enter to confirm, Escape to close)
- Optional input field with auto-focus
- Configurable buttons (show/hide cancel/confirm)
- Danger variant for destructive actions
- Custom class names for styling

**Usage:**

```tsx
import { Modal } from '@wolffm/task-ui-components'

function MyComponent() {
const [isOpen, setIsOpen] = useState(false)
const [value, setValue] = useState('')

return (
<Modal
isOpen={isOpen}
title="Create Item"
onClose={() => setIsOpen(false)}
onConfirm={async () => {
await createItem(value)
setIsOpen(false)
}}
inputValue={value}
onInputChange={setValue}
inputPlaceholder="Enter name..."
confirmLabel="Create"
confirmDisabled={!value.trim()}>
  <p>Enter a name for your new item.</p>
</Modal>
)
}
```

**Props:**

| Prop                 | Type                        | Required  | Description                            |
| -------------------- | --------------------------- | --------- | -------------------------------------- | ---------------- |
| \`isOpen\`           | \`boolean\`                 | ✅        | Whether modal is visible               |
| \`title\`            | \`string\`                  | ✅        | Modal title                            |
| \`onClose\`          | \`() => void\`              | ✅        | Close callback                         |
| \`onConfirm\`        | \`() => void \| Promise<void>\` | ❌        | Confirm callback                       |
| \`children\`         | \`ReactNode\`               | ❌        | Modal content                          |
| \`inputValue\`       | \`string\`                  | ❌        | Input field value                      |
| \`onInputChange\`    | \`(value: string) => void\` | ❌        | Input change callback                  |
| \`inputPlaceholder\` | \`string\`                  | ❌        | Input placeholder                      |
| \`confirmLabel\`     | \`string\`                  | ❌        | Confirm button text (default: Confirm) |
| \`cancelLabel\`      | \`string\`                  | ❌        | Cancel button text (default: Cancel)   |
| \`confirmDisabled\`  | \`boolean\`                 | ❌        | Disable confirm button                 |
| \`confirmDanger\`    | \`boolean\`                 | ❌        | Danger styling for confirm             |
| \`showCancel\`       | \`boolean\`                 | ❌        | Show cancel button (default: true)     |
| \`showConfirm\`      | \`boolean\`                 | ❌        | Show confirm button (default: true)    |
| \`className\`        | \`string\`                  | ❌        | Custom CSS class                       |
| \`overlayClassName\` | \`string\`                  | ❌        | Custom overlay CSS class               |

---

### ContextMenu (API Reference)

Position-based context menu for right-click or contextual actions.

**Features:**

- Position-based rendering (x, y coordinates)
- Configurable menu items
- Danger state for destructive items
- Disabled state support
- Fixed positioning with z-index

**Usage:**

```tsx
import { ContextMenu, type ContextMenuItem } from '@wolffm/task-ui-components'

function MyComponent() {
const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

const items: ContextMenuItem[] = [
{
label: 'Edit',
onClick: () => handleEdit()
},
{
label: 'Delete',
onClick: () => handleDelete(),
isDanger: true
}
]

return (

<div onContextMenu={e => {
e.preventDefault()
setMenu({ x: e.clientX, y: e.clientY })
}}>
<ContextMenu
isOpen={!!menu}
x={menu?.x || 0}
y={menu?.y || 0}
items={items}
className="my-context-menu"
/>
</div>
)
}
```

**Props:**

| Prop          | Type                  | Required | Description             |
| ------------- | --------------------- | -------- | ----------------------- |
| \`isOpen\`    | \`boolean\`           | ✅       | Whether menu is visible |
| \`x\`         | \`number\`            | ✅       | X position (pixels)     |
| \`y\`         | \`number\`            | ✅       | Y position (pixels)     |
| \`items\`     | \`ContextMenuItem[]\` | ✅       | Menu items              |
| \`className\` | \`string\`            | ❌       | Custom CSS class        |

**ContextMenuItem:**

| Prop         | Type            | Required  | Description    |
| ------------ | --------------- | --------- | -------------- | ------------- |
| \`label\`    | \`string\`      | ✅        | Item label     |
| \`onClick\`  | \`() => void \\ | Promise\` | ✅             | Click handler |
| \`isDanger\` | \`boolean\`     | ❌        | Danger styling |
| \`disabled\` | \`boolean\`     | ❌        | Disable item   |

---

### LoadingSkeleton (API Reference)

Flexible loading skeleton with multiple layout options.

**Features:**

- Multiple layout options (default, minimal, custom)
- Dark theme support
- Customizable content via \`customContent\` prop

**Usage:**

```tsx
import { LoadingSkeleton } from '@wolffm/task-ui-components'

function MyComponent() {
const [isLoading, setIsLoading] = useState(true)
const isDark = useTheme() === 'dark'

if (isLoading) {
return <LoadingSkeleton isDarkTheme={isDark} layout="minimal" />
}

return <div>Content loaded!</div>
}
```

**Props:**

| Prop              | Type           | Required     | Description             |
| ----------------- | -------------- | ------------ | ----------------------- | --- | -------------------------------- |
| \`isDarkTheme\`   | \`boolean\`    | ❌           | Dark theme mode         |
| \`className\`     | \`string\`     | ❌           | Custom CSS class        |
| \`layout\`        | \`'default' \\ | 'minimal' \\ | 'custom'\`              | ❌  | Layout type (default: 'default') |
| \`customContent\` | \`ReactNode\`  | ❌           | Custom skeleton content |

---

### SettingsModal (API Reference)

Generic settings dialog with section-based organization.

**Features:**

- Section-based organization
- Multiple field types: toggle, text, password, select, button, custom
- Validation support
- Description text for fields

**Usage:**

```tsx
import { SettingsModal, type SettingsSection } from '@wolffm/task-ui-components'

function MyApp() {
const [isOpen, setIsOpen] = useState(false)
const [darkMode, setDarkMode] = useState(false)
const [language, setLanguage] = useState('en')

const sections: SettingsSection[] = [
{
id: 'display',
title: 'Display Settings',
fields: [
{
type: 'toggle',
id: 'darkMode',
label: 'Dark Mode',
description: 'Use dark color scheme',
value: darkMode,
onChange: setDarkMode
},
{
type: 'select',
id: 'language',
label: 'Language',
value: language,
onChange: setLanguage,
options: [
{ value: 'en', label: 'English' },
{ value: 'es', label: 'Spanish' }
]
}
]
}
]

return (
<SettingsModal
isOpen={isOpen}
sections={sections}
onClose={() => setIsOpen(false)}
/>
)
}
```

**Props:**

| Prop                | Type                  | Required | Description                       |
| ------------------- | --------------------- | -------- | --------------------------------- |
| \`isOpen\`          | \`boolean\`           | ✅       | Whether modal is visible          |
| \`sections\`        | \`SettingsSection[]\` | ✅       | Settings sections                 |
| \`onClose\`         | \`() => void\`        | ✅       | Close callback                    |
| \`title\`           | \`string\`            | ❌       | Modal title (default: 'Settings') |
| \`className\`       | \`string\`            | ❌       | Custom CSS class                  |
| \`showCloseButton\` | \`boolean\`           | ❌       | Show close button (default: true) |

**Field Types:**

```typescript
// Toggle field
{
type: 'toggle',
id: string,
label: string,
description?: string,
value: boolean,
onChange: (value: boolean) => void,
disabled?: boolean
}

// Text input field
{
type: 'text',
id: string,
label: string,
description?: string,
value: string,
onChange: (value: string) => void,
placeholder?: string,
disabled?: boolean
}

// Password field
{
type: 'password',
id: string,
label: string,
description?: string,
value: string,
onChange: (value: string) => void,
placeholder?: string,
showButton?: boolean,
buttonLabel?: string,
onButtonClick?: () => void | Promise<void>,
buttonDisabled?: boolean,
error?: string | null,
autoComplete?: string,
disabled?: boolean
}

// Select dropdown
{
type: 'select',
id: string,
label: string,
description?: string,
value: string,
onChange: (value: string) => void,
options: Array<{ value: string; label: string }>,
disabled?: boolean
}

// Action button
{
type: 'button',
id: string,
label?: string,
description?: string,
buttonLabel: string,
onClick: () => void | Promise<void>,
variant?: 'primary' | 'danger' | 'default',
disabled?: boolean
}

// Custom component
{
type: 'custom',
id: string,
label?: string,
description?: string,
render: () => ReactNode,
disabled?: boolean
}
```
