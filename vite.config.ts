import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, appendFileSync } from 'fs'
import { resolve, dirname } from 'path'

export default defineConfig({
  plugins: [
    react(),
    // Dev-only local log sink. The client logger's dev sink POSTs every entry
    // here (see src/utils/devLogSink.ts); we append one JSON line per event to
    // .dev-logs/actions.log so local actions are tail-able without edge-router.
    // `apply: 'serve'` keeps this out of production builds entirely.
    {
      name: 'dev-log-sink',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__devlog', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end()
            return
          }
          let body = ''
          req.on('data', chunk => (body += chunk))
          req.on('end', () => {
            try {
              const dir = resolve(__dirname, '.dev-logs')
              mkdirSync(dir, { recursive: true })
              appendFileSync(resolve(dir, 'actions.log'), body.trim() + '\n')
            } catch {
              /* dev-only best-effort; never break the request */
            }
            res.statusCode = 204
            res.end()
          })
        })
      }
    },
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
    },
    // Re-minify JS to strip whitespace (Vite preserves whitespace in ES lib mode)
    {
      name: 'minify-es-lib',
      async renderChunk(code) {
        const esbuild = await import('esbuild')
        const result = await esbuild.transform(code, {
          minify: true,
          target: 'es2022'
        })
        return { code: result.code, map: null }
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
      // React is provided by hadoku-site via import maps, so externalize it.
      // 'react-dom' (bare) is needed for flushSync in entry.tsx and maps to
      // /mf/vendor/react-dom.mjs in the host importmap.
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      output: {
        assetFileNames: 'style.css',
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js'
      }
    },
    target: 'es2022'
  }
})
