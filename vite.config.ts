import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

export default defineConfig({
  plugins: [
    react(),
    // Copy manually-maintained type definitions to dist
    // IMPORTANT: src/app/entry.d.ts must be committed to the repo
    // (see .gitignore exception and docs/BUILD_REQUIREMENTS.md)
    {
      name: 'copy-types',
      writeBundle() {
        const dest = resolve(__dirname, 'dist/app/entry.d.ts')
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(resolve(__dirname, 'src/app/entry.d.ts'), dest)
      }
    }
  ],
  server: {
    proxy: {
      '/task/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: false,
        timeout: 5000
      }
    }
  },
  build: {
    lib: {
      entry: 'src/app/entry.tsx',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // React is provided by hadoku-site via import maps, so externalize it
      external: ['react', 'react-dom/client', 'react/jsx-runtime'],
      output: {
        assetFileNames: 'style.css'
      }
    },
    target: 'es2022'
  }
})
