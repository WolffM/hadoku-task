import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Replace process.env.NODE_ENV with string literal to prevent errors
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
  build: {
    lib: {
      entry: 'src/entry.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // React is provided by hadoku-site via import maps, so externalize it
      external: ['react', 'react-dom/client'],
    },
    target: 'es2022'
  }
})
