// Auto-generated bundle — do not edit directly.
// Source: color-utils.js, config.js, editor.js
// Rebuild: node themes/dev/build.js
;(function () {
  'use strict'

  // ===== color-utils.js =====
  // Pure color conversion utilities — no DOM dependencies

  function colorToHex(color) {
    if (color.startsWith('#')) return color
    if (color.startsWith('rgb')) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (match) {
        const r = parseInt(match[1]).toString(16).padStart(2, '0')
        const g = parseInt(match[2]).toString(16).padStart(2, '0')
        const b = parseInt(match[3]).toString(16).padStart(2, '0')
        const a = match[4]
          ? Math.round(parseFloat(match[4]) * 255)
              .toString(16)
              .padStart(2, '0')
          : 'ff'
        return `#${r}${g}${b}${a === 'ff' ? '' : a}`
      }
    }
    // Fallback: use canvas to convert any CSS color to RGB
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    if (a < 255) return hex + Math.round(a).toString(16).padStart(2, '0')
    return hex
  }

  function hexToHsl(hex) {
    hex = hex.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    const a = hex.length > 6 ? (parseInt(hex.slice(6, 8), 16) / 255) * 100 : 100

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    let h, s

    if (max === min) {
      h = s = 0
    } else {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6
          break
        case g:
          h = ((b - r) / d + 2) / 6
          break
        case b:
          h = ((r - g) / d + 4) / 6
          break
      }
    }

    return { h: h * 360, s: s * 100, l: l * 100, a }
  }

  function hslToHex(h, s, l, a = 100) {
    h /= 360
    s /= 100
    l /= 100

    let r, g, b
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }

    const toHex = x =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0')
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`

    if (a < 100) {
      return (
        hex +
        Math.round(a * 2.55)
          .toString(16)
          .padStart(2, '0')
      )
    }
    return hex
  }

  function oklchToDisplayColor(l, c, h) {
    // Use canvas to reliably convert oklch to RGB (getComputedStyle may return oklch as-is)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = `oklch(${l} ${c} ${h})`
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }

  function getContrastColor(color) {
    const hex = colorToHex(color).replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.5 ? '#000000' : '#ffffff'
  }

  // ===== config.js =====
  // Editor configuration — themes, color variables, cascade maps, and SVG icons
  // Icons match the React components from @wolffm/task-ui-components exactly

  const iconAttrs =
    'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

  // SVG icons (same paths as ThemeIcons.tsx in task-ui-components)
  const THEME_ICONS = {
    sun: `<svg ${iconAttrs}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg ${iconAttrs}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    strawberry: `<svg ${iconAttrs}><path d="M12 21 C12 21 6.5 15 6.5 11 C6.5 8.5 8 7 10 7 C11 7 12 7.5 12 7.5 C12 7.5 13 7 14 7 C16 7 17.5 8.5 17.5 11 C17.5 15 12 21 12 21 Z" fill="currentColor"/><path d="M9.5 7.5 L9 5 L11 5.5 Z" fill="currentColor"/><path d="M14.5 7.5 L15 5 L13 5.5 Z" fill="currentColor"/><path d="M12 7.5 L12 4 L12 5" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="10" y1="10" x2="10" y2="11" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="14" y1="10" x2="14" y2="11" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="9" y1="13" x2="9" y2="14" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="15" y1="13" x2="15" y2="14" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="11" y1="16" x2="11" y2="17" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="13" y1="16" x2="13" y2="17" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>`,
    wave: `<svg ${iconAttrs}><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`,
    zap: `<svg ${iconAttrs}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    coffee: `<svg ${iconAttrs}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
    flower: `<svg ${iconAttrs}><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
    leaf: `<svg ${iconAttrs}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" fill="currentColor"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9 14.5 11 14 11 20" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 8c3 2 5 4 7 7" stroke="white" stroke-width="1.5" opacity="0.4"/></svg>`,
    heart: `<svg ${iconAttrs}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor"/></svg>`,
    spa: `<svg ${iconAttrs}><path d="M8 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M12 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M16 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M4 14c0-3 1.5-4 4-4s4 1 4 4v4c0 2-1 2-4 2s-4 0-4-2v-4z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="8" cy="14" rx="4" ry="1.5" fill="currentColor" opacity="0.3"/><circle cx="17" cy="18" r="2" fill="currentColor" opacity="0.4"/><circle cx="20" cy="16" r="1.5" fill="currentColor" opacity="0.4"/></svg>`
  }

  // Theme families — mirrors THEME_FAMILIES from @wolffm/themes metadata.tsx
  // Colors extracted from style.css so the picker shows real theme accents
  const THEME_FAMILIES = [
    {
      lightTheme: 'light',
      darkTheme: 'dark',
      label: 'Default',
      icon: 'sun',
      darkIcon: 'moon',
      lightPrimary: '#2563eb',
      darkPrimary: '#d8b4fe',
      lightBg: '#f8fafc',
      darkBg: '#0f172a'
    },
    {
      lightTheme: 'strawberry-light',
      darkTheme: 'strawberry-dark',
      label: 'Strawberry',
      icon: 'strawberry',
      darkIcon: 'strawberry',
      lightPrimary: '#ff6b9d',
      darkPrimary: '#ff6b9d',
      lightBg: '#fffbfc',
      darkBg: '#1a0d14'
    },
    {
      lightTheme: 'ocean-light',
      darkTheme: 'ocean-dark',
      label: 'Ocean',
      icon: 'wave',
      darkIcon: 'wave',
      lightPrimary: '#06b6d4',
      darkPrimary: '#06b6d4',
      lightBg: '#f0f9ff',
      darkBg: '#082f49'
    },
    {
      lightTheme: 'cyberpunk-light',
      darkTheme: 'cyberpunk-dark',
      label: 'Cyberpunk',
      icon: 'zap',
      darkIcon: 'zap',
      lightPrimary: '#ff006e',
      darkPrimary: '#22d3ee',
      lightBg: '#fafafe',
      darkBg: '#020617'
    },
    {
      lightTheme: 'coffee-light',
      darkTheme: 'coffee-dark',
      label: 'Coffee',
      icon: 'coffee',
      darkIcon: 'coffee',
      lightPrimary: '#ea580c',
      darkPrimary: '#ea580c',
      lightBg: '#fffbeb',
      darkBg: '#1c1917'
    },
    {
      lightTheme: 'lavender-light',
      darkTheme: 'lavender-dark',
      label: 'Lavender',
      icon: 'flower',
      darkIcon: 'flower',
      lightPrimary: '#c084fc',
      darkPrimary: '#c084fc',
      lightBg: '#fafafa',
      darkBg: '#1a0f1e'
    },
    {
      lightTheme: 'nature-light',
      darkTheme: 'nature-dark',
      label: 'Nature',
      icon: 'leaf',
      darkIcon: 'leaf',
      lightPrimary: '#6bbe4e',
      darkPrimary: '#5faf4b',
      lightBg: '#f9f7ee',
      darkBg: '#1e1c17'
    },
    {
      lightTheme: 'pink-light',
      darkTheme: 'pink-dark',
      label: 'Pink',
      icon: 'heart',
      darkIcon: 'heart',
      lightPrimary: '#ff69b4',
      darkPrimary: '#ff10f0',
      lightBg: '#fffafc',
      darkBg: '#0d0012'
    },
    {
      lightTheme: 'izakaya-light',
      darkTheme: 'izakaya-dark',
      label: 'Izakaya',
      icon: 'spa',
      darkIcon: 'spa',
      lightPrimary: '#41baae',
      darkPrimary: '#41baae',
      lightBg: '#f2e6cd',
      darkBg: '#101d26'
    }
  ]

  // Maps theme name → icon key for the toggle button
  const THEME_ICON_MAP = {}
  THEME_FAMILIES.forEach(f => {
    THEME_ICON_MAP[f.lightTheme] = f.icon
    THEME_ICON_MAP[f.darkTheme] = f.darkIcon
  })

  const COLOR_VARS = {
    primary: [
      '--color-primary',
      '--color-primary-dark',
      '--color-primary-light',
      '--color-primary-bg',
      '--color-primary-hover',
      '--color-on-primary'
    ],
    success: [
      '--color-success',
      '--color-success-dark',
      '--color-on-success',
      '--color-success-bg',
      '--color-success-hover'
    ],
    warning: [
      '--color-warning',
      '--color-warning-bg',
      '--color-on-warning',
      '--color-warning-hover'
    ],
    danger: [
      '--color-danger',
      '--color-danger-dark',
      '--color-danger-darker',
      '--color-danger-light',
      '--color-on-danger',
      '--color-danger-hover'
    ],
    neutral: [
      '--color-neutral',
      '--color-neutral-light',
      '--color-neutral-lighter',
      '--color-on-neutral',
      '--color-neutral-hover',
      '--color-muted-bg'
    ],
    text: ['--color-text', '--color-text-secondary', '--color-text-tertiary', '--color-text-muted'],
    border: ['--color-border', '--color-border-light'],
    bg: [
      '--color-bg',
      '--color-bg-card',
      '--color-bg-alt',
      '--color-bg-hover',
      '--color-bg-overlay'
    ]
  }

  // Root colors that auto-cascade to derived variants when changed
  const CASCADE_MAP = {
    '--color-primary': {
      '--color-primary-dark': (h, s, l) => ({ h, s, l: Math.max(0, l - 15) }),
      '--color-primary-light': (h, s, l, isDark) =>
        isDark
          ? { h, s: Math.max(0, s - 30), l: Math.max(0, l - 30) }
          : { h, s: Math.min(100, s - 20), l: Math.min(100, l + 25) },
      '--color-primary-bg': (h, s, l, isDark) =>
        isDark
          ? { h, s: Math.max(0, s - 40), l: 15, a: 100 }
          : { h, s: Math.min(100, s - 10), l: 97, a: 100 },
      '--color-primary-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 15 : 8 })
    },
    '--color-success': {
      '--color-success-dark': (h, s, l) => ({ h, s, l: Math.max(0, l - 12) }),
      '--color-success-bg': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 15 : 10 }),
      '--color-success-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 })
    },
    '--color-warning': {
      '--color-warning-bg': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 15 : 10 }),
      '--color-warning-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 })
    },
    '--color-danger': {
      '--color-danger-dark': (h, s, l) => ({ h, s, l: Math.max(0, l - 10) }),
      '--color-danger-darker': (h, s, l) => ({ h, s, l: Math.max(0, l - 20) }),
      '--color-danger-light': (h, s, l, isDark) =>
        isDark
          ? { h, s: Math.max(0, s - 30), l: Math.max(0, l - 35) }
          : { h, s: Math.min(100, s - 20), l: Math.min(100, l + 30) },
      '--color-danger-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 })
    },
    '--color-neutral': {
      '--color-neutral-light': (h, s, l, isDark) =>
        isDark
          ? { h, s, l: Math.max(0, l - 15) }
          : { h, s: Math.max(0, s - 10), l: Math.min(100, l + 20) },
      '--color-neutral-lighter': (h, s, l, isDark) =>
        isDark
          ? { h, s, l: Math.max(0, l - 25) }
          : { h, s: Math.max(0, s - 15), l: Math.min(100, l + 30) },
      '--color-neutral-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 }),
      '--color-muted-bg': (h, s, l, isDark) =>
        isDark
          ? { h, s, l: Math.max(0, l - 15) }
          : { h, s: Math.max(0, s - 10), l: Math.min(100, l + 15) }
    },
    '--color-bg': {
      '--color-bg-card': (h, s, l, isDark) =>
        isDark ? { h, s, l: Math.min(100, l + 3) } : { h, s, l: Math.min(100, l + 2) },
      '--color-bg-alt': (h, s, l, isDark) =>
        isDark ? { h, s, l: Math.max(0, l - 2) } : { h, s, l: Math.max(0, l - 3) },
      '--color-bg-hover': (h, s, l, isDark) =>
        isDark ? { h, s, l: Math.min(100, l + 5) } : { h, s, l: Math.max(0, l - 4) }
    }
  }

  // Maps root colors to their auto-calculated contrast text colors
  const TEXT_CONTRAST_MAP = {
    '--color-primary': '--color-on-primary',
    '--color-success': '--color-on-success',
    '--color-warning': '--color-on-warning',
    '--color-danger': '--color-on-danger',
    '--color-neutral': '--color-on-neutral'
  }

  // Gradient stop configuration for advanced themes
  // Each stop has a position and 3 OKLCH channel vars (lightness, chroma, hue)
  const GRADIENT_VARS = {
    'beach-day': {
      angle: 135,
      stops: [
        {
          position: '0%',
          vars: { l: '--advanced-stop-1-l', c: '--advanced-stop-1-c', h: '--advanced-stop-1-h' }
        },
        {
          position: '15%',
          vars: { l: '--advanced-stop-2-l', c: '--advanced-stop-2-c', h: '--advanced-stop-2-h' }
        },
        {
          position: '30%',
          vars: { l: '--advanced-stop-3-l', c: '--advanced-stop-3-c', h: '--advanced-stop-3-h' }
        },
        {
          position: '45%',
          vars: { l: '--advanced-stop-4-l', c: '--advanced-stop-4-c', h: '--advanced-stop-4-h' }
        },
        {
          position: '55%',
          vars: { l: '--advanced-stop-5-l', c: '--advanced-stop-5-c', h: '--advanced-stop-5-h' }
        },
        {
          position: '70%',
          vars: { l: '--advanced-stop-6-l', c: '--advanced-stop-6-c', h: '--advanced-stop-6-h' }
        },
        {
          position: '85%',
          vars: { l: '--advanced-stop-7-l', c: '--advanced-stop-7-c', h: '--advanced-stop-7-h' }
        },
        {
          position: '100%',
          vars: { l: '--advanced-stop-8-l', c: '--advanced-stop-8-c', h: '--advanced-stop-8-h' }
        }
      ]
    }
  }

  // Maps base themes to their advanced theme package
  const ADVANCED_THEME_MAP = {
    light: 'beach-day'
  }

  const LOCAL_SERVER_URL = 'http://localhost:3456'
  const WORKER_URL = 'https://api.hadoku.me'

  // ===== editor.js =====

  // ===== State =====
  let currentTheme = 'light'
  let currentVar = null
  let modifications = {}
  const originalValues = {}
  let pickerOpen = false
  let simpleMode = false

  // ===== DOM Helpers =====
  const $ = id => document.getElementById(id)
  const $$ = sel => document.querySelectorAll(sel)
  const $q = sel => document.querySelector(sel)

  function getVarValue(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  }

  // ===== Initialization =====
  function init() {
    renderThemePicker()
    renderSwatches()
    renderCompactVars()
    setupClickHandlers()
    saveOriginalValues()
    updateThemePreview()
    renderGradientSection()
    updateModeToggle()
  }

  // ===== Theme Picker — compact swatch grid =====
  function renderThemePicker() {
    const iconKey = THEME_ICON_MAP[currentTheme] || 'moon'
    const currentIcon = THEME_ICONS[iconKey] || THEME_ICONS.moon

    let html = `
    <button class="tp-toggle" onclick="editor.togglePicker()" aria-label="Choose theme" title="Choose theme">
      <span class="tp-toggle__icon">${currentIcon}</span>
      <span class="tp-toggle__label">${currentTheme}</span>
      <svg class="tp-toggle__caret ${pickerOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  `

    if (pickerOpen) {
      html += `
      <div class="tp-dropdown" onclick="event.stopPropagation()">
        ${THEME_FAMILIES.map(family => {
          const icon = THEME_ICONS[family.icon] || THEME_ICONS.moon
          const isLightActive = currentTheme === family.lightTheme
          const isDarkActive = currentTheme === family.darkTheme
          return `
            <div class="tp-family ${isLightActive || isDarkActive ? 'tp-family--active' : ''}">
              <div class="tp-family__label">${family.label}</div>
              <div class="tp-family__swatches">
                <button class="tp-swatch ${isLightActive ? 'tp-swatch--active' : ''}"
                  style="background: ${family.lightBg}; color: ${family.lightPrimary}; border-color: ${isLightActive ? family.lightPrimary : 'transparent'};"
                  onclick="editor.setTheme('${family.lightTheme}')"
                  title="${family.label} Light" aria-label="${family.label} Light">
                  <span class="tp-swatch__icon">${icon}</span>
                  <span class="tp-swatch__dot" style="background: ${family.lightPrimary};"></span>
                </button>
                <button class="tp-swatch ${isDarkActive ? 'tp-swatch--active' : ''}"
                  style="background: ${family.darkBg}; color: ${family.darkPrimary}; border-color: ${isDarkActive ? family.darkPrimary : 'transparent'};"
                  onclick="editor.setTheme('${family.darkTheme}')"
                  title="${family.label} Dark" aria-label="${family.label} Dark">
                  <span class="tp-swatch__icon">${icon}</span>
                  <span class="tp-swatch__dot" style="background: ${family.darkPrimary};"></span>
                </button>
              </div>
            </div>
          `
        }).join('')}
      </div>
      <div class="tp-overlay" onclick="editor.togglePicker()"></div>
    `
    }

    $('themePicker').innerHTML = html
  }

  function togglePicker() {
    pickerOpen = !pickerOpen
    renderThemePicker()
  }

  // ===== Rendering =====
  function renderCompactVars() {
    const categories = [
      { name: 'Primary', vars: COLOR_VARS.primary },
      { name: 'Success', vars: COLOR_VARS.success },
      { name: 'Warning', vars: COLOR_VARS.warning },
      { name: 'Danger', vars: COLOR_VARS.danger },
      { name: 'Neutral', vars: COLOR_VARS.neutral },
      { name: 'Text', vars: COLOR_VARS.text },
      { name: 'Border', vars: COLOR_VARS.border },
      { name: 'Background', vars: COLOR_VARS.bg }
    ]

    const totalVars = categories.reduce((sum, c) => sum + c.vars.length, 0)
    $('totalVarsCount').textContent = `${totalVars} vars`

    $('compactVarsContainer').innerHTML = categories
      .map(
        cat => `
    <div class="compact-vars-section">
      <h4>${cat.name} <span class="count">(${cat.vars.length})</span></h4>
      <div class="compact-vars-grid">
        ${cat.vars
          .map(varName => {
            const shortName = varName.replace('--color-', '').replace('--hdk-', '')
            return `
            <div class="compact-var" data-var="${varName}" onclick="editor.openPanel('${varName}')">
              <div class="color-box" style="--swatch-color: var(${varName});"></div>
              <span class="var-name">${shortName}</span>
            </div>
          `
          })
          .join('')}
      </div>
    </div>
  `
      )
      .join('')
  }

  function renderSwatches() {
    Object.entries(COLOR_VARS).forEach(([category, vars]) => {
      const container = $(`${category}Swatches`)
      if (!container) return

      container.innerHTML = vars
        .map(
          varName => `
      <div class="swatch" data-var="${varName}" onclick="editor.openPanel('${varName}')">
        <div class="swatch-color" style="background: var(${varName});"></div>
        <div class="swatch-info">
          <div class="swatch-name">${varName.replace('--color-', '')}</div>
          <div class="swatch-value" id="val-${varName}">${getVarValue(varName)}</div>
        </div>
      </div>
    `
        )
        .join('')
    })
  }

  function updateThemePreview() {
    const primaryCard = $('previewCardPrimary')
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]

    $('themeNameBadge').textContent = currentTheme
    $('previewThemeName').textContent =
      currentTheme
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') + ' Theme'

    if (advancedTheme && !simpleMode) {
      // Advanced theme: use gradient as preview card background
      primaryCard.className = 'preview-card-large gradient-preview'
      primaryCard.style.background = 'var(--advanced-gradient)'
      primaryCard.style.color = 'white'
      primaryCard.style.textShadow = '0 1px 3px rgba(0,0,0,0.3)'
      document.documentElement.setAttribute('data-advanced-theme', advancedTheme)
    } else {
      // Basic theme or simple mode: solid primary background
      primaryCard.className = 'preview-card-large'
      primaryCard.style.background = 'var(--color-primary)'
      primaryCard.style.color = 'var(--color-on-primary)'
      primaryCard.style.textShadow = ''
      if (!advancedTheme) {
        document.documentElement.removeAttribute('data-advanced-theme')
      }
    }

    // Update hover demo cards visibility
    const hoverDemo = $('hoverDemoSection')
    if (hoverDemo) {
      hoverDemo.style.display = advancedTheme && !simpleMode ? '' : 'none'
    }
  }

  // ===== Gradient Section =====
  function renderGradientSection() {
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]
    const section = $('gradientSection')

    if (!advancedTheme || !GRADIENT_VARS[advancedTheme] || simpleMode) {
      section.style.display = 'none'
      return
    }

    section.style.display = ''
    const config = GRADIENT_VARS[advancedTheme]
    $('gradientStopCount').textContent = `${config.stops.length} stops`

    renderGradientBar()
    renderGradientStops(config)
  }

  function renderGradientBar() {
    const bar = $('gradientBar')
    bar.style.background = 'var(--advanced-gradient)'
  }

  // ===== Mode Toggle (Basic / Advanced) =====
  function updateModeToggle() {
    const toggle = $('modeToggle')
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]

    // Only show toggle for themes that have an advanced variant
    if (!advancedTheme) {
      toggle.style.display = 'none'
      return
    }

    toggle.style.display = ''
    $('modeBtnAdvanced').classList.toggle('active', !simpleMode)
    $('modeBtnBasic').classList.toggle('active', simpleMode)
  }

  function setMode(mode) {
    simpleMode = mode === 'basic'
    document.documentElement.setAttribute('data-simple-mode', simpleMode ? 'true' : 'false')
    updateModeToggle()
    updateThemePreview()
    renderGradientSection()
  }

  function renderGradientStops(config) {
    const container = $('gradientStopsContainer')

    container.innerHTML = config.stops
      .map((stop, i) => {
        const l = parseFloat(getVarValue(stop.vars.l)) || 0
        const c = parseFloat(getVarValue(stop.vars.c)) || 0
        const h = parseFloat(getVarValue(stop.vars.h)) || 0
        const hex = oklchToDisplayColor(l, c, h)

        return `
      <div class="gradient-stop-row" data-stop-index="${i}">
        <div class="gradient-stop-swatch" style="background: ${hex};" id="stopSwatch${i}"></div>
        <div class="gradient-stop-position">${stop.position}</div>
        <div class="gradient-stop-sliders">
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>L</span><span class="oklch-slider-value" id="stopL${i}">${l}</span></div>
            <input type="range" class="oklch-slider oklch-slider--l" min="0" max="1" step="0.01" value="${l}"
              oninput="editor.handleGradientSlider(${i}, 'l', this.value)">
          </div>
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>C</span><span class="oklch-slider-value" id="stopC${i}">${c}</span></div>
            <input type="range" class="oklch-slider oklch-slider--c" min="0" max="0.4" step="0.01" value="${c}"
              oninput="editor.handleGradientSlider(${i}, 'c', this.value)">
          </div>
          <div class="oklch-slider-group">
            <div class="oklch-slider-label"><span>H</span><span class="oklch-slider-value" id="stopH${i}">${h}</span></div>
            <input type="range" class="oklch-slider oklch-slider--h" min="0" max="360" step="1" value="${h}"
              oninput="editor.handleGradientSlider(${i}, 'h', this.value)">
          </div>
        </div>
      </div>
    `
      })
      .join('')
  }

  function handleGradientSlider(stopIndex, channel, value) {
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]
    if (!advancedTheme || !GRADIENT_VARS[advancedTheme]) return

    const stop = GRADIENT_VARS[advancedTheme].stops[stopIndex]
    const varName = stop.vars[channel]

    // Set the CSS variable
    document.documentElement.style.setProperty(varName, value)
    modifications[varName] = value

    // Update slider value label
    const labelId = `stop${channel.toUpperCase()}${stopIndex}`
    const label = $(labelId)
    if (label) label.textContent = value

    // Update swatch color
    const l = parseFloat(getVarValue(stop.vars.l)) || 0
    const c = parseFloat(getVarValue(stop.vars.c)) || 0
    const h = parseFloat(getVarValue(stop.vars.h)) || 0
    const hex = oklchToDisplayColor(l, c, h)
    const swatch = $(`stopSwatch${stopIndex}`)
    if (swatch) swatch.style.background = hex

    // Update gradient bar
    renderGradientBar()
    updateModCount()
  }

  function updateModCount() {
    const count = Object.keys(modifications).length
    const modBadge = $('modBadge')
    const modCount = $('modCount')
    const modCount2 = $('modCount2')

    modBadge.style.display = count > 0 ? 'inline' : 'none'
    modCount.textContent = count
    if (modCount2) {
      modCount2.style.display = count > 0 ? 'inline' : 'none'
      modCount2.textContent = count
    }

    const container = $('modifiedVars')
    if (count === 0) {
      container.innerHTML = `<div style="color: var(--color-text-muted); font-size: var(--hdk-text-xs); padding: var(--hdk-space-md);">No modifications yet</div>`
    } else {
      container.innerHTML = Object.entries(modifications)
        .map(
          ([varName, value]) => `
      <div class="var-item modified" onclick="editor.openPanel('${varName}')">
        <div class="color-dot" style="background: ${value};"></div>
        <span class="var-label">${varName.replace('--color-', '').replace('--advanced-', 'grad-')}</span>
      </div>
    `
        )
        .join('')
    }
  }

  function updateSwatchValue(varName, value) {
    const el = $(`val-${varName}`)
    if (el) el.textContent = value

    const swatch = $q(`.swatch[data-var="${varName}"]`)
    if (swatch) {
      swatch.classList.toggle('modified', !!modifications[varName])
      const colorDiv = swatch.querySelector('.swatch-color')
      if (colorDiv) colorDiv.style.background = value
    }

    const compactVar = $q(`.compact-var[data-var="${varName}"]`)
    if (compactVar) {
      compactVar.classList.toggle('modified', !!modifications[varName])
      const colorBox = compactVar.querySelector('.color-box')
      if (colorBox) colorBox.style.setProperty('--swatch-color', value)
    }
  }

  // ===== Theme Management =====
  function setTheme(theme) {
    currentTheme = theme
    document.documentElement.setAttribute('data-theme', theme)
    pickerOpen = false
    simpleMode = false
    document.documentElement.setAttribute('data-simple-mode', 'false')

    Object.keys(modifications).forEach(varName => {
      document.documentElement.style.removeProperty(varName)
    })
    modifications = {}

    saveOriginalValues()
    renderThemePicker()
    renderSwatches()
    renderCompactVars()
    updateModCount()
    updateThemePreview()
    renderGradientSection()
    updateModeToggle()

    if (currentVar) updatePanelForVar(currentVar)
  }

  // ===== Color Variable Management =====
  function setVar(varName, value, skipCascade = false) {
    document.documentElement.style.setProperty(varName, value)
    modifications[varName] = value
    updateModCount()
    updateSwatchValue(varName, value)

    if (!skipCascade && CASCADE_MAP[varName]) {
      const hexValue = colorToHex(value)
      const hsl = hexToHsl(hexValue)
      const isDark = currentTheme.includes('dark')

      Object.entries(CASCADE_MAP[varName]).forEach(([childVar, deriveFn]) => {
        const derived = deriveFn(hsl.h, hsl.s, hsl.l, isDark)
        let newColor
        if (derived.a !== undefined && derived.a < 100) {
          newColor = `hsla(${Math.round(derived.h)}, ${Math.round(derived.s)}%, ${Math.round(derived.l)}%, ${derived.a / 100})`
        } else {
          newColor = hslToHex(derived.h, derived.s, derived.l)
        }
        setVar(childVar, newColor, true)
      })
    }

    if (!skipCascade && TEXT_CONTRAST_MAP[varName]) {
      const textColor = getContrastColor(value)
      document.documentElement.style.setProperty(TEXT_CONTRAST_MAP[varName], textColor)
    }
  }

  // ===== Panel Management =====
  function openPanel(varName) {
    currentVar = varName
    $('layout').classList.remove('panel-closed')
    $('editorPanel').classList.remove('hidden')

    $$('.swatch').forEach(s => s.classList.remove('selected'))
    const swatch = $q(`[data-var="${varName}"]`)
    if (swatch) swatch.classList.add('selected')

    highlightElementsUsingVar(varName)
    updatePanelForVar(varName)
  }

  function closePanel() {
    $('layout').classList.add('panel-closed')
    $('editorPanel').classList.add('hidden')
    $$('.swatch').forEach(s => s.classList.remove('selected'))
    clearHighlights()
    currentVar = null
  }

  function highlightElementsUsingVar(varName) {
    clearHighlights()
    $$('[data-vars]').forEach(el => {
      if (el.dataset.vars.split(',').includes(varName)) {
        el.classList.add('editing-highlight')
      }
    })
    const swatch = $q(`[data-var="${varName}"]`)
    if (swatch) swatch.classList.add('editing-highlight')
  }

  function clearHighlights() {
    $$('.editing-highlight').forEach(el => el.classList.remove('editing-highlight'))
  }

  function updatePanelForVar(varName) {
    $('currentVarName').textContent = varName
    const value = getVarValue(varName)
    const hexValue = colorToHex(value)

    $('colorPreview').style.background = value
    $('colorPicker').value = hexValue.slice(0, 7)
    $('hexInput').value = value

    const hsl = hexToHsl(hexValue)
    $('hueSlider').value = hsl.h
    $('satSlider').value = hsl.s
    $('lightSlider').value = hsl.l
    $('alphaSlider').value = hsl.a
    updateSliderLabels(hsl)

    const cascadeNote = $('cascadeNote')
    if (CASCADE_MAP[varName]) {
      const childVars = Object.keys(CASCADE_MAP[varName])
      cascadeNote.style.display = 'block'
      $('cascadeVars').textContent = childVars.map(v => v.replace('--color-', '')).join(', ')
    } else {
      cascadeNote.style.display = 'none'
    }
  }

  function updateSliderLabels(hsl) {
    $('hueValue').textContent = `${Math.round(hsl.h)}°`
    $('satValue').textContent = `${Math.round(hsl.s)}%`
    $('lightValue').textContent = `${Math.round(hsl.l)}%`
    $('alphaValue').textContent = `${Math.round(hsl.a)}%`
  }

  // ===== Event Handlers =====
  function handleColorPick(value) {
    if (!currentVar) return
    setVar(currentVar, value)
    updatePanelForVar(currentVar)
  }

  function handleHexInput(value) {
    if (!currentVar) return
    if (/^#?[0-9a-fA-F]{6,8}$/.test(value)) {
      const hex = value.startsWith('#') ? value : '#' + value
      setVar(currentVar, hex)
      updatePanelForVar(currentVar)
    }
  }

  function handleSliderChange() {
    if (!currentVar) return
    const h = parseFloat($('hueSlider').value)
    const s = parseFloat($('satSlider').value)
    const l = parseFloat($('lightSlider').value)
    const a = parseFloat($('alphaSlider').value)

    updateSliderLabels({ h, s, l, a })

    const color = a < 100 ? `hsla(${h}, ${s}%, ${l}%, ${a / 100})` : hslToHex(h, s, l)

    setVar(currentVar, color)
    $('colorPreview').style.background = color
    $('hexInput').value = color
    $('colorPicker').value = hslToHex(h, s, l).slice(0, 7)
  }

  // ===== Actions =====
  function copyCurrentVar() {
    if (!currentVar) return
    const value = getVarValue(currentVar)
    navigator.clipboard.writeText(`${currentVar}: ${value};`)
    showToast('Copied to clipboard!')
  }

  function resetCurrentVar() {
    if (!currentVar || !originalValues[currentVar]) return

    document.documentElement.style.removeProperty(currentVar)
    delete modifications[currentVar]

    let resetCount = 1
    if (CASCADE_MAP[currentVar]) {
      Object.keys(CASCADE_MAP[currentVar]).forEach(childVar => {
        if (modifications[childVar]) {
          document.documentElement.style.removeProperty(childVar)
          delete modifications[childVar]
          updateSwatchValue(childVar, getVarValue(childVar))
          resetCount++
        }
      })

      if (TEXT_CONTRAST_MAP[currentVar]) {
        document.documentElement.style.removeProperty(TEXT_CONTRAST_MAP[currentVar])
      }
    }

    updateModCount()
    updatePanelForVar(currentVar)
    updateSwatchValue(currentVar, getVarValue(currentVar))
    showToast(resetCount > 1 ? `Reset ${resetCount} variables to original` : 'Reset to original')
  }

  function resetAll() {
    if (!confirm('Reset all modifications?')) return
    Object.keys(modifications).forEach(varName => {
      document.documentElement.style.removeProperty(varName)
    })
    modifications = {}
    updateModCount()
    renderSwatches()
    renderGradientSection()
    if (currentVar) updatePanelForVar(currentVar)
    showToast('All changes reset')
  }

  function exportCSS() {
    const count = Object.keys(modifications).length
    if (count === 0) {
      showToast('No modifications to export')
      return
    }

    let css = `/* Theme modifications based on ${currentTheme} */\n`
    css += `[data-theme='${currentTheme}-custom'] {\n`

    // Export color vars
    Object.values(COLOR_VARS)
      .flat()
      .forEach(varName => {
        const value = getVarValue(varName)
        const isModified = modifications[varName]
        css += `  ${varName}: ${value};${isModified ? ' /* modified */' : ''}\n`
      })

    // Export gradient stop vars if this theme has an advanced gradient
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]
    if (advancedTheme && GRADIENT_VARS[advancedTheme]) {
      css += `\n  /* Advanced gradient stops */\n`
      GRADIENT_VARS[advancedTheme].stops.forEach(stop => {
        Object.values(stop.vars).forEach(varName => {
          const value = getVarValue(varName)
          const isModified = modifications[varName]
          css += `  ${varName}: ${value};${isModified ? ' /* modified */' : ''}\n`
        })
      })
    }

    css += `}\n`

    navigator.clipboard.writeText(css)
    showToast(`Copied ${count} modifications as CSS!`)
  }

  function generateThemeCSS(themeName) {
    let css = `/* Theme: ${themeName} */\n`
    css += `/* Based on: ${currentTheme} */\n`
    css += `/* Created: ${new Date().toISOString().split('T')[0]} */\n\n`
    css += `[data-theme='${themeName}'] {\n`

    // Color vars
    Object.values(COLOR_VARS)
      .flat()
      .forEach(varName => {
        css += `  ${varName}: ${getVarValue(varName)};\n`
      })

    // Gradient stop vars
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]
    if (advancedTheme && GRADIENT_VARS[advancedTheme]) {
      css += `\n  /* Advanced gradient stops */\n`
      GRADIENT_VARS[advancedTheme].stops.forEach(stop => {
        Object.values(stop.vars).forEach(varName => {
          css += `  ${varName}: ${getVarValue(varName)};\n`
        })
      })
    }

    css += `}\n`
    return css
  }

  // ===== Utility =====
  function showToast(message) {
    const toast = $('toast')
    toast.textContent = message
    toast.classList.add('show')
    setTimeout(() => toast.classList.remove('show'), 2000)
  }

  function setupClickHandlers() {
    $$('[data-vars]').forEach(el => {
      el.style.cursor = 'pointer'
      el.addEventListener('click', e => {
        e.preventDefault()
        openPanel(el.dataset.vars.split(',')[0])
      })
    })
  }

  function saveOriginalValues() {
    Object.values(COLOR_VARS)
      .flat()
      .forEach(varName => {
        originalValues[varName] = getVarValue(varName)
      })

    // Save gradient stop vars too
    const advancedTheme = ADVANCED_THEME_MAP[currentTheme]
    if (advancedTheme && GRADIENT_VARS[advancedTheme]) {
      GRADIENT_VARS[advancedTheme].stops.forEach(stop => {
        Object.values(stop.vars).forEach(varName => {
          originalValues[varName] = getVarValue(varName)
        })
      })
    }
  }

  // ===== Local Save Server =====
  let localServerAvailable = false

  async function checkLocalServer() {
    try {
      const response = await fetch(`${LOCAL_SERVER_URL}/health`, { method: 'GET', mode: 'cors' })
      localServerAvailable = response.ok
    } catch {
      localServerAvailable = false
    }
    updateServerStatus()
  }

  function updateServerStatus() {
    const indicator = $('serverStatus')
    if (indicator) {
      indicator.style.display = 'block'
      indicator.innerHTML = localServerAvailable
        ? '<span style="color: var(--color-success);">● Local server connected</span>'
        : '<span style="color: var(--color-text-muted);">○ Local server offline — <code>pnpm --filter @wolffm/themes dev</code></span>'
    }
    const applyBtn = $('applyBtn')
    if (applyBtn) {
      applyBtn.disabled = !localServerAvailable
      applyBtn.title = localServerAvailable
        ? ''
        : 'Start local server: pnpm --filter @wolffm/themes dev'
    }
  }

  async function applyChanges() {
    const count = Object.keys(modifications).length
    if (count === 0) {
      showToast('No modifications to apply')
      return
    }
    if (!localServerAvailable) {
      showToast('Local server not running — run: pnpm --filter @wolffm/themes dev')
      return
    }

    try {
      const response = await fetch(`${LOCAL_SERVER_URL}/save-theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          themeName: currentTheme,
          css: generateThemeCSS(currentTheme),
          mode: 'update'
        })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to save')
      showToast(`Applied ${count} changes to themes/src/style.css`)
    } catch (error) {
      showToast(`Error: ${error.message}`)
    }
  }

  // ===== Event Listeners =====
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (pickerOpen) {
        pickerOpen = false
        renderThemePicker()
      }
    }
  })

  // ===== Start =====
  init()
  checkLocalServer()
  setInterval(checkLocalServer, 5000)

  // Expose functions for inline onclick handlers
  window.editor = {
    openPanel,
    closePanel,
    setTheme,
    setMode,
    togglePicker,
    handleColorPick,
    handleHexInput,
    handleSliderChange,
    handleGradientSlider,
    copyCurrentVar,
    resetCurrentVar,
    resetAll,
    exportCSS,
    applyChanges
  }
})()
