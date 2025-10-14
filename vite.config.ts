import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // React is provided by hadoku-site via import maps, so externalize it
      external: ['react', 'react-dom/client', 'react/jsx-runtime'],
    },
    target: 'es2022'
  }
})
