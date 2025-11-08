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
  },
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

Available theme icons:

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

## Props

### ThemePicker

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `currentTheme` | `string` | ✅ | Currently active theme name |
| `isOpen` | `boolean` | ✅ | Whether the picker dropdown is visible |
| `themeFamilies` | `ThemeFamily[]` | ✅ | Array of theme families to display |
| `onThemeChange` | `(theme: string) => void` | ✅ | Callback when theme is selected |
| `onToggle` | `() => void` | ✅ | Callback to toggle picker visibility |
| `onSettingsClick` | `() => void` | ❌ | Optional callback for settings button |
| `getThemeIcon` | `(theme: string) => ReactNode` | ❌ | Optional function to get icon for current theme |
| `className` | `string` | ❌ | Optional CSS class for container |

### ThemeFamily

| Prop | Type | Description |
|------|------|-------------|
| `lightIcon` | `ReactNode` | Icon for light variant |
| `darkIcon` | `ReactNode` | Icon for dark variant |
| `lightTheme` | `string` | Theme name for light variant |
| `darkTheme` | `string` | Theme name for dark variant |
| `lightLabel` | `string` | Label for light variant (tooltip) |
| `darkLabel` | `string` | Label for dark variant (tooltip) |

## License

MIT
