import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es']
    },
    rollupOptions: {
      // @wolffm/themes MUST be external. This package imports the theme
      // context from it, and the context only works while exactly ONE copy of
      // the defining module exists at runtime. Bundling themes in here would
      // ship a second createContext() inside this package — the precise shape
      // of the 2026-08-05 outage, reintroduced one level down. Verified by
      // scripts/verify-single-context.mjs.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@wolffm/themes',
        '@wolffm/prefs-client',
        '@wolffm/prefs-client/react'
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
        // Extract CSS to separate files
        assetFileNames: '[name][extname]'
      }
    },
    minify: false, // Don't minify for library
    sourcemap: true
  }
})
