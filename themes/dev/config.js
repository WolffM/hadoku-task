// Editor configuration — themes, color variables, cascade maps, and SVG icons
// Icons match the React components from @wolffm/task-ui-components exactly

const iconAttrs = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

// SVG icons (same paths as ThemeIcons.tsx in task-ui-components)
export const THEME_ICONS = {
  sun: `<svg ${iconAttrs}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg ${iconAttrs}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  strawberry: `<svg ${iconAttrs}><path d="M12 21 C12 21 6.5 15 6.5 11 C6.5 8.5 8 7 10 7 C11 7 12 7.5 12 7.5 C12 7.5 13 7 14 7 C16 7 17.5 8.5 17.5 11 C17.5 15 12 21 12 21 Z" fill="currentColor"/><path d="M9.5 7.5 L9 5 L11 5.5 Z" fill="currentColor"/><path d="M14.5 7.5 L15 5 L13 5.5 Z" fill="currentColor"/><path d="M12 7.5 L12 4 L12 5" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="10" y1="10" x2="10" y2="11" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="14" y1="10" x2="14" y2="11" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="9" y1="13" x2="9" y2="14" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="15" y1="13" x2="15" y2="14" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="11" y1="16" x2="11" y2="17" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="13" y1="16" x2="13" y2="17" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>`,
  wave: `<svg ${iconAttrs}><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`,
  zap: `<svg ${iconAttrs}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  coffee: `<svg ${iconAttrs}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
  flower: `<svg ${iconAttrs}><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  leaf: `<svg ${iconAttrs}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" fill="currentColor"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9 14.5 11 14 11 20" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 8c3 2 5 4 7 7" stroke="white" stroke-width="1.5" opacity="0.4"/></svg>`,
  heart: `<svg ${iconAttrs}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor"/></svg>`,
  spa: `<svg ${iconAttrs}><path d="M8 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M12 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M16 2c0 1.5-1 2.5-1 4s1 2.5 1 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/><path d="M4 14c0-3 1.5-4 4-4s4 1 4 4v4c0 2-1 2-4 2s-4 0-4-2v-4z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="8" cy="14" rx="4" ry="1.5" fill="currentColor" opacity="0.3"/><circle cx="17" cy="18" r="2" fill="currentColor" opacity="0.4"/><circle cx="20" cy="16" r="1.5" fill="currentColor" opacity="0.4"/></svg>`,
};

// Theme families — mirrors THEME_FAMILIES from @wolffm/themes metadata.tsx
// Colors extracted from style.css so the picker shows real theme accents
export const THEME_FAMILIES = [
  { lightTheme: 'light',           darkTheme: 'dark',            label: 'Default',    icon: 'sun',        darkIcon: 'moon',       lightPrimary: '#2563eb', darkPrimary: '#d8b4fe', lightBg: '#f8fafc', darkBg: '#0f172a' },
  { lightTheme: 'strawberry-light', darkTheme: 'strawberry-dark', label: 'Strawberry', icon: 'strawberry', darkIcon: 'strawberry', lightPrimary: '#ff6b9d', darkPrimary: '#ff6b9d', lightBg: '#fffbfc', darkBg: '#1a0d14' },
  { lightTheme: 'ocean-light',     darkTheme: 'ocean-dark',      label: 'Ocean',      icon: 'wave',       darkIcon: 'wave',       lightPrimary: '#06b6d4', darkPrimary: '#06b6d4', lightBg: '#f0f9ff', darkBg: '#082f49' },
  { lightTheme: 'cyberpunk-light', darkTheme: 'cyberpunk-dark',  label: 'Cyberpunk',  icon: 'zap',        darkIcon: 'zap',        lightPrimary: '#ff006e', darkPrimary: '#22d3ee', lightBg: '#fafafe', darkBg: '#020617' },
  { lightTheme: 'coffee-light',    darkTheme: 'coffee-dark',     label: 'Coffee',     icon: 'coffee',     darkIcon: 'coffee',     lightPrimary: '#ea580c', darkPrimary: '#ea580c', lightBg: '#fffbeb', darkBg: '#1c1917' },
  { lightTheme: 'lavender-light',  darkTheme: 'lavender-dark',   label: 'Lavender',   icon: 'flower',     darkIcon: 'flower',     lightPrimary: '#c084fc', darkPrimary: '#c084fc', lightBg: '#fafafa', darkBg: '#1a0f1e' },
  { lightTheme: 'nature-light',    darkTheme: 'nature-dark',     label: 'Nature',     icon: 'leaf',       darkIcon: 'leaf',       lightPrimary: '#6bbe4e', darkPrimary: '#5faf4b', lightBg: '#f9f7ee', darkBg: '#1e1c17' },
  { lightTheme: 'pink-light',      darkTheme: 'pink-dark',       label: 'Pink',       icon: 'heart',      darkIcon: 'heart',      lightPrimary: '#ff69b4', darkPrimary: '#ff10f0', lightBg: '#fffafc', darkBg: '#0d0012' },
  { lightTheme: 'izakaya-light',   darkTheme: 'izakaya-dark',    label: 'Izakaya',    icon: 'spa',        darkIcon: 'spa',        lightPrimary: '#41baae', darkPrimary: '#41baae', lightBg: '#f2e6cd', darkBg: '#101d26' },
];

