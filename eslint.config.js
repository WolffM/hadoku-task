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
      '**/scripts/**'
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
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
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
        HTMLButtonElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
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
          varsIgnorePattern: '^_'
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
        fetch: 'readonly'
      }
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  },

  // Prettier config (must be last)
  prettierConfig
]
