import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'

export default [
  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/scripts/**',
      // Sibling git worktrees — scripts/new-worktree.mjs puts every one here.
      // Without this, `pnpm run lint` walks into whatever other agents currently
      // have checked out and reports THEIR files: 145 errors from one worktree,
      // none of them tracked in this tree. A gate that fails on someone else's
      // work-in-progress is one people stop reading. Mirrored in .prettierignore.
      '.claude/worktrees/**',
      'themes/dev/editor.bundle.js'
    ]
  },

  // Base JavaScript config
  js.configs.recommended,

  // TypeScript and React config
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        PerformanceNavigationTiming: 'readonly',
        PerformanceResourceTiming: 'readonly',
        MutationObserver: 'readonly',
        DragEvent: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        getComputedStyle: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        BroadcastChannel: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        // DOM types
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLLIElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLMetaElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        // SVG + tree-walking, used by the icon specs to measure painted geometry
        SVGSVGElement: 'readonly',
        SVGGraphicsElement: 'readonly',
        NodeFilter: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        TouchEvent: 'readonly',
        DataTransfer: 'readonly',
        MediaQueryList: 'readonly',
        MediaQueryListEvent: 'readonly',
        StorageEvent: 'readonly',
        // TypeScript/React
        React: 'readonly',
        NodeJS: 'readonly'
      }
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React rules
      'react/react-in-jsx-scope': 'off', // Not needed in React 17+
      'react/prop-types': 'off', // Using TypeScript instead
      'react/display-name': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General rules
      'no-console': 'off', // Allow console for logging
      'no-debugger': 'warn',
      'no-unused-vars': 'off', // Use TypeScript version instead
      'no-empty': 'warn', // Allow empty blocks (common in error handlers)
      'no-useless-catch': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error'
    }
  },

  // Worker route files use `(c: any) =>` in app.openapi() handlers because
  // @hono/zod-openapi strict TypedResponse types don't flow through c.json().
  // The `as never` cast on each handler makes `c` implicitly any.
  {
    files: ['worker/src/routes/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // Cloudflare Worker files
  {
    files: ['worker/**/*.ts'],
    languageOptions: {
      globals: {
        KVNamespace: 'readonly',
        D1Database: 'readonly',
        DurableObjectNamespace: 'readonly',
        R2Bucket: 'readonly',
        AnalyticsEngineDataset: 'readonly',
        ExecutionContext: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        fetch: 'readonly',
        // Also part of the workerd runtime — needed by outbound fetches (preset
        // sources) and the harnesses that stub them.
        Headers: 'readonly',
        HeadersInit: 'readonly',
        RequestInit: 'readonly',
        RequestInfo: 'readonly',
        AbortSignal: 'readonly'
      }
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  },

  // The local dev stack is a NODE program that happens to live under worker/ —
  // it bundles the worker and serves it over node:http, so it gets node globals
  // on top of the workerd ones above.
  {
    files: ['worker/test/dev-server.ts', 'worker/test/prefs-dev-server.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        BodyInit: 'readonly',
        process: 'readonly',
        console: 'readonly'
      }
    }
  },

  // Prettier config (must be last)
  prettierConfig
]