// Maps theme name → icon key for the toggle button
export const THEME_ICON_MAP = {};
THEME_FAMILIES.forEach(f => {
  THEME_ICON_MAP[f.lightTheme] = f.icon;
  THEME_ICON_MAP[f.darkTheme] = f.darkIcon;
});

export const COLOR_VARS = {
  primary: ['--color-primary', '--color-primary-dark', '--color-primary-light', '--color-primary-bg', '--color-primary-hover', '--color-on-primary'],
  success: ['--color-success', '--color-success-dark', '--color-on-success', '--color-success-bg', '--color-success-hover'],
  warning: ['--color-warning', '--color-warning-bg', '--color-on-warning', '--color-warning-hover'],
  danger: ['--color-danger', '--color-danger-dark', '--color-danger-darker', '--color-danger-light', '--color-on-danger', '--color-danger-hover'],
  neutral: ['--color-neutral', '--color-neutral-light', '--color-neutral-lighter', '--color-on-neutral', '--color-neutral-hover', '--color-muted-bg'],
  text: ['--color-text', '--color-text-secondary', '--color-text-tertiary', '--color-text-muted'],
  border: ['--color-border', '--color-border-light'],
  bg: ['--color-bg', '--color-bg-card', '--color-bg-alt', '--color-bg-hover', '--color-bg-overlay']
};

// Root colors that auto-cascade to derived variants when changed
export const CASCADE_MAP = {
  '--color-primary': {
    '--color-primary-dark': (h, s, l) => ({ h, s, l: Math.max(0, l - 15) }),
    '--color-primary-light': (h, s, l, isDark) => isDark
      ? ({ h, s: Math.max(0, s - 30), l: Math.max(0, l - 30) })
      : ({ h, s: Math.min(100, s - 20), l: Math.min(100, l + 25) }),
    '--color-primary-bg': (h, s, l, isDark) => isDark
      ? ({ h, s: Math.max(0, s - 40), l: 15, a: 100 })
      : ({ h, s: Math.min(100, s - 10), l: 97, a: 100 }),
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
    '--color-danger-light': (h, s, l, isDark) => isDark
      ? ({ h, s: Math.max(0, s - 30), l: Math.max(0, l - 35) })
      : ({ h, s: Math.min(100, s - 20), l: Math.min(100, l + 30) }),
    '--color-danger-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 })
  },
  '--color-neutral': {
    '--color-neutral-light': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.max(0, l - 15) })
      : ({ h, s: Math.max(0, s - 10), l: Math.min(100, l + 20) }),
    '--color-neutral-lighter': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.max(0, l - 25) })
      : ({ h, s: Math.max(0, s - 15), l: Math.min(100, l + 30) }),
    '--color-neutral-hover': (h, s, l, isDark) => ({ h, s, l, a: isDark ? 10 : 6 }),
    '--color-muted-bg': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.max(0, l - 15) })
      : ({ h, s: Math.max(0, s - 10), l: Math.min(100, l + 15) })
  },
  '--color-bg': {
    '--color-bg-card': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.min(100, l + 3) })
      : ({ h, s, l: Math.min(100, l + 2) }),
    '--color-bg-alt': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.max(0, l - 2) })
      : ({ h, s, l: Math.max(0, l - 3) }),
    '--color-bg-hover': (h, s, l, isDark) => isDark
      ? ({ h, s, l: Math.min(100, l + 5) })
      : ({ h, s, l: Math.max(0, l - 4) })
  }
};

// Maps root colors to their auto-calculated contrast text colors
export const TEXT_CONTRAST_MAP = {
  '--color-primary': '--color-on-primary',
  '--color-success': '--color-on-success',
  '--color-warning': '--color-on-warning',
  '--color-danger': '--color-on-danger',
  '--color-neutral': '--color-on-neutral'
};

export const LOCAL_SERVER_URL = 'http://localhost:3456';
export const WORKER_URL = 'https://api.hadoku.me';
