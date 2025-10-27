/**
 * Theme Picker UI Component
 * A simple, framework-agnostic theme picker that can be used in any project
 * 
 * Usage:
 * ```typescript
 * import { createThemePicker, THEMES } from '@wolffm/themes'
 * 
 * const picker = createThemePicker({
 *   currentTheme: 'dark',
 *   onThemeChange: (theme) => setTheme(theme),
 *   container: document.getElementById('theme-picker-container')
 * })
 * ```
 */

import { THEMES, type Theme, setTheme as applyTheme } from './index.js'

export interface ThemePickerOptions {
  /** Current active theme */
  currentTheme?: Theme
  /** Callback when theme changes */
  onThemeChange?: (theme: Theme) => void
  /** Container element to render into */
  container?: HTMLElement
  /** Include experimental themes (pink) */
  includeExperimental?: boolean
}

export interface ThemeFamily {
  name: string
  lightTheme: Theme
  darkTheme: Theme
  icon: string
}

export const BASE_THEME_FAMILIES: ThemeFamily[] = [
  { name: 'Default', lightTheme: 'light', darkTheme: 'dark', icon: '☀️' },
  { name: 'Strawberry', lightTheme: 'strawberry-light', darkTheme: 'strawberry-dark', icon: '🍓' },
  { name: 'Ocean', lightTheme: 'ocean-light', darkTheme: 'ocean-dark', icon: '🌊' },
  { name: 'Cyberpunk', lightTheme: 'cyberpunk-light', darkTheme: 'cyberpunk-dark', icon: '⚡' },
  { name: 'Coffee', lightTheme: 'coffee-light', darkTheme: 'coffee-dark', icon: '☕' },
  { name: 'Lavender', lightTheme: 'lavender-light', darkTheme: 'lavender-dark', icon: '🌸' },
]

export const EXPERIMENTAL_THEME_FAMILIES: ThemeFamily[] = [
  { name: 'Pink', lightTheme: 'pink-light', darkTheme: 'pink-dark', icon: '💖' },
]

/**
 * Create a simple theme picker UI
 * Returns an object with methods to control the picker
 */
export function createThemePicker(options: ThemePickerOptions = {}) {
  const {
    currentTheme = 'light',
    onThemeChange,
    container,
    includeExperimental = false
  } = options

  let activeTheme = currentTheme
  const families = includeExperimental 
    ? [...BASE_THEME_FAMILIES, ...EXPERIMENTAL_THEME_FAMILIES]
    : BASE_THEME_FAMILIES

  const pickerElement = document.createElement('div')
  pickerElement.className = 'hadoku-theme-picker'
  pickerElement.innerHTML = `
    <div class="hadoku-theme-picker__grid">
      ${families.map(family => `
        <div class="hadoku-theme-picker__family">
          <div class="hadoku-theme-picker__family-name">${family.icon} ${family.name}</div>
          <div class="hadoku-theme-picker__buttons">
            <button 
              class="hadoku-theme-picker__btn hadoku-theme-picker__btn--light" 
              data-theme="${family.lightTheme}"
              aria-label="${family.name} Light"
            >
              Light
            </button>
            <button 
              class="hadoku-theme-picker__btn hadoku-theme-picker__btn--dark" 
              data-theme="${family.darkTheme}"
              aria-label="${family.name} Dark"
            >
              Dark
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `

  // Add click handlers
  pickerElement.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('hadoku-theme-picker__btn')) {
      const theme = target.getAttribute('data-theme') as Theme
      if (theme) {
        applyTheme(theme)
        if (onThemeChange) {
          onThemeChange(theme)
        }
      }
    }
  })

  // Render if container provided
  if (container) {
    container.appendChild(pickerElement)
  }

  // Update active state
  function updateActiveState(theme: Theme) {
    activeTheme = theme
    pickerElement.querySelectorAll('.hadoku-theme-picker__btn').forEach(btn => {
      if (btn.getAttribute('data-theme') === theme) {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
    })
  }

  updateActiveState(currentTheme)

  return {
    element: pickerElement,
    setTheme: (theme: Theme) => {
      applyTheme(theme)
      updateActiveState(theme)
    },
    destroy: () => {
      pickerElement.remove()
    }
  }
}

/**
 * Helper to inject basic theme picker styles
 * Call this once to add default styles to the page
 */
export function injectThemePickerStyles() {
  if (document.getElementById('hadoku-theme-picker-styles')) return

  const style = document.createElement('style')
  style.id = 'hadoku-theme-picker-styles'
  style.textContent = `
    .hadoku-theme-picker {
      padding: 1rem;
      background: var(--color-bg-card);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-md);
    }

    .hadoku-theme-picker__grid {
      display: grid;
      gap: 1rem;
    }

    .hadoku-theme-picker__family {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .hadoku-theme-picker__family-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-secondary);
    }

    .hadoku-theme-picker__buttons {
      display: flex;
      gap: 0.5rem;
    }

    .hadoku-theme-picker__btn {
      flex: 1;
      padding: 0.5rem 1rem;
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .hadoku-theme-picker__btn:hover {
      background: var(--color-primary-hover);
      border-color: var(--color-primary);
    }

    .hadoku-theme-picker__btn.active {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary-dark);
      font-weight: 600;
    }

    .hadoku-theme-picker__btn--light {
      /* Light variant specific styles */
    }

    .hadoku-theme-picker__btn--dark {
      /* Dark variant specific styles */
    }
  `
  document.head.appendChild(style)
}
